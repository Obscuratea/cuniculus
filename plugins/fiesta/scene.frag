// Fiesta - fireworks over a city and a lake.
//
// Every kick explodes a shell at that instant, sized by how hard it hit; each has its own spot,
// colour and shape (sphere, ring, heart, star, willow). Snares and claps pop small crackles.
// Searchlights sweep from the skyline when the track is at full energy. The skyline is the spectrum: buildings grow with
// their frequency band and their windows light up when it is loud. The moon bounces on the bass,
// the highs rain confetti, and the lake reflects it all. Nothing flashes the whole sky.

#define TAU 6.28318530718
const float HOR = -.18;

float hash11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx + 33.33); return fract((q.x+q.y)*q.z); }

// shape of one particle's offset: returns a unit-ish direction for shape type t
vec2 shapeDir(float type, float a, float j, float seed){
    vec2 d = vec2(cos(a), sin(a));
    if (type < 1.0) return d*(.35 + .65*sqrt(hash11(j*3.7 + seed)));                 // round burst
    if (type < 2.0) return d;                                                        // ring
    if (type < 3.0){                                                                  // heart
        float s = sin(a), c = cos(a);
        return vec2(s*s*s, (13.0*c - 5.0*cos(2.0*a) - 2.0*cos(3.0*a) - cos(4.0*a))/16.0 + .1) * .95;
    }
    if (type < 4.0) return d*(.55 + .45*cos(5.0*a));                                  // five-point star
    return d*(.3 + .7*hash11(j*1.9 + seed));                                          // willow
}

// one burst: N sparks thrown from 'apex' in shape 'type', 't' seconds ago
vec3 burst(vec2 p, vec2 apex, float t, float S, float type, float seed, vec3 c1, vec3 c2){
    float grow = 1.0 - exp(-t*4.5);
    float life = type > 3.5 ? 1.2 : .85;                     // willows hang around longer
    float fade = exp(-t/life*2.2);
    float reach = S*1.5 + .2 + .3*t*t;
    float dc = length(p - apex);
    if (fade < .02 || dc > reach) return vec3(0.0);
    fade *= smoothstep(0.0, .06, t) * smoothstep(reach, reach*.6, dc);      // no pile-up at the start, no hard edge
    vec3 col = c2 * exp(-t*16.0) * .0003/(dc*dc + .002);                    // soft flash at the centre
    const int N = 34;
    for (int j = 0; j < N; j++){
        float fj = float(j);
        float a = fj/float(N)*TAU + seed*6.0;
        vec2 off = shapeDir(type, a, fj, seed)*S*grow;
        float g = type > 3.5 ? .30 : .09;
        vec2 pos = apex + off + vec2(0.0, -g*t*t);
        float d = length(p - pos);
        float tw = .55 + .45*sin(t*38.0 + fj*7.0 + seed*30.0);
        tw = mix(tw, tw*tw*2.0, uHigh);                       // highs make it glitter
        vec3 pc = mix(c1, c2, step(.5, hash11(fj + seed*9.0)));
        col += pc*fade*tw*.00010/(d*d + .000006);
    }
    return col;
}

// Fireworks burst ON the music: every bass hit (kick) explodes a shell right then, sized by how hard
// it hit. Lighter hits (snares, claps) pop small crackles. Nothing is launched on a timer.
vec3 fireworks(vec2 p, float I){
    vec3 col = vec3(0.0);
    for (int k = 0; k < 4; k++){
        float age = uOnsetAge[k];
        if (age > 2.2) continue;
        float id = uOnsetId[k], pw = uOnsetPow[k];
        float h1 = hash11(id*1.37), h2 = hash11(id*2.91 + 4.0), h3 = hash11(id*5.13 + 9.0);
        float h4 = hash11(id*7.77 + 2.0), h5 = hash11(id*3.31 + 6.0);
        vec2 apex = vec2((h1 - .5)*1.5, HOR + .24 + .40*h2);
        float S = (.10 + .10*h3 + .12*pw)*(.8 + .2*min(I, 1.5));
        col += burst(p, apex, age, S, floor(h4*5.0), h1 + id, palette(h5), palette(h5 + .33 + .3*h3)) * (.5 + .7*pw);
        // the streak it rode up on, still fading
        float sx = abs(p.x - apex.x - .01*sin(p.y*40.0));
        col += mix(vec3(1.0, .8, .5), palette(h5), .5) * exp(-sx*sx*9000.0) * step(HOR, p.y) * step(p.y, apex.y)
               * smoothstep(HOR, apex.y, p.y) * exp(-age*7.0) * .5;
    }
    // crackle: any other onset (snare, clap, hat accent) pops a small cluster
    {
        float id = uBeatCount;
        vec2 apex = vec2((hash11(id*4.1) - .5)*1.6, HOR + .15 + .5*hash11(id*9.7 + 1.0));
        float t = -log(max(uBeat, 1e-3))/5.0;                 // uBeat = exp(-5 t)
        col += burst(p, apex, t, .05 + .03*hash11(id), 0.0, id*.37, vec3(1.0, .9, .7), palette(hash11(id*2.3))) * .55 * uBeat;
    }
    return col*min(I, 1.6);
}

