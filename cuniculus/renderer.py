"""OpenGL view: runs the active plugin shader into an HDR buffer, then bloom,
chromatic aberration, tonemapping and grain."""
from __future__ import annotations

import math
import time

import numpy as np
from PyQt6.QtCore import QFileSystemWatcher, pyqtSignal
from PyQt6.QtGui import QSurfaceFormat, QVector3D
from PyQt6.QtOpenGL import (QOpenGLFramebufferObject, QOpenGLFramebufferObjectFormat,
                            QOpenGLShader, QOpenGLShaderProgram, QOpenGLVersionFunctionsFactory,
                            QOpenGLVersionProfile, QOpenGLVertexArrayObject)
from PyQt6.QtOpenGLWidgets import QOpenGLWidget

from .audio import NBANDS, NWAVE, AudioEngine
from .plugins import Plugin

GL_TEXTURE_2D, GL_TEXTURE0 = 0x0DE1, 0x84C0
GL_LINEAR, GL_CLAMP_TO_EDGE = 0x2601, 0x812F
GL_MIN, GL_MAG, GL_WRAP_S, GL_WRAP_T = 0x2801, 0x2800, 0x2802, 0x2803
GL_R32F, GL_RED, GL_FLOAT, GL_RGBA16F = 0x822E, 0x1903, 0x1406, 0x881A
GL_TRIANGLES, GL_BLEND, GL_ONE, GL_FRAMEBUFFER = 4, 0x0BE2, 1, 0x8D40
BLOOM_LEVELS = 6

# cosine palettes: colour(t) = a + b*cos(2*pi*(c*t + d))
PALETTES: list[tuple[str, tuple]] = [
    ("Wonderland", ((.55, .40, .60), (.45, .40, .40), (1.0, 1.0, 1.0), (.80, .45, .15))),
    ("Neon",       ((.50, .50, .50), (.50, .50, .50), (1.0, 1.0, .50), (.80, .90, .30))),
    ("Sunset",     ((.60, .40, .40), (.40, .40, .35), (1.0, .70, .40), (.00, .15, .20))),
    ("Acid",       ((.45, .55, .30), (.45, .45, .30), (1.0, 1.0, 1.0), (.30, .00, .60))),
    ("Ice",        ((.35, .55, .70), (.35, .40, .30), (1.0, 1.0, 1.0), (.55, .50, .45))),
    ("Ember",      ((.60, .32, .15), (.40, .30, .15), (1.0, .80, .60), (.00, .08, .15))),
    ("Spectrum",   ((.50, .50, .50), (.50, .50, .50), (1.0, 1.0, 1.0), (.00, .33, .67))),
]

VERT = """#version 410 core
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }
"""

PLUGIN_HEADER = """#version 410 core
uniform vec3 iResolution;
uniform float iTime, iTimeDelta;
uniform int iFrame;
uniform float uBass, uMid, uHigh, uLevel;
uniform float uBeat, uBeatCount, uBeatPhase, uBeatClock, uBpm;
uniform float uTravel, uIntensity;
uniform sampler2D uSpectrum, uWave, uPrev;
uniform vec3 uPalA, uPalB, uPalC, uPalD;
out vec4 cu_FragColor;
vec3 palette(float t){ return uPalA + uPalB*cos(6.28318530718*(uPalC*t + uPalD)); }
float spectrum(float x){ return texture(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float wave(float x){ return texture(uWave, vec2(clamp(x, 0.0, 1.0), 0.5)).r*2.0 - 1.0; }
#line 1
"""

PLUGIN_FOOTER = """
void main(){
    vec4 c = vec4(0.0);
    mainImage(c, gl_FragCoord.xy);
    vec3 r = c.rgb;
    if (any(isnan(r)) || any(isinf(r))) r = vec3(0.0);
    cu_FragColor = vec4(clamp(r, 0.0, 64.0), 1.0);
}
"""

