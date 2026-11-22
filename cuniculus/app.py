"""Cuniculus window: GL view plus a control strip that shows on mouse movement."""
from __future__ import annotations

import argparse
import json
import signal
import sys
from pathlib import Path

from PyQt6.QtCore import QEvent, QObject, Qt, QTimer
from PyQt6.QtGui import QCursor, QKeySequence, QShortcut, QSurfaceFormat
from PyQt6.QtWidgets import (QApplication, QFrame, QHBoxLayout, QLabel, QPushButton,
                             QSlider, QVBoxLayout, QWidget)

from .audio import AudioEngine
from .plugins import USER_DIR, discover
from .renderer import PALETTES, GLView, default_format

SETTINGS = Path.home() / ".config" / "cuniculus" / "settings.json"

STYLE = """
#strip { background: rgba(12, 12, 18, 215); border: 1px solid rgba(255,255,255,28); border-radius: 10px; }
#strip QLabel { color: #e9e6f2; font-size: 13px; }
#strip QLabel#dim { color: #8f8aa3; font-size: 11px; letter-spacing: 1px; }
#strip QPushButton { color: #e9e6f2; background: rgba(255,255,255,14); border: none;
    border-radius: 6px; padding: 5px 10px; font-size: 14px; }
#strip QPushButton:hover { background: rgba(255,255,255,40); }
#strip QSlider::groove:horizontal { height: 4px; background: rgba(255,255,255,40); border-radius: 2px; }
#strip QSlider::sub-page:horizontal { background: #c77dff; border-radius: 2px; }
#strip QSlider::handle:horizontal { width: 12px; margin: -5px 0; border-radius: 6px; background: #f2eaff; }
#error { color: #ffb3c1; background: rgba(30, 6, 12, 225); border: 1px solid #ff4d6d;
    border-radius: 8px; padding: 10px; font-family: monospace; font-size: 12px; }
"""


