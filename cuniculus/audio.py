"""Audio capture (PipeWire system output) and analysis for Cuniculus.

A background thread reads raw float32 stereo from `pw-record` (capturing the
default sink's monitor), analyses it in fixed 512-sample hops and publishes a
snapshot of features that the renderer reads once per frame.
"""
from __future__ import annotations

import shutil
import subprocess
import threading
import time
from dataclasses import dataclass, field

import numpy as np

RATE = 48000
HOP = 512
NFFT = 2048
NBANDS = 128
NWAVE = 512
HOP_DT = HOP / RATE
HOP_RATE = RATE / HOP


@dataclass
class Features:
    bass: float = 0.0
    mid: float = 0.0
    high: float = 0.0
    level: float = 0.0
    bpm: float = 0.0
    beat_phase: float = 0.0
    beat_count: int = 0
    last_beat: float = -1e9          # time.monotonic() of the last onset
    spectrum: np.ndarray = field(default_factory=lambda: np.zeros(NBANDS, np.float32))
    wave: np.ndarray = field(default_factory=lambda: np.zeros(NWAVE, np.float32))
    status: str = "starting"
    beat_clock: float = 0.0          # continuous beat position from the BPM clock
    pitch: float = 0.5               # where the sound's centre of mass sits, 0 (low) .. 1 (high), self-ranging
    bass_hits: int = 0               # count of sudden jumps in the bass band only (kick/sub drops)
    bass_power: float = 0.0          # strength of the latest one, 0..1


