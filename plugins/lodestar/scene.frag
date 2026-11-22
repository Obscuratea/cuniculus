// Lodestar - a liquid-metal (ferrofluid) star floating in a nebula.
//
// The star has icosahedral symmetry, which gives three families of spikes:
//   12 big spikes  = bass      20 medium spikes = mids      30 small spikes = highs
// Each spike family follows its own band, so a kick visibly punches the 12 big spikes out and lets
// them sink back. Every kick also sends a ring across the spectrum disk and a shock shell out from
// the star. The disk and the camera turn with the tempo. At full energy (a drop) two plasma jets
// fire from the poles. Nothing is allowed to flash the whole frame.

#define TAU 6.28318530718
#define PI 3.14159265359

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash21(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx + 33.33); return fract((q.x+q.y)*q.z); }
float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
// two rotated lookups per octave hide the square look of value noise
float fbm(vec2 p){
    const mat2 M = mat2(1.62, 1.18, -1.18, 1.62);
    const mat2 R = mat2(.78, .63, -.63, .78);
    float a = .5, s = 0.0;
    for (int i = 0; i < 5; i++){ s += a*.5*(vnoise(p) + vnoise(R*p*1.13 + 3.7)); p = M*p + 7.1; a *= .5; }
    return s;
}

// icosahedral fold (after knighty): maps any direction into one fundamental wedge
const float CP = 0.80901699437;                       // cos(pi/5)
const float SCP = 0.30901699437;                      // sqrt(0.75 - CP*CP)
const vec3 NC = vec3(-0.5, -CP, SCP);
const vec3 PAB = vec3(0.0, 0.0, 1.0);
const vec3 PBC = vec3(0.52573111, 0.0, 0.85065081);   // normalize(SCP, 0, 0.5)
const vec3 PCA = vec3(0.0, 0.35682209, 0.93417236);   // normalize(0, SCP, CP)
vec3 fold(vec3 p){
    for (int i = 0; i < 5; i++){ p.xy = abs(p.xy); p -= 2.0*min(0.0, dot(p, NC))*NC; }
    return p;
}

float gSpin, gR;
vec3 gH;      // spike heights: bass, mid, high
vec3 gK;      // spike sharpness

vec3 spikes(vec3 n){
    vec3 f = fold(n);
    return vec3(exp(-gK.x*(1.0 - dot(f, PBC))), exp(-gK.y*(1.0 - dot(f, PCA))), exp(-gK.z*(1.0 - dot(f, PAB))));
}

vec3 orbSpace(vec3 p){
    p.xz *= rot(gSpin);
    p.xy *= rot(gSpin*.61 + .4);
    return p;
}

float orb(vec3 p){
    p = orbSpace(p);
    float r = length(p);
    vec3 n = p/max(r, 1e-4);
    vec3 s = spikes(n);
    float h = dot(s, gH);
    h += .012*sin(n.y*38.0 - iTime*4.0)*uLevel;                 // liquid ripples
    return (r - gR - h)*.5;
}

vec3 orbNormal(vec3 p){
    const vec2 e = vec2(.0025, -.0025);
    return normalize(e.xyy*orb(p + e.xyy) + e.yyx*orb(p + e.yyx) + e.yxy*orb(p + e.yxy) + e.xxx*orb(p + e.xxx));
}

// nebula + stars; also what the metal reflects
vec3 sky(vec3 d, float detail){
    vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
    vec2 q = vec2(cos(sp.x), sin(sp.x))*1.6 + vec2(0.0, sp.y*2.2);       // seamless around the horizon
    q += .35*vec2(fbm(q*1.3 + uTravel*.03), fbm(q*1.3 - uTravel*.025 + 4.0));
    float n = fbm(q*1.6 + vec2(0.0, uTravel*.02));
    vec3 c = palette(n*.9 + sp.y*.15 + iTime*.015) * pow(n, 3.6) * (.10 + .30*uEnergy*uLevel);
    c += palette(n*.5 + .5) * pow(fbm(q*3.1 - 9.0), 5.0) * .35;
    if (detail > 0.5){
        vec2 g = vec2(sp.x*40.0, sp.y*40.0);
        vec2 id = floor(g), f = fract(g) - .5;
        float h = hash21(id);
        float tw = .4 + .6*sin(iTime*(1.5 + 6.0*h) + h*90.0);
        c += vec3(1.0, .95, .9) * step(.93, h) * smoothstep(.09, .0, length(f + (hash21(id + 3.1) - .5)*.6))
             * (.35 + tw*2.5*uHigh);
    }
    return c;
}