FRAG_HEAD = "#version 410 core\nuniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;\n"

PREFILTER = FRAG_HEAD + """
void main(){
    vec2 uv = gl_FragCoord.xy * uTexel * 2.0;   // target is half the source size
    vec3 c = (texture(uTex, uv + uTexel*vec2(-.5,-.5)).rgb + texture(uTex, uv + uTexel*vec2(.5,-.5)).rgb
            + texture(uTex, uv + uTexel*vec2(-.5,.5)).rgb + texture(uTex, uv + uTexel*vec2(.5,.5)).rgb) * 0.25;
    float l = max(c.r, max(c.g, c.b));
    float soft = clamp(l - 0.55, 0.0, 0.6);
    float k = max(soft*soft/1.2, l - 0.85) / max(l, 1e-4);
    o = vec4(c * max(k, 0.0), 1.0);
}
"""

DOWN = FRAG_HEAD + """
void main(){
    vec2 uv = gl_FragCoord.xy * uTexel * 2.0;
    vec2 h = uTexel;
    vec3 s = texture(uTex, uv).rgb * 4.0;
    s += texture(uTex, uv - h).rgb + texture(uTex, uv + h).rgb;
    s += texture(uTex, uv + vec2(h.x, -h.y)).rgb + texture(uTex, uv - vec2(h.x, -h.y)).rgb;
    o = vec4(s / 8.0, 1.0);
}
"""

UP = FRAG_HEAD + """
void main(){
    vec2 uv = gl_FragCoord.xy * uTexel * 0.5;   // target is twice the source size
    vec2 h = uTexel * 0.5;
    vec3 s = texture(uTex, uv + vec2(-h.x*2.0, 0.0)).rgb + texture(uTex, uv + vec2(h.x*2.0, 0.0)).rgb
           + texture(uTex, uv + vec2(0.0, h.y*2.0)).rgb + texture(uTex, uv + vec2(0.0, -h.y*2.0)).rgb;
    s += (texture(uTex, uv + vec2(-h.x, h.y)).rgb + texture(uTex, uv + vec2(h.x, h.y)).rgb
        + texture(uTex, uv + vec2(h.x, -h.y)).rgb + texture(uTex, uv + vec2(-h.x, -h.y)).rgb) * 2.0;
    o = vec4(s / 12.0 * 0.72, 1.0);   // wide levels count less, so glow never fogs the frame
}
"""

COMPOSITE = """#version 410 core
uniform sampler2D uScene, uBloom;
uniform vec2 uRes;
uniform float uBloomAmt, uAberr, uFlash, uTime;
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
    vec2 uv = gl_FragCoord.xy / uRes;
    vec2 d = (uv - 0.5);
    vec2 off = d * dot(d, d) * uAberr;
    vec3 c;
    c.r = texture(uScene, uv - off).r;
    c.g = texture(uScene, uv).g;
    c.b = texture(uScene, uv + off).b;
    vec3 b;
    b.r = texture(uBloom, uv - off*1.5).r;
    b.g = texture(uBloom, uv).g;
    b.b = texture(uBloom, uv + off*1.5).b;
    c += b * uBloomAmt;
    c *= 1.0 + uFlash;
    c *= 1.0 - 0.55*smoothstep(0.35, 1.05, length(d)*1.25);
    c = aces(c);
    c = pow(c, vec3(1.0/2.2));
    c += (hash(gl_FragCoord.xy + fract(uTime)*311.7) - 0.5) / 255.0 * 2.0;
    o = vec4(c, 1.0);
}
"""


def default_format() -> QSurfaceFormat:
    fmt = QSurfaceFormat()
    fmt.setVersion(4, 1)
    fmt.setProfile(QSurfaceFormat.OpenGLContextProfile.CoreProfile)
    fmt.setSwapInterval(1)
    return fmt