class Analyzer:
    def __init__(self) -> None:
        self.buf = np.zeros(NFFT, np.float32)
        self.window = np.hanning(NFFT).astype(np.float32)
        self.wnorm = 2.0 / self.window.sum()
        freqs = np.fft.rfftfreq(NFFT, 1.0 / RATE)
        edges = np.geomspace(30.0, 16000.0, NBANDS + 1)
        self.centers = np.sqrt(edges[:-1] * edges[1:])
        self.freqs = freqs
        self.lo = np.minimum(np.searchsorted(freqs, edges[:-1]), len(freqs) - 1)
        # music falls off towards the highs; tilt so every band gets to move
        self.tilt = 3.5 * np.log2(self.centers / 1000.0)
        self.m_bass = self.centers < 150
        self.m_mid = (self.centers >= 150) & (self.centers < 2000)
        self.m_high = self.centers >= 2000
        self.m_low = self.centers < 180

        self.peak_db = -60.0
        self.spec = np.zeros(NBANDS, np.float32)
        self.prev_norm = np.zeros(NBANDS, np.float32)
        self.bass = self.mid = self.high = self.level = 0.0
        self.cent, self.cl, self.ch, self.pitch = 0.5, 0.4, 0.6, 0.5
        # the bass-hit detector has its own, longer FFT: more bins in the bass range, so noise cannot
        # fake a jump by chance (3 bins at 2048 points, 7 at 4096)
        self.buf4 = np.zeros(4096, np.float32)
        self.win4 = np.hanning(4096).astype(np.float32)
        self.norm4 = 2.0 / self.win4.sum()
        f4 = np.fft.rfftfreq(4096, 1.0 / RATE)
        self.bidx = np.where((f4 >= 30.0) & (f4 < 110.0))[0]
        self.midx = np.where((f4 >= 130.0) & (f4 < 400.0))[0]      # where a snare's body lives
        self.hidx = np.where((f4 >= 400.0) & (f4 < 3000.0))[0]
        self.eh_ema = 0.0
        self.eb_ema = self.em_ema = 0.0
        self.eb_peak = 1e-3
        self.eb_dev = 0.0
        self.prev_bflux = 0.0
        self.since_bass = 1.0
        self.bass_hits = 0
        self.bass_power = 0.0
        self.idx = np.arange(NBANDS, dtype=np.float32) / (NBANDS - 1)

        self.flux_hist = np.zeros(int(HOP_RATE * 8), np.float32)
        self.prev_flux = 0.0
        self.since_onset = 1.0
        self.hops = 0
        self.bpm = 0.0
        self.bpm_hist: list[float] = []
        self.phase = 0.0
        self.beat_count = 0
        self.last_beat = -1e9

    @staticmethod
    def _follow(cur: float, target: float, up: float, down: float) -> float:
        return cur + (target - cur) * (up if target > cur else down)

    def process(self, hop: np.ndarray) -> None:
        """hop: mono float32, HOP samples."""
        self.buf = np.concatenate((self.buf[HOP:], hop))
        mag = np.abs(np.fft.rfft(self.buf * self.window)) * self.wnorm
        band = np.maximum(np.maximum.reduceat(mag, self.lo),
                          np.interp(self.centers, self.freqs, mag))
        db = 20.0 * np.log10(band + 1e-7) + self.tilt

        top = float(db.max())
        self.peak_db = max(self.peak_db - 1.5 * HOP_DT, top, -60.0)
        if top < -75.0:
            norm = np.zeros(NBANDS, np.float32)
        else:
            norm = np.clip((db - (self.peak_db - 48.0)) / 48.0, 0.0, 1.0).astype(np.float32)

        self.spec = np.maximum(norm, self.spec * 0.90)
        # pitch: energy-weighted centre of the spectrum (log frequency), smoothed, then stretched
        # over the range it has recently covered so that any music moves across 0..1
        w = norm * norm
        tot = float(w.sum())
        if tot > 1.0:
            c = float((w * self.idx).sum()) / tot
            self.cent += (c - self.cent) * (1.0 - np.exp(-HOP_DT / 0.25))
            self.cl += (self.cent - self.cl) * 0.0004
            self.ch += (self.cent - self.ch) * 0.0004
            self.cl, self.ch = min(self.cl, self.cent), max(self.ch, self.cent)
            self.pitch = float(np.clip((self.cent - self.cl) / max(self.ch - self.cl, 0.12), 0.0, 1.0))
        self.bass = self._follow(self.bass, float(norm[self.m_bass].mean()) * 1.25, 0.65, 0.12)
        self.mid = self._follow(self.mid, float(norm[self.m_mid].mean()) * 1.25, 0.5, 0.10)
        self.high = self._follow(self.high, float(norm[self.m_high].mean()) * 1.5, 0.5, 0.12)
        self.level = self._follow(self.level, float(norm.mean()) * 1.3, 0.4, 0.06)

        # onset detection: spectral flux, weighted towards the low end
        diff = np.maximum(norm - self.prev_norm, 0.0)
        self.prev_norm = norm
        flux = float(diff[self.m_low].mean()) + 0.12 * float(diff.mean())
        self.flux_hist = np.roll(self.flux_hist, -1)
        self.flux_hist[-1] = flux
        recent = self.flux_hist[-int(HOP_RATE):]
        self.since_onset += HOP_DT
        self.phase += HOP_DT * (self.bpm if self.bpm > 0 else 120.0) / 60.0
        if (flux > recent.mean() * 1.8 + 0.03 and flux >= self.prev_flux
                and self.since_onset > 0.26):
            self.since_onset = 0.0
            self.beat_count += 1
            self.last_beat = time.monotonic()
            err = self.phase - round(self.phase)
            if abs(err) < 0.25:
                self.phase -= err * 0.5
        self.prev_flux = flux

        # bass hits: the raw bass bins jump well above their recent level while the mids do not
        # jump with them (a snare lifts both; a kick or a sub drop lifts only the bass). Raw
        # magnitudes are used on purpose: the normalised spectrum hides a kick under a sustained bass.
        self.buf4 = np.concatenate((self.buf4[HOP:], hop))
        mag4 = np.abs(np.fft.rfft(self.buf4 * self.win4)) * self.norm4
        eb = float(mag4[self.bidx].mean())
        em = float(mag4[self.midx].mean())
        eh = float(mag4[self.hidx].mean())
        db, dm = eb - self.eb_ema, max(em - self.em_ema, eh - self.eh_ema)
        self.eh_ema += (eh - self.eh_ema) * (1.0 - np.exp(-HOP_DT / 0.25))
        k = 1.0 - np.exp(-HOP_DT / 0.25)
        self.eb_ema += (eb - self.eb_ema) * k
        self.em_ema += (em - self.em_ema) * k
        self.eb_peak = max(self.eb_peak * np.exp(-HOP_DT / 8.0), db, 1e-4)
        dev_before = self.eb_dev
        if self.since_bass > 0.3:      # not while a hit is still ringing; and no single sample can move it far
            self.eb_dev += (min(abs(db), 2.5 * self.eb_dev + 0.003) - self.eb_dev) * (1.0 - np.exp(-HOP_DT / 2.0))
        self.since_bass += HOP_DT
        if (db > 0.35 * self.eb_peak and db > 4.0 * max(dm, 0.0) + 0.002 and db >= self.prev_bflux
                and db > 4.0 * dev_before and db > 0.004 and self.since_bass > 0.14):
            self.since_bass = 0.0
            self.bass_hits += 1
            self.bass_power = float(np.clip(0.35 + 0.65 * db / self.eb_peak, 0.0, 1.0))
        self.prev_bflux = db

        self.hops += 1
        if self.hops % int(HOP_RATE / 2) == 0:
            self._estimate_bpm()

    def _estimate_bpm(self) -> None:
        e = self.flux_hist - self.flux_hist.mean()
        if float(np.abs(e).max()) < 0.01:
            self.bpm_hist.clear()
            self.bpm = 0.0
            return
        lags = np.arange(int(HOP_RATE * 60 / 190), int(HOP_RATE * 60 / 64) + 1)
        n = len(e)
        ac = np.array([float(np.dot(e[:n - l], e[l:])) / (n - l) for l in lags])
        ac2 = np.array([float(np.dot(e[:n - 2 * l], e[2 * l:])) / (n - 2 * l) for l in lags])
        bpms = 60.0 * HOP_RATE / lags
        prior = np.exp(-0.5 * (np.log2(bpms / 125.0) / 0.7) ** 2)
        score = (ac + 0.5 * ac2) * prior
        i = int(score.argmax())
        if score[i] <= 0:
            return
        lag = float(lags[i])
        if 0 < i < len(lags) - 1:  # parabolic refinement
            a, b, c = score[i - 1], score[i], score[i + 1]
            den = a - 2 * b + c
            if den != 0:
                lag += 0.5 * (a - c) / den
        self.bpm_hist.append(60.0 * HOP_RATE / lag)
        self.bpm_hist = self.bpm_hist[-7:]
        self.bpm = float(np.median(self.bpm_hist))

    def wave(self) -> np.ndarray:
        w = self.buf[-NWAVE * 2:].reshape(NWAVE, 2).mean(axis=1)
        return (w * 0.5 + 0.5).astype(np.float32)