// spectrum disk in the plane y = 0
vec3 disk(vec3 P, float I){
    float r = length(P.xz);
    float a = atan(P.z, P.x)/TAU + uBeatClock/16.0;
    const float N = 180.0;
    float cell = (floor(a*N) + .5)/N;
    float band = abs(fract(cell*2.0)*2.0 - 1.0);                 // spectrum mirrored, twice around
    float s = spectrum(band*.85 + .01);
    float r0 = 2.15, len = .12 + s*s*2.2*min(I, 1.5);
    float gap = smoothstep(.5, .3, abs(fract(a*N) - .5));
    float bar = smoothstep(r0 - .02, r0, r) * smoothstep(r0 + len + .03, r0 + len, r) * gap;
    vec3 c = palette(band*.6 + r*.07 + iTime*.03) * bar * (.035 + .10*s + (.5 + 1.6*s)*smoothstep(.10, .0, r0 + len - r));   // dim body, bright cap
    // fine grooves, like a record
    float groove = smoothstep(.06, .0, abs(fract(r*5.0 - uBeatClock*.25) - .5) - .42);
    c += palette(r*.11 + .4) * groove * .05 * smoothstep(8.0, 2.0, r) * smoothstep(2.0, 2.2, r);
    // beat ring: thin, expanding, fading
    for (int j = 0; j < 4; j++){
        float age = uOnsetAge[j];
        if (age > 1.6) continue;
        float rs = 1.6 + age*8.0;
        c += palette(uOnsetId[j]*.137) * exp(-(r - rs)*(r - rs)*140.0) * 1.3 * uOnsetPow[j] * exp(-age*2.6) * smoothstep(1.9, 2.2, r);
    }
    return c * smoothstep(11.0, 6.0, r);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float I = uIntensity;

    float bassB = uBass;
    gSpin = uTravel*.05 + iTime*.05;
    gR = .76 + .07*uBass + .06*uKick;
    gH = vec3(.05 + .80*bassB*bassB, .04 + .62*uMid*uMid, .02 + .50*uHigh*uHigh) * mix(.6, 1.15, clamp(I*.5, 0.0, 1.0));
    gH.x += .22*uKick;
    gK = vec3(34.0, 70.0, 150.0) * (1.0 + .5*uLevel);            // louder = sharper needles

    // camera orbits at the tempo: one lap every 64 beats, bobbing above and below the disk
    float ca = uBeatClock*TAU/64.0 + iTime*.02;
    float el = .34 + .22*sin(uBeatClock*TAU/48.0);
    float dist = 6.4 - .45*uBass - .5*uKick;
    vec3 ro = dist*vec3(cos(ca)*cos(el), sin(el), sin(ca)*cos(el));
    vec3 fw = normalize(-ro);
    vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
    vec3 up = cross(fw, rt);
    uv *= rot(.12*sin(uBeatClock*TAU/32.0));
    vec3 rd = normalize(fw*1.45 + uv.x*rt + uv.y*up);

    // march the star inside its bounding sphere
    float tOrb = -1.0;
    float b = dot(ro, rd), c0 = dot(ro, ro) - 2.3*2.3, disc = b*b - c0;
    if (disc > 0.0){
        float t = -b - sqrt(disc), tEnd = -b + sqrt(disc);
        for (int i = 0; i < 90; i++){
            float d = orb(ro + rd*t);
            if (d < .0015){ tOrb = t; break; }
            t += d;
            if (t > tEnd) break;
        }
    }

    vec3 col = vec3(0.0);
    float orbMask = 0.0;
    if (tOrb > 0.0){
        orbMask = 1.0;
        vec3 p = ro + rd*tOrb;
        vec3 n = orbNormal(p);
        vec3 po = orbSpace(p);
        vec3 s = spikes(normalize(po));
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        vec3 rf = reflect(rd, n);
        // black chrome: mostly reflection, stronger at grazing angles
        col = sky(rf, 0.0) * (1.5 + 6.0*fres);
        // the disk lights the underside / reflects in the metal
        if (rf.y*p.y < 0.0){
            float td = -p.y/rf.y;
            col += disk(p + rf*td, I) * (.35 + .65*fres);
        }
        // thin-film sheen
        col += palette(fres*1.3 + length(po)*.6 + iTime*.05) * fres * (.25 + .5*uLevel);
        // hot tips: each family glows in its own colour when its part of the music is loud
        vec3 lv = vec3(bassB, uMid, uHigh);
        vec3 tip = pow(s, vec3(3.0)) * lv * lv;
        col += (palette(.02 + iTime*.02)*tip.x*2.4 + palette(.36 + iTime*.02)*tip.y*2.2 + palette(.70 + iTime*.02)*tip.z*2.6) * min(I, 1.6);
    } else {
        col = sky(rd, 1.0);
        // corona hugging the star, breathing with the bass
        float bp = length(cross(ro, rd));
        col += palette(iTime*.04 + .1) * exp(-max(bp - gR, 0.0)*2.6) * (.05 + .3*uBass);
        // shock shells: each kick blows a thin sphere of light outward
        for (int j = 0; j < 4; j++){
            float age = uOnsetAge[j];
            if (age > 1.2) continue;
            float rs = gR + .3 + age*4.5;
            col += palette(uOnsetId[j]*.137 + .5) * exp(-(bp - rs)*(bp - rs)*400.0) * .6 * uOnsetPow[j] * exp(-age*3.5);
        }
    }

    // plasma jets from the poles, only at full energy; they flicker with the highs
    {
        float jets = smoothstep(.72, .95, uEnergy);
        if (jets > 0.0){
            // closest approach between the view ray and the vertical axis through the star
            vec2 o = ro.xz, d2 = rd.xz;
            float tj = -dot(o, d2)/max(dot(d2, d2), 1e-5);
            float dj = length(o + d2*tj);
            float yj = ro.y + rd.y*tj;
            if (tj > 0.0 && (tOrb < 0.0 || tj < tOrb || abs(yj) > gR)){
                float along = abs(yj);
                float wj = .03 + .05*along;
                float flick = .6 + .4*sin(along*9.0 - iTime*14.0) * (.4 + .6*uHigh);
                col += mix(palette(.55 + along*.1), vec3(1.0), .3) * exp(-dj*dj/(wj*wj)) * smoothstep(gR*.7, gR + .4, along)
                       * exp(-along*.33) * jets * flick * (.5 + .7*uKick + .4*uBass) * min(I, 1.5);
            }
        }
    }

    // disk, in front of or behind the star
    if (abs(rd.y) > 1e-4){
        float td = -ro.y/rd.y;
        if (td > 0.0 && (tOrb < 0.0 || td < tOrb)) col += disk(ro + rd*td, I);
    }

    // swirling feedback: the previous frame spirals outward, leaving galaxy arms behind bright things
    vec2 pc = fragCoord/iResolution.xy - .5;
    pc.x *= iResolution.x/iResolution.y;
    pc = pc * rot(.010 + .012*uBass + .012*uKick) * (.984 - .014*uKick);
    pc.x *= iResolution.y/iResolution.x;
    vec3 prev = min(texture(uPrev, pc + .5).rgb, vec3(2.0));
    col += prev * mix(.30 + .06*uLevel, .06, orbMask);

    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .3*max(lum - 1.0, 0.0));
    fragColor = vec4(col, 1.0);
}
