# Cuniculus

A music visualizer for whatever your system is playing, inspired by the rabbit-hole
tunnel from Sonique. *Cuniculus* is Latin for rabbit and for burrow.

- Listens to system output through PipeWire. No player, no setup.
- **Rabbit Hole**: a twisting neon tunnel. Wall panels are the spectrum, rings follow the
  mids, sparks follow the highs, every beat fires a shockwave, and the tunnel changes
  shape every 16 beats.
- **Lodestar**: a liquid-metal star whose spikes are the bass, mids and highs, ringed by a
  spectrum disk that turns in time with the tempo.
- **Cymatica**: glowing sand on a vibrating Chladni plate. Bass, mids and highs each
  shake out their own figure and the sand migrates between them; beats throw it in the air.
- **Fiesta**: fireworks over a city and a lake. A shell goes up every second beat (rings,
  hearts, stars, willows), the skyline is the spectrum, the highs rain confetti.
- **Nova**: a small radial spectrum burst, and the example plugin to copy.
- Visualizers are plugins: a folder with one shader file. See [PLUGINS.md](PLUGINS.md).

## Run

    ./run.sh            # system audio
    ./run.sh --demo     # built-in test beat, no sound needed
    ./install.sh        # adds Cuniculus to the app launcher (no sudo)

## Requirements

- **PipeWire** with the `pw-record` command (default on Fedora, Ubuntu 22.10+, Debian 12+, Arch).
  Audio capture is built on it, so PulseAudio-only systems will not work.
- **Python 3.9+**, **PyQt6** (with its OpenGL widget) and **numpy**. On Arch: `python-pyqt6`,
  `python-numpy`. Other distros name these differently, and PyQt6 is sometimes only on pip.
- **A GPU and driver with OpenGL 4.1 core** and 16-bit float render targets. Any AMD, Nvidia or
  Intel GPU from roughly the last 10 years qualifies.
- X11 or Wayland, any desktop. There is no desktop-specific code.

**Tested on:** CachyOS, KDE Plasma on Wayland, AMD RX 9070 XT. Other setups should work but
have not been tried. The heavier visualizers (Rabbit Hole, Lodestar) are tuned for a strong GPU
and will run slower on a modest one.

There is no distro package yet; for now clone the folder and run `./run.sh`.

## Controls

Move the mouse to show the control strip.

| Key | Action |
|---|---|
| F11, F, double-click | fullscreen |
| Left / Right | previous / next visualizer |
| P / Shift+P | next / previous colour palette |
| R | rescan plugins |
| Q | quit |