// festival searchlights from the skyline: sweep at the tempo, only bright when the track is at full energy
vec3 searchlights(vec2 p, float I){
    float on = smoothstep(.65, .92, uEnergy);
    if (on <= 0.0 || p.y < HOR) return vec3(0.0);
    vec3 col = vec3(0.0);
    for (int i = 0; i < 4; i++){
        float fi = float(i);
        vec2 o = vec2((fi - 1.5)*.42, HOR + .02);
        float ang = .9*sin(uBeatClock*TAU/8.0 + fi*1.7) * (mod(fi, 2.0) < .5 ? 1.0 : -1.0);
        vec2 d = vec2(sin(ang), cos(ang));
        vec2 r = p - o;
        float along = dot(r, d);
        if (along < 0.0) continue;
        float perp = abs(r.x*d.y - r.y*d.x);
        float w = .004 + .035*along;
        col += palette(fi*.25 + uKickCount*.09) * exp(-perp*perp/(w*w)) * exp(-along*1.6) * (.10 + .22*uKick + .08*uBass);
    }
    return col*on*min(I, 1.5);
}

// the moon, bouncing on the bass
vec3 moon(vec2 p, vec2 ctr){
    float r = .055*(1.0 + .10*uBass + .10*uKick);
    vec2 q = p - ctr - vec2(0.0, .012*uBass);
    float d = length(q);
    vec3 c = vec3(.95, .93, .8)*smoothstep(r, r - .004, d)*.38;
    c *= .75 + .25*smoothstep(.02, .05, length(q - vec2(.015, .012)));              // a soft crater
    return c + vec3(.9, .85, .6)*exp(-max(d - r, 0.0)*22.0)*.025*(1.0 + uLevel);
}

vec3 city(vec2 p, vec3 sky){
    float w = .07;
    float bi = floor(p.x/w);
    float cx = (bi + .5)*w;
    float aspect = iResolution.x/iResolution.y;
    float X = cx/aspect + .5;
    float band = abs(fract(X*2.0)*2.0 - 1.0);
    float sp = spectrum(band*.85 + .01);
    float hgt = .03 + .045*hash11(bi*3.3) + sp*.2*min(uIntensity, 1.5);
    float top = HOR + hgt;
    if (p.y > top || p.y < HOR) return sky;
    float rel = (p.y - HOR);
    vec2 cell = vec2(floor(p.x/w*3.0), floor(rel/.022));
    vec2 f = vec2(fract(p.x/w*3.0), fract(rel/.022));
    float win = step(.28, f.x)*step(f.x, .72)*step(.3, f.y)*step(f.y, .8);
    float hw = hash21(cell + bi);
    float lit = smoothstep(hw*.85, hw*.85 + .12, sp + .12);
    vec3 wc = mix(palette(.1 + hw*.5), vec3(1.0, .9, .65), .45);
    vec3 col = vec3(.008, .009, .016) + palette(.7)*.012*smoothstep(0.0, hgt, rel);   // faint rim light at the base
    col += wc*win*lit*(.35 + .9*sp);
    col += palette(.4)*smoothstep(.006, .0, top - p.y)*.18*(.3 + sp);                  // lit rooftops
    return col;
}

vec3 scene(vec2 p, float I){
    float up = clamp((p.y - HOR)/(.5 - HOR), 0.0, 1.0);
    vec3 col = mix(palette(.65)*(.018 + .03*uLevel), vec3(.003, .004, .010), pow(up, .5));
    float aspect = iResolution.x/iResolution.y;
    // stars
    vec2 g = p*vec2(90.0, 90.0);
    vec2 id = floor(g), f = fract(g) - .5;
    float h = hash21(id);
    float tw = .4 + .6*sin(iTime*(1.0 + 4.0*h) + h*80.0);
    col += vec3(.9, .95, 1.0)*step(.965, h)*smoothstep(.12, .0, length(f))*tw*.6*smoothstep(.0, .25, up);
    col += moon(p, vec2(-.3*aspect*1.45, .29));
    col += searchlights(p, I);
    col += fireworks(p, I);
    return city(p, col);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float I = uIntensity;
    vec3 col;
    if (uv.y >= HOR){
        col = scene(uv, I);
    } else {
        // lake: mirrored scene, rippled, darker and bluer with distance from the shore
        float dep = HOR - uv.y;
        float rip = sin(uv.y*90.0 + iTime*1.6 + uv.x*5.0)*.0022*(1.0 + 3.0*dep) + sin(uv.y*37.0 - iTime*1.1)*.0015;
        vec2 rp = vec2(uv.x + rip*(1.0 + uBass), HOR + dep);
        col = scene(rp, I)*(.5*exp(-dep*2.5) + .04) + palette(.55)*.004;
        col += vec3(.7, .8, 1.0)*pow(.5 + .5*sin(uv.x*220.0 + uv.y*60.0 + iTime*2.0), 14.0)*.01*(uHigh + .2);   // glints
    }

    // confetti raining on the highs
    for (int i = 0; i < 3; i++){
        float sc = 22.0 + float(i)*13.0;
        vec2 q = uv*sc + vec2(0.0, uTravel*(.35 + .2*float(i)));
        q.x += sin(q.y*.7 + float(i)*2.0)*.6;
        vec2 cid = floor(q), cf = fract(q) - .5;
        float ch = hash21(cid + float(i)*17.0);
        float onN = step(.975 - .03*uHigh, ch);
        float flap = abs(sin(iTime*(2.0 + 5.0*ch) + ch*40.0));
        float piece = step(abs(cf.x), .14)*step(abs(cf.y), .06*flap + .01);
        col += palette(ch*3.0 + iTime*.04)*piece*onN*(.10 + .45*uHigh);
    }

    // trails: last frame drifts down a touch, so bursts leave glowing streaks
    vec2 puv = fragCoord/iResolution.xy + vec2(0.0, .0012);
    vec3 prev = min(texture(uPrev, puv).rgb, vec3(1.5));
    col += prev*(.50 + .05*uLevel)*step(HOR, uv.y + .002);

    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .35*max(lum - .9, 0.0));
    fragColor = vec4(col, 1.0);
}
