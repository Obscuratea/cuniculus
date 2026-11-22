# Writing a Cuniculus plugin

A plugin is a folder with two files. Put it in `~/.config/cuniculus/plugins/<your-id>/`
(or in `plugins/` in this repo). Press **R** in the app to rescan. Saving the shader
reloads it live; compile errors show in the window and the last good version keeps running.

`plugins/nova` is the small example to copy.

## plugin.json

```json
{
  "name": "My Visual",
  "author": "you",
  "description": "One line shown as a tooltip.",
  "shader": "scene.frag",
  "bloom": 0.8,
  "aberration": 1.0,
  "order": 50
}
```

`bloom` is glow strength, `aberration` scales the colour fringing on beats, `order` sorts the list.

## scene.frag

GLSL 4.10 fragment code, Shadertoy style. Define:

```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord)
```

Write linear HDR colour; values above 1.0 are what blooms. The host adds bloom,
colour fringing, tonemapping, vignette and grain afterwards.

| Name | Type | Meaning |
|---|---|---|
| `iResolution` | vec3 | size in pixels |
| `iTime`, `iTimeDelta` | float | seconds since start, last frame time |
| `iFrame` | int | frame counter |
| `uBass`, `uMid`, `uHigh` | float | 0..1, below 150 Hz, 150 Hz to 2 kHz, above 2 kHz |
| `uLevel` | float | 0..1 overall loudness (auto-gained, so volume does not matter) |
| `uBeat` | float | jumps to 1 on each beat, decays to 0 |
| `uBeatCount` | float | number of beats so far |
| `uBeatPhase` | float | 0..1 position between beats from the BPM clock |
| `uBeatClock` | float | beats elapsed as a smooth number; use it to move or spin things at the tempo |
| `uBpm` | float | tempo estimate, 0 if unknown |
| `uTravel` | float | distance that grows faster when the music is louder |
| `uIntensity` | float | the user's intensity slider, 0.2..2.0 |
| `uPrev` | sampler2D | your previous frame, for trails and feedback |
| `spectrum(x)` | float | 0..1 level at x in 0..1 (30 Hz to 16 kHz, log scale) |
| `wave(x)` | float | -1..1 waveform sample at x in 0..1 |
| `palette(t)` | vec3 | the user's chosen colour palette; use it so the palette switch works |
