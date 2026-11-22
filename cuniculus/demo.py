"""Built-in demo track: a synthetic EDM arrangement, used by --demo and for testing.
128 BPM. 0-15 s breakdown (pad + arp), 15-22.5 s build (snare roll + riser),
22.5-52.5 s drop (4/4 kick, offbeat bass, clap on 2 and 4, hats, lead), 52.5-60 s breakdown."""
import numpy as np
RATE = 48000
BPM = 128.0
BEAT = 60.0 / BPM
SECTIONS = [("breakdown", 0.0, 32 * BEAT), ("build", 32 * BEAT, 48 * BEAT),
            ("drop", 48 * BEAT, 112 * BEAT), ("outro", 112 * BEAT, 128 * BEAT)]

def make(seconds=60.0, seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * RATE); t = np.arange(n) / RATE
    def sec(a, b): return ((t >= a) & (t < b)).astype(np.float32)
    brk, build, drop, outro = (sec(a, b) for _, a, b in SECTIONS)
    tb = np.mod(t, BEAT)
    kick = np.sin(2*np.pi*(48*tb + 8*(1 - np.exp(-tb*35)))) * np.exp(-tb*8) * 0.9 * drop
    side = 1 - 0.8*np.exp(-tb*7) * drop                       # sidechain pump
    to = np.mod(t + BEAT/2, BEAT)                              # offbeat
    notes = np.array([55.0, 55.0, 65.4, 49.0])[(np.floor(t/(4*BEAT)) % 4).astype(int)]
    bass = np.tanh(3*np.sin(2*np.pi*notes*t)) * np.exp(-to*5) * 0.45 * drop
    pad = sum(np.sin(2*np.pi*f*t + i) for i, f in enumerate((220, 277.2, 329.6, 440))) * 0.07 * side * (brk + drop*0.7 + outro + build)
    arp_f = np.array([440, 554.4, 659.3, 880, 659.3, 554.4])[(np.floor(t/(BEAT/2)) % 6).astype(int)]
    arp = (np.mod(t*arp_f, 1) - .5) * np.exp(-np.mod(t, BEAT/2)*6) * 0.18 * (brk + outro + drop*0.6)
    t2 = np.mod(t - BEAT, 2*BEAT)
    clap = rng.standard_normal(n) * np.exp(-t2*22) * 0.35 * drop
    th = np.mod(t + BEAT/2, BEAT)
    hat = rng.standard_normal(n) * np.exp(-th*70) * 0.12 * (drop + build)
    # build: snare roll speeding up + noise riser
    bp = np.clip((t - SECTIONS[1][1]) / (SECTIONS[1][2] - SECTIONS[1][1]), 0, 1)
    roll_period = np.where(bp < .5, BEAT, np.where(bp < .75, BEAT/2, BEAT/4))
    tr = np.mod(t, roll_period)
    snare = (rng.standard_normal(n)*.6 + np.sin(2*np.pi*200*t)*.4) * np.exp(-tr*25) * 0.4 * build
    riser = rng.standard_normal(n) * 0.25 * bp**2 * build
    lead_f = np.array([880, 1046.5, 784, 1174.7])[(np.floor(t/(2*BEAT)) % 4).astype(int)]
    lead = np.sign(np.sin(2*np.pi*lead_f*t)) * 0.08 * side * drop
    x = kick + bass + pad + arp + clap + hat + snare + riser + lead
    return (x / max(1.0, np.abs(x).max()) * 0.9).astype(np.float32)
