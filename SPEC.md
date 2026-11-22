# Cuniculus — spec

Audio visualizer inspired by Sonique (Win98/XP era). "Cuniculus" = Latin for rabbit / burrow / tunnel. Name confirmed by user 2026-11-21: just "Cuniculus", no "Obscurus".

## Idea
The user's favourite Sonique visualizer was the **rabbit hole**: you travel down a tunnel while colors and shapes move with different frequencies and the BPM. Rebuild that, but **highly modernized and flashy** compared to the original.

## Decisions (confirmed with user, 2026-11-21)
- **Footprint:** standalone resizable window. F11 toggles fullscreen. Small control strip that only appears on mouse hover/move.
- **Audio source:** system output via PipeWire monitor capture (works with Spotify, YouTube, games). No built-in player needed.
- **Scope v1:** the tunnel visualizer **plus a plugin system** so more visualizers can be added as separate files.
- **Look:** modern and flashy, not retro. GPU shaders, bloom, glow, particles, smooth motion.
- **Stack (chosen):** Python + PyQt6 QOpenGLWidget + GLSL 4.10 shaders, numpy for FFT, `pw-record` subprocess for capture. No extra dependencies.

## Tunnel behaviour (design goals)
- Constant forward travel; speed eases with overall energy.
- Bass drives pulse/camera push and tunnel-wall flex.
- Mids drive shape/ring patterns and rotation.
- Highs drive sparkle, particles, fine detail.
- Beat/BPM detection locks flashes, color shifts and ring spawns to the beat.
- Color palettes cycle and can be picked by the user.
- Must stay smooth (60 fps+) on the user's GPU.

## Plugin system
- Each visualizer is a self-contained plugin file/folder loaded at startup, with hot-reload if cheap.
- Plugins receive per-frame audio data: waveform, FFT bands, beat flag, BPM estimate, time.
- Ship the tunnel as the first plugin through the same API, so the API is proven.
- Switch visualizers from the hover control strip or with keys.

## Open questions for the user
- Extra v1 visualizers beyond the tunnel (none required).
- Whether to also offer a wallpaper-layer mode later.

## Process notes
- Confirm footprint before building anything big (see memory: confirm-footprint).
- Show design options as rendered HTML mock-ups, never ASCII.
- Do not run sudo from installers; print the command instead.

## Status (2026-11-21): v0.1 built
- Working: capture from default sink monitor, spectrum/bass/mid/high, beat + BPM, HDR + bloom pipeline,
  Rabbit Hole and Nova plugins, live shader reload, hover control strip, 7 palettes, settings saved.
- Tested with `--demo` (124 BPM signal reads 124) and live audio; 120 fps at 1280x720 on the RX 9070 XT.
- Not tested yet: fullscreen at native resolution by the user, long sessions, music without a clear kick.
- Test helper: `./run.sh --demo --shot out.png --after 5 [--ui]`.
