// Cymatica - glowing sand on a vibrating Chladni plate.
//
// A metal plate shaken at a resonance gathers sand along its nodal lines (the parts that stay
// still). Here three layers of plate modes are mixed: simple shapes for the bass, finer ones
// for the mids, intricate ones for the highs. Whichever part of the music is loudest pulls the
// sand towards its pattern, so the figure keeps migrating. Every 8 beats new modes are picked,
// every beat throws the sand up, and the plate turns at the tempo.

#define PI 3.14159265359
#define TAU 6.28318530718

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx + 33.33); return fract((q.x+q.y)*q.z); }

// square-plate Chladni mode: zero along the nodal lines
float chladni(vec2 p, vec3 m){
    float a = cos(m.x*PI*p.x)*cos(m.y*PI*p.y), b = cos(m.y*PI*p.x)*cos(m.x*PI*p.y);
    return (a + m.z*b)*.5;
}

// mode (n, m, sign) for a layer in a given 8-beat section
vec3 pickMode(float section, float layer){
    float h1 = hash11(section*7.31 + layer*13.7), h2 = hash11(section*3.17 + layer*5.9 + 1.0);
    float n, m;
    if (layer < .5)      { n = 1.0 + floor(h1*2.0); m = n + 1.0 + floor(h2*2.0); }   // bass: broad shapes
    else if (layer < 1.5){ n = 2.0 + floor(h1*3.0); m = n + 2.0 + floor(h2*3.0); }   // mids
    else                 { n = 4.0 + floor(h1*3.0); m = n + 3.0 + floor(h2*4.0); }   // highs: intricate
    return vec3(n, m, hash11(section + layer*2.3) < .5 ? -1.0 : 1.0);
}

float gMorph, gSec;
vec3 gW;   // layer weights

float layerField(vec2 p, float layer){
    return mix(chladni(p, pickMode(gSec - 1.0, layer)), chladni(p, pickMode(gSec, layer)), gMorph);
}

float field(vec2 p){
    float f = gW.x*layerField(p, 0.0) + gW.y*layerField(p, 1.0) + gW.z*layerField(p, 2.0);
    return f / (gW.x + gW.y + gW.z);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float I = uIntensity;

    gSec = floor(uBeatCount/8.0);
    gMorph = smoothstep(0.0, 1.0, clamp(mod(uBeatCount, 8.0) + 1.0 - uBeat, 0.0, 1.0));
    // the loudest band dominates; the small floor keeps a pattern on screen in quiet parts
    gW = vec3(.12 + pow(uBass, 2.0)*1.6, .08 + pow(uMid, 2.0)*1.4, .05 + pow(uHigh, 2.0)*1.5);

    // camera looks down at the plate, rocking with the tempo and leaning in on the bass
    float el = 1.0 + .12*sin(uBeatClock*TAU/16.0);
    float dist = 3.1 - .12*uBass;
    vec3 ro = dist*vec3(.18*sin(uBeatClock*TAU/32.0), sin(el), -cos(el));
    vec3 fw = normalize(-ro);
    vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(fw*1.55 + uv.x*rt + uv.y*up);

    vec3 col = vec3(0.0);
    float onPlate = 0.0;
    if (rd.y < 0.0){
        vec3 P = ro + rd*(-ro.y/rd.y);
        vec2 q = P.xz * rot(uBeatClock*TAU/32.0 + uTravel*.015);
        float r = length(q);
        if (r < 1.0){
            onPlate = 1.0;
            vec3 pal = palette(.08 + .3*gW.y/(gW.x+gW.y+gW.z) + .6*gW.z/(gW.x+gW.y+gW.z) + iTime*.015);

            // brushed plate, faintly lit where it vibrates hardest (antinodes)
            float f0 = field(q);
            float brushed = .5 + .5*sin(r*260.0 + hash21(floor(q*40.0))*2.0);
            col = vec3(.010, .011, .014)*(1.0 + .4*brushed);
            col += pal * abs(f0) * (.006 + .07*uBass) * min(I, 1.5);

            // sand grains: each cell holds one grain that settles if the plate is still there
            const float G = 120.0;
            vec2 gc = q*G;
            vec2 cell = floor(gc);
            float h = hash21(cell);
            vec2 jitter = vec2(hash21(cell + 7.1), hash21(cell + 3.3)) - .5;
            // on the beat grains are thrown off their lines, then resettle as uBeat decays
            vec2 gp = (cell + .5 + jitter*.6)/G + jitter*.07*uBeat*min(I, 1.2);
            float fg = field(gp);
            float width = .022 + .012*(1.0 - uLevel) + .05*uBeat;
            float dens = exp(-(fg*fg)/(width*width));
            float dotD = length(fract(gc) - .5 - jitter*.6*.5);
            float grain = step(1.0 - dens*.95, h) * smoothstep(.42, .12, dotD);
            float tw = pow(.5 + .5*sin(iTime*(3.0 + 9.0*h) + h*60.0), 6.0);
            vec3 gcol = mix(pal, vec3(1.0, .97, .9), .35 + .3*h);
            col += gcol * grain * (.55 + .9*uLevel + 2.2*tw*uHigh) * min(I, 1.6);

            // soft glow along the nodal lines
            col += pal * exp(-(f0*f0)/(width*width*6.0)) * (.015 + .07*uLevel) * min(I, 1.5);

            // bolt in the middle that drives the plate
            col += pal * smoothstep(.035, .022, r) * (.12 + .7*uBeat);

            // rim
            col += pal * smoothstep(.02, .0, abs(r - .985)) * (.25 + .8*uBass + .8*uBeat);
            col *= smoothstep(1.0, .985, r) + smoothstep(.02, .0, abs(r - .985));
        }
        // light spill on the floor around the plate
        col += palette(iTime*.02 + .3) * exp(-max(r - 1.0, 0.0)*4.0) * (1.0 - onPlate) * (.02 + .06*uLevel);
    }

    // afterglow: sand leaves a trace while it migrates between figures
    vec2 puv = fragCoord/iResolution.xy;
    col += min(texture(uPrev, puv).rgb, vec3(2.0)) * (.30 + .08*uLevel) * (.5 + .5*onPlate);

    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .3*max(lum - 1.0, 0.0));
    fragColor = vec4(col, 1.0);
}
