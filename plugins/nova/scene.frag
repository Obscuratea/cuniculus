// Nova - radial spectrum burst. Short on purpose: copy this folder to start your own plugin.

#define TAU 6.28318530718

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float r = length(uv);
    float a = atan(uv.y, uv.x)/TAU + .5;
    a = fract(a + uBeatClock/64.0);                      // turns with the tempo, stops with the music

    // spectrum bars around a circle, mirrored so it is seamless and the same on opposite sides
    const float N = 96.0;
    float cell = (floor(a*N) + .5)/N;
    float band = abs(fract(cell*2.0)*2.0 - 1.0);   // spectrum twice around, so opposite sides match
    float sp = spectrum(band*.85);
    float base = .16 + .04*uBass + .05*uKick;
    float len = sp*.30*min(uIntensity, 1.3);
    float gap = smoothstep(.5, .32, abs(fract(a*N) - .5));
    float bar = smoothstep(base - .004, base, r) * smoothstep(base + len + .004, base + len, r) * gap;
    vec3 col = palette(band*.7 + iTime*.05) * bar * (.3 + 1.1*sp);

    // waveform ring inside the bars
    float wr = base - .035 + wave(a)*.03*(1.0 + uLevel);
    col += palette(a + iTime*.1) * .0016/(abs(r - wr)*abs(r - wr) + .00006) * .05*(1.0 + 2.0*uLevel);

    // core that thumps on the beat
    col += palette(uKickCount*.13) * exp(-r*r*190.0) * (.15 + .8*uKick + .2*uBass);

    // every kick sends a thin ring out through the bars
    for (int j = 0; j < 4; j++){
        float age = uOnsetAge[j];
        if (age > 1.5) continue;
        float rk = base + age*.75;
        col += palette(uOnsetId[j]*.13 + .2) * exp(-(r - rk)*(r - rk)*5000.0) * .55 * uOnsetPow[j] * exp(-age*3.2);
    }

    // sparks beyond the bar tips for the highs
    float sc = floor(a*N);
    float sh = fract(sin(sc*91.7 + floor(iTime*14.0)*7.3)*43758.5);
    col += palette(band + .5) * step(1.0 - .5*uHigh*uHigh, sh) * gap
           * exp(-pow((r - base - len - .035)/.012, 2.0)) * 1.4;

    // rays flying outward: sample the previous frame slightly closer to the centre
    vec2 puv = (fragCoord/iResolution.xy - .5)*(.965 - .03*uKick) + .5;
    col += min(texture(uPrev, puv).rgb, vec3(2.0)) * (.50 + .08*uLevel);

    // soft limiter so loud passages cannot white out the frame
    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .5*max(lum - .8, 0.0));

    fragColor = vec4(col, 1.0);
}