class Window(QWidget):
    def __init__(self, args) -> None:
        super().__init__()
        self.setWindowTitle("Cuniculus")
        self.resize(1280, 720)
        self.setMinimumSize(320, 200)
        self.setStyleSheet(STYLE)
        self.audio = AudioEngine(demo=args.demo, demo_at=args.demo_at)
        self.plugins = discover()
        self.settings = self._load_settings()
        self.view = GLView(self.audio, self)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.view)

        self.error = QLabel(self)
        self.error.setObjectName("error")
        self.error.setWordWrap(True)
        self.error.hide()
        self.view.shader_error.connect(self._show_error)

        self._build_strip()
        self.hide_timer = QTimer(self, singleShot=True, interval=2500)
        self.hide_timer.timeout.connect(self._maybe_hide)
        self.info_timer = QTimer(self, interval=400)
        self.info_timer.timeout.connect(self._refresh_info)
        self.info_timer.start()

        self.pi = 0
        want = args.plugin or self.settings.get("plugin")
        for i, p in enumerate(self.plugins):
            if p.id == want:
                self.pi = i
        self.view.palette = int(self.settings.get("palette", 0)) % len(PALETTES)
        if args.palette is not None:
            self.view.palette = args.palette % len(PALETTES)
        self.view.intensity = float(self.settings.get("intensity", 1.0))
        self.slider.blockSignals(True)
        self.slider.setValue(int(self.view.intensity * 100))
        self.slider.blockSignals(False)
        self._apply_plugin()
        self._apply_palette()

        for key, fn in (("F11", self.toggle_fullscreen), ("F", self.toggle_fullscreen),
                        ("Escape", self._escape), ("Right", lambda: self.step_plugin(1)),
                        ("Left", lambda: self.step_plugin(-1)), ("P", lambda: self.step_palette(1)),
                        ("Shift+P", lambda: self.step_palette(-1)), ("R", self.rescan),
                        ("Q", self.close), ("Ctrl+Q", self.close)):
            QShortcut(QKeySequence(key), self, activated=fn)
        QApplication.instance().installEventFilter(self)
        self._show_strip()

    # ---- settings ---------------------------------------------------------
    def _load_settings(self) -> dict:
        try:
            return json.loads(SETTINGS.read_text())
        except (OSError, ValueError):
            return {}

    def _save_settings(self) -> None:
        try:
            SETTINGS.parent.mkdir(parents=True, exist_ok=True)
            SETTINGS.write_text(json.dumps({
                "plugin": self.plugins[self.pi].id if self.plugins else "",
                "palette": self.view.palette, "intensity": self.view.intensity}, indent=2))
        except OSError:
            pass

    # ---- control strip ----------------------------------------------------
    def _build_strip(self) -> None:
        s = self.strip = QFrame(self)
        s.setObjectName("strip")
        row = QHBoxLayout(s)
        row.setContentsMargins(12, 8, 12, 8)
        row.setSpacing(8)

        def btn(text, fn, tip):
            b = QPushButton(text)
            b.setToolTip(tip)
            b.setFocusPolicy(Qt.FocusPolicy.NoFocus)
            b.clicked.connect(fn)
            return b

        def dim(text):
            lab = QLabel(text)
            lab.setObjectName("dim")
            return lab

        row.addWidget(dim("VISUAL"))
        row.addWidget(btn("‹", lambda: self.step_plugin(-1), "Previous visualizer (Left)"))
        self.l_plugin = QLabel("-")
        self.l_plugin.setMinimumWidth(110)
        self.l_plugin.setAlignment(Qt.AlignmentFlag.AlignCenter)
        row.addWidget(self.l_plugin)
        row.addWidget(btn("›", lambda: self.step_plugin(1), "Next visualizer (Right)"))
        row.addSpacing(10)
        row.addWidget(dim("COLOR"))
        row.addWidget(btn("‹", lambda: self.step_palette(-1), "Previous palette (Shift+P)"))
        self.l_pal = QLabel("-")
        self.l_pal.setMinimumWidth(90)
        self.l_pal.setAlignment(Qt.AlignmentFlag.AlignCenter)
        row.addWidget(self.l_pal)
        row.addWidget(btn("›", lambda: self.step_palette(1), "Next palette (P)"))
        row.addSpacing(10)
        row.addWidget(dim("INTENSITY"))
        self.slider = QSlider(Qt.Orientation.Horizontal)
        self.slider.setRange(20, 200)
        self.slider.setFixedWidth(110)
        self.slider.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        self.slider.valueChanged.connect(self._intensity)
        row.addWidget(self.slider)
        row.addSpacing(10)
        self.l_info = QLabel("")
        self.l_info.setMinimumWidth(150)
        row.addWidget(self.l_info)
        row.addWidget(btn("⛶", self.toggle_fullscreen, "Fullscreen (F11)"))
        s.adjustSize()

    def _place(self) -> None:
        self.strip.adjustSize()
        w = min(self.strip.sizeHint().width(), self.width() - 16)
        self.strip.setGeometry((self.width() - w) // 2,
                               self.height() - self.strip.height() - 16, w, self.strip.height())
        self.error.setGeometry(16, 16, min(self.width() - 32, 760), self.error.sizeHint().height())

    def resizeEvent(self, e) -> None:
        super().resizeEvent(e)
        self._place()

    def _show_strip(self) -> None:
        if not self.strip.isVisible():
            self.strip.show()
            self.strip.raise_()
            self.unsetCursor()
            self.view.unsetCursor()
        self.hide_timer.start()

    def _maybe_hide(self) -> None:
        if self.strip.geometry().contains(self.mapFromGlobal(QCursor.pos())):
            self.hide_timer.start()
            return
        self.strip.hide()
        self.view.setCursor(Qt.CursorShape.BlankCursor)

    def eventFilter(self, obj: QObject, ev: QEvent) -> bool:
        if ev.type() in (QEvent.Type.MouseMove, QEvent.Type.MouseButtonPress):
            self._show_strip()
        return False

    def mouseDoubleClickEvent(self, e) -> None:
        self.toggle_fullscreen()

    def _refresh_info(self) -> None:
        v = self.view
        bpm = f"{v.bpm:.0f} BPM" if v.bpm > 0 else "-- BPM"
        self.l_info.setText(f"{bpm}  ·  {v.status}")

    def _show_error(self, msg: str) -> None:
        self.error.setText(msg)
        self.error.setVisible(bool(msg))
        self.error.raise_()
        self._place()

    # ---- actions ----------------------------------------------------------
    def _apply_plugin(self) -> None:
        if not self.plugins:
            self._show_error(f"No visualizer plugins found.\nAdd one to {USER_DIR}")
            return
        p = self.plugins[self.pi]
        self.l_plugin.setText(p.name)
        self.l_plugin.setToolTip(f"{p.description}\n{p.author}".strip())
        self.view.set_plugin(p)

    def _apply_palette(self) -> None:
        self.l_pal.setText(PALETTES[self.view.palette][0])

    def step_plugin(self, d: int) -> None:
        if self.plugins:
            self.pi = (self.pi + d) % len(self.plugins)
            self._apply_plugin()
            self._save_settings()
            self._show_strip()

    def step_palette(self, d: int) -> None:
        self.view.palette = (self.view.palette + d) % len(PALETTES)
        self._apply_palette()
        self._save_settings()
        self._show_strip()

    def rescan(self) -> None:
        cur = self.plugins[self.pi].id if self.plugins else None
        self.plugins = discover()
        self.pi = next((i for i, p in enumerate(self.plugins) if p.id == cur), 0)
        self._apply_plugin()

    def _intensity(self, v: int) -> None:
        self.view.intensity = v / 100.0
        self._save_settings()

    def toggle_fullscreen(self) -> None:
        self.showNormal() if self.isFullScreen() else self.showFullScreen()

    def _escape(self) -> None:
        if self.isFullScreen():
            self.showNormal()

    def closeEvent(self, e) -> None:
        self.audio.stop()
        super().closeEvent(e)


