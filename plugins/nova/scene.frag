// Nova - radial spectrum burst. Short on purpose: copy this folder to start your own plugin.

#define TAU 6.28318530718

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float r = length(uv);
    float a = atan(uv.y, uv.x)/TAU + .5;
    a = fract(a + iTime*.02);

    // spectrum bars around a circle, mirrored so it is seamless and the same on opposite sides
    const float N = 96.0;
    float cell = (floor(a*N) + .5)/N;
    float band = abs(fract(cell*2.0)*2.0 - 1.0);   // spectrum twice around, so opposite sides match
    float sp = spectrum(band*.85);
    float base = .16 + .05*uBass + .03*uBeat;
    float len = sp*.30*uIntensity;
    float gap = smoothstep(.5, .32, abs(fract(a*N) - .5));
    float bar = smoothstep(base - .004, base, r) * smoothstep(base + len + .004, base + len, r) * gap;
    vec3 col = palette(band*.7 + iTime*.05) * bar * (.3 + 1.1*sp);

    // waveform ring inside the bars
    float wr = base - .035 + wave(a)*.03*(1.0 + uLevel);
    col += palette(a + iTime*.1) * .0016/(abs(r - wr)*abs(r - wr) + .00006) * .05*(1.0 + 2.0*uLevel);

    // core that thumps on the beat
    col += palette(uBeatCount*.13) * exp(-r*r*160.0) * (.25 + 1.0*uBeat + .4*uBass);

    // rays flying outward: sample the previous frame slightly closer to the centre
    vec2 puv = (fragCoord/iResolution.xy - .5)*(.965 - .02*uBeat) + .5;
    col += min(texture(uPrev, puv).rgb, vec3(2.0)) * (.50 + .08*uLevel);

    // soft limiter so loud passages cannot white out the frame
    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .35*max(lum - .9, 0.0));

    fragColor = vec4(col, 1.0);
}