class GLView(QOpenGLWidget):
    shader_error = pyqtSignal(str)   # empty string = ok

    def __init__(self, audio: AudioEngine, parent=None) -> None:
        super().__init__(parent)
        self.audio = audio
        self.plugin: Plugin | None = None
        self.pending: Plugin | None = None
        self.palette = 0
        self.intensity = 1.0
        self.f = None
        self.prog: QOpenGLShaderProgram | None = None
        self.scene: list[QOpenGLFramebufferObject] = []
        self.bloom: list[QOpenGLFramebufferObject] = []
        self.flip = 0
        self.frame = 0
        self.t0 = self.last = time.perf_counter()
        self.travel = 0.0
        self.kick = 0.0
        self.clock = 0.0
        self.seen_beats = 0
        self.sm = dict(bass=0.0, mid=0.0, high=0.0, level=0.0)
        self.bpm = 0.0
        self.status = ""
        self.fps = 0.0
        self.watcher = QFileSystemWatcher(self)
        self.watcher.fileChanged.connect(self._file_changed)
        self.frameSwapped.connect(self.update)
        self.setMouseTracking(True)

    # ---- plugin handling -------------------------------------------------
    def set_plugin(self, plugin: Plugin) -> None:
        self.pending = plugin
        self.update()

    def reload(self) -> None:
        if self.plugin:
            self.set_plugin(self.plugin)

    def _file_changed(self, path: str) -> None:
        if self.plugin and str(self.plugin.shader) == path:
            self.reload()
        if path not in self.watcher.files():      # editors replace the file on save
            self.watcher.addPath(path)

    def _build(self, frag: str) -> tuple[QOpenGLShaderProgram | None, str]:
        p = QOpenGLShaderProgram(self)
        ok = (p.addShaderFromSourceCode(QOpenGLShader.ShaderTypeBit.Vertex, VERT)
              and p.addShaderFromSourceCode(QOpenGLShader.ShaderTypeBit.Fragment, frag)
              and p.link())
        return (p, "") if ok else (None, p.log())

    def _load_pending(self) -> None:
        plugin, self.pending = self.pending, None
        try:
            src = plugin.source()
        except OSError as e:
            self.shader_error.emit(f"{plugin.name}: {e}")
            return
        prog, log = self._build(PLUGIN_HEADER + src + PLUGIN_FOOTER)
        if prog is None:
            print(f"cuniculus: shader error in {plugin.shader}\n{log}")
            self.shader_error.emit(f"{plugin.name}: shader error\n{log.strip()[:600]}")
            if self.plugin is None or self.plugin.id != plugin.id:
                return                            # keep showing the previous one
        else:
            self.prog = prog
            self.shader_error.emit("")
        if self.plugin is None or self.plugin.id != plugin.id:
            if self.watcher.files():
                self.watcher.removePaths(self.watcher.files())
            self.watcher.addPath(str(plugin.shader))
            self.plugin = plugin

    # ---- GL ---------------------------------------------------------------
    def initializeGL(self) -> None:
        prof = QOpenGLVersionProfile()
        prof.setVersion(4, 1)
        prof.setProfile(QSurfaceFormat.OpenGLContextProfile.CoreProfile)
        self.f = QOpenGLVersionFunctionsFactory.get(prof, self.context())
        self.vao = QOpenGLVertexArrayObject(self)
        self.vao.create()
        self.p_pre, _ = self._build(PREFILTER)
        self.p_down, _ = self._build(DOWN)
        self.p_up, _ = self._build(UP)
        self.p_comp, log = self._build(COMPOSITE)
        if not all((self.p_pre, self.p_down, self.p_up, self.p_comp)):
            raise RuntimeError("cuniculus: internal shader failed to build\n" + log)
        self.tex_spec = self._data_texture()
        self.tex_wave = self._data_texture()

    def _tex_params(self) -> None:
        f = self.f
        for k, v in ((GL_MIN, GL_LINEAR), (GL_MAG, GL_LINEAR),
                     (GL_WRAP_S, GL_CLAMP_TO_EDGE), (GL_WRAP_T, GL_CLAMP_TO_EDGE)):
            f.glTexParameteri(GL_TEXTURE_2D, k, v)

    def _data_texture(self) -> int:
        t = self.f.glGenTextures(1)
        self.f.glBindTexture(GL_TEXTURE_2D, t)
        self._tex_params()
        return t

    def _fbo(self, w: int, h: int) -> QOpenGLFramebufferObject:
        fmt = QOpenGLFramebufferObjectFormat()
        fmt.setInternalTextureFormat(GL_RGBA16F)
        fbo = QOpenGLFramebufferObject(max(w, 1), max(h, 1), fmt)
        self.f.glBindTexture(GL_TEXTURE_2D, fbo.texture())
        self._tex_params()
        return fbo

    def resizeGL(self, w: int, h: int) -> None:
        dpr = self.devicePixelRatioF()
        W, H = max(int(w * dpr), 2), max(int(h * dpr), 2)
        self.scene = [self._fbo(W, H), self._fbo(W, H)]
        for fbo in self.scene:
            fbo.bind()
            self.f.glClearColor(0, 0, 0, 1)
            self.f.glClear(0x4000)
        self.bloom = []
        for _ in range(BLOOM_LEVELS):
            W, H = max(W // 2, 2), max(H // 2, 2)
            self.bloom.append(self._fbo(W, H))

    def _bind_tex(self, unit: int, tex: int) -> None:
        self.f.glActiveTexture(GL_TEXTURE0 + unit)
        self.f.glBindTexture(GL_TEXTURE_2D, tex)

    def _blit(self, prog, src: QOpenGLFramebufferObject, dst: QOpenGLFramebufferObject) -> None:
        dst.bind()
        self.f.glViewport(0, 0, dst.width(), dst.height())
        prog.bind()
        self._bind_tex(0, src.texture())
        prog.setUniformValue("uTex", 0)
        prog.setUniformValue("uTexel", 1.0 / src.width(), 1.0 / src.height())
        self.f.glDrawArrays(GL_TRIANGLES, 0, 3)

    def paintGL(self) -> None:
        f = self.f
        if self.pending is not None:
            self._load_pending()
        now = time.perf_counter()
        dt = min(max(now - self.last, 1e-4), 0.1)
        self.last = now
        self.fps += (1.0 / dt - self.fps) * 0.05
        if self.prog is None or not self.scene:
            f.glClearColor(0, 0, 0, 1)
            f.glClear(0x4000)
            return

        # ---- audio features, eased per frame
        ft = self.audio.snapshot()
        self.status, self.bpm = ft.status, ft.bpm
        k = 1.0 - math.exp(-dt * 28.0)
        for name in self.sm:
            self.sm[name] += (getattr(ft, name) - self.sm[name]) * k
        beat = math.exp(-max(time.monotonic() - ft.last_beat, 0.0) * 5.0)
        if ft.beat_count != self.seen_beats:
            self.seen_beats = ft.beat_count
            self.kick = 1.0
        self.kick *= math.exp(-dt * 4.0)
        # beat clock: run at the tempo between audio updates, ease towards the analyser's value
        self.clock += dt * (ft.bpm if ft.bpm > 0 else 120.0) / 60.0
        err = ft.beat_clock - self.clock
        self.clock += err if abs(err) > 2.0 else err * min(1.0, dt * 6.0)
        inten = self.intensity
        speed = 0.7 + inten * (3.2 * self.sm["level"] + 2.2 * self.sm["bass"] + 3.0 * self.kick)
        self.travel += dt * speed

        f.glDisable(GL_BLEND)
        f.glDisable(0x0B71)  # depth test
        self.vao.bind()

        # ---- scene pass (HDR), previous frame available as uPrev
        src, dst = self.scene[self.flip], self.scene[1 - self.flip]
        self.flip = 1 - self.flip
        dst.bind()
        W, H = dst.width(), dst.height()
        f.glViewport(0, 0, W, H)
        p = self.prog
        p.bind()
        self._bind_tex(0, self.tex_spec)
        f.glTexImage2D(GL_TEXTURE_2D, 0, GL_R32F, NBANDS, 1, 0, GL_RED, GL_FLOAT,
                       np.ascontiguousarray(ft.spectrum, np.float32))
        self._bind_tex(1, self.tex_wave)
        f.glTexImage2D(GL_TEXTURE_2D, 0, GL_R32F, NWAVE, 1, 0, GL_RED, GL_FLOAT,
                       np.ascontiguousarray(ft.wave, np.float32))
        self._bind_tex(2, src.texture())
        p.setUniformValue("uSpectrum", 0)
        p.setUniformValue("uWave", 1)
        p.setUniformValue("uPrev", 2)
        p.setUniformValue("iResolution", QVector3D(float(W), float(H), 1.0))
        p.setUniformValue("iTime", float(now - self.t0))
        p.setUniformValue("iTimeDelta", float(dt))
        p.setUniformValue("iFrame", self.frame)
        for name, key in (("uBass", "bass"), ("uMid", "mid"), ("uHigh", "high"), ("uLevel", "level")):
            p.setUniformValue(name, float(min(self.sm[key], 1.0)))
        p.setUniformValue("uBeat", float(beat))
        p.setUniformValue("uBeatCount", float(ft.beat_count % 4096))
        p.setUniformValue("uBeatPhase", float(ft.beat_phase))
        p.setUniformValue("uBpm", float(ft.bpm))
        p.setUniformValue("uBeatClock", float(self.clock % 3840.0))
        p.setUniformValue("uTravel", float(self.travel))
        p.setUniformValue("uIntensity", float(inten))
        for name, v in zip(("uPalA", "uPalB", "uPalC", "uPalD"), PALETTES[self.palette][1]):
            p.setUniformValue(name, QVector3D(*v))
        f.glDrawArrays(GL_TRIANGLES, 0, 3)
        self.frame += 1

        # ---- bloom: prefilter, downsample chain, additive upsample chain
        self._blit(self.p_pre, dst, self.bloom[0])
        for i in range(1, BLOOM_LEVELS):
            self._blit(self.p_down, self.bloom[i - 1], self.bloom[i])
        f.glEnable(GL_BLEND)
        f.glBlendFunc(GL_ONE, GL_ONE)
        for i in range(BLOOM_LEVELS - 1, 0, -1):
            self._blit(self.p_up, self.bloom[i], self.bloom[i - 1])
        f.glDisable(GL_BLEND)

        # ---- composite to the window
        f.glBindFramebuffer(GL_FRAMEBUFFER, self.defaultFramebufferObject())
        f.glViewport(0, 0, W, H)
        c = self.p_comp
        c.bind()
        self._bind_tex(0, dst.texture())
        self._bind_tex(1, self.bloom[0].texture())
        c.setUniformValue("uScene", 0)
        c.setUniformValue("uBloom", 1)
        c.setUniformValue("uRes", float(W), float(H))
        pl = self.plugin
        c.setUniformValue("uBloomAmt", float((pl.bloom if pl else 0.8) / BLOOM_LEVELS * 2.0))
        c.setUniformValue("uAberr", float((pl.aberration if pl else 1.0) * inten
                                          * (0.012 + 0.03 * beat + 0.015 * self.sm["bass"])))
        c.setUniformValue("uFlash", 0.0)   # full-screen beat flash removed: it hid the visuals
        c.setUniformValue("uTime", float(now - self.t0))
        f.glDrawArrays(GL_TRIANGLES, 0, 3)
        self._bind_tex(0, 0)
        self.vao.release()