class AudioEngine:
    """Owns the capture thread. `snapshot()` is safe to call from the UI thread."""

    def __init__(self, demo: bool = False) -> None:
        self.demo = demo
        self.an = Analyzer()
        self.lock = threading.Lock()
        self.feat = Features()
        self.running = True
        self.proc: subprocess.Popen | None = None
        self.thread = threading.Thread(target=self._run, daemon=True, name="cuniculus-audio")
        self.thread.start()

    def snapshot(self) -> Features:
        with self.lock:
            return self.feat

    def stop(self) -> None:
        self.running = False
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()

    def _publish(self, status: str) -> None:
        a = self.an
        f = Features(a.bass, a.mid, a.high, a.level, a.bpm, a.phase % 1.0, a.beat_count,
                     a.last_beat, a.spec.copy(), a.wave(), status, a.phase, a.pitch,
                     a.bass_hits, a.bass_power)
        with self.lock:
            self.feat = f

    def _set_status(self, status: str) -> None:
        with self.lock:
            f = self.feat
            self.feat = Features(0, 0, 0, 0, 0, 0, f.beat_count, f.last_beat,
                                 np.zeros(NBANDS, np.float32),
                                 np.full(NWAVE, 0.5, np.float32), status, f.beat_clock, f.pitch,
                                 f.bass_hits, f.bass_power)

    def _run(self) -> None:
        if self.demo:
            self._run_demo()
            return
        exe = shutil.which("pw-record")
        if not exe:
            self._set_status("pw-record not found (install pipewire)")
            return
        cmd = [exe, "--raw", "--format", "f32", "--rate", str(RATE), "--channels", "2",
               "--latency", "20ms", "-P",
               '{ stream.capture.sink=true node.name=cuniculus '
               'node.description="Cuniculus" media.name="Cuniculus visualizer" }', "-"]
        nbytes = HOP * 2 * 4
        while self.running:
            try:
                self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                             stderr=subprocess.DEVNULL, bufsize=0)
            except OSError as e:
                self._set_status(f"capture failed: {e}")
                return
            out = self.proc.stdout
            while self.running:
                data = b""
                while len(data) < nbytes:
                    chunk = out.read(nbytes - len(data))
                    if not chunk:
                        break
                    data += chunk
                if len(data) < nbytes:
                    break
                st = np.frombuffer(data, dtype="<f4").reshape(HOP, 2)
                self.an.process(st.mean(axis=1))
                self._publish("listening")
            if self.running:
                self._set_status("audio capture stopped, retrying")
                time.sleep(2.0)

    def _run_demo(self) -> None:
        """Synthetic 124 BPM track so the visuals can be tested without sound."""
        rng = np.random.default_rng(7)
        bpm = 124.0
        beat = 60.0 / bpm
        n = 0
        t0 = time.monotonic()
        notes = [110.0, 164.8, 220.0, 261.6, 329.6, 261.6, 220.0, 164.8]
        while self.running:
            t = (n + np.arange(HOP)) / RATE
            tb = np.mod(t, beat)
            kick = np.sin(2 * np.pi * (45 * tb + 9.0 * (1 - np.exp(-tb * 30)))) * np.exp(-tb * 9) * 0.8
            th = np.mod(t + beat / 2, beat / 2)
            hat = rng.standard_normal(HOP) * np.exp(-th * 60) * 0.12
            step = (np.floor(t / (beat / 2)).astype(int)) % len(notes)
            f = np.array(notes)[step]
            arp = (np.mod(t * f, 1.0) - 0.5) * 0.25 * np.exp(-np.mod(t, beat / 2) * 5)
            sweep = np.sin(2 * np.pi * t * (800 + 600 * np.sin(t * 0.7))) * 0.08
            self.an.process((kick + hat + arp + sweep).astype(np.float32))
            self._publish("demo signal")
            n += HOP
            delay = t0 + n / RATE - time.monotonic()
            if delay > 0:
                time.sleep(delay)