def main() -> int:
    ap = argparse.ArgumentParser(prog="cuniculus", description="Music visualizer for system audio.")
    ap.add_argument("--demo", action="store_true", help="play a built-in silent demo track (breakdown, build, drop) instead of system audio")
    ap.add_argument("--demo-at", type=float, default=0.0, metavar="SEC",
                    help="start the demo track this far in (0 breakdown, 15 build, 22.5 drop, 52.5 outro)")
    ap.add_argument("--plugin", help="plugin id (folder name) to start with")
    ap.add_argument("--palette", type=int, help="palette index to start with")
    ap.add_argument("--fullscreen", action="store_true")
    ap.add_argument("--shot", metavar="PNG", help="save a screenshot and exit (for testing)")
    ap.add_argument("--ui", action="store_true", help="include the control strip in --shot")
    ap.add_argument("--burst", type=int, default=1, help="with --shot: save N frames 70 ms apart and print brightness")
    ap.add_argument("--intensity", type=float, help="override intensity (0.2-2.0) for this run")
    ap.add_argument("--after", type=float, default=4.0, help="seconds to wait before --shot")
    ap.add_argument("--size", default="", help="window size for --shot, e.g. 1280x720")
    args = ap.parse_args()

    QSurfaceFormat.setDefaultFormat(default_format())
    app = QApplication(sys.argv[:1])
    app.setApplicationName("Cuniculus")
    app.setDesktopFileName("cuniculus")
    signal.signal(signal.SIGINT, lambda *_: app.quit())
    win = Window(args)
    if args.intensity is not None:
        win.view.intensity = args.intensity
    if args.size:
        w, h = (int(x) for x in args.size.lower().split("x"))
        win.resize(w, h)
    win.showFullScreen() if args.fullscreen else win.show()

    if args.shot:
        def grab():
            v = win.view
            img = win.grab().toImage() if args.ui else v.grabFramebuffer()
            n = grab.n = getattr(grab, "n", 0) + 1
            path = args.shot if args.burst <= 1 else args.shot.replace(".png", f"_{n}.png")
            img.save(path)
            if args.burst > 1:
                small = img.scaled(64, 36).convertToFormat(img.Format.Format_Grayscale8)
                mean = sum(small.pixelColor(x, y).red() for x in range(64) for y in range(36)) / (64 * 36)
                print(f"frame {n}: mean brightness {mean:.0f}/255")
                if n < args.burst:
                    QTimer.singleShot(70, grab)
                    return
            print(f"shot saved: {args.shot} {img.width()}x{img.height()} fps={v.fps:.0f} "
                  f"bpm={v.bpm:.1f} status={v.status} beats={v.seen_beats}")
            win.close()
        QTimer.singleShot(int(args.after * 1000), grab)
    rc = app.exec()
    win.audio.stop()
    return rc
