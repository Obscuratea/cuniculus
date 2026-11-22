// Cymatica - glowing sand on a vibrating Chladni plate.
//
// Like a real Chladni plate, the pattern depends on the frequency: low sounds make a few big
// shapes, higher sounds make finer and finer lattices, and as the pitch of the music slides the
// lines morph smoothly from one figure to the next (uPitch picks a point in a ladder of plate
// modes and blends the two neighbours). Every bass hit throws grains off the lines into the air,
// where they fly in a real arc and fall back onto the plate.

#define PI 3.14159265359
#define TAU 6.28318530718
#define G 120.0            // grains per plate radius
#define GRAV 3.4
#define NM 14

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash21(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx + 33.33); return fract((q.x+q.y)*q.z); }

// plate modes ordered from low to high frequency (n, m, sign)
const vec3 MODES[NM] = vec3[NM](
    vec3(1.,2.,-1.), vec3(1.,3.,1.), vec3(2.,3.,-1.), vec3(1.,4.,1.), vec3(2.,5.,-1.),
    vec3(3.,4.,1.), vec3(3.,5.,-1.), vec3(2.,7.,1.), vec3(4.,5.,-1.), vec3(3.,7.,1.),
    vec3(4.,7.,-1.), vec3(5.,6.,1.), vec3(5.,8.,-1.), vec3(6.,8.,1.));

float chladni(vec2 p, vec3 m){
    float a = cos(m.x*PI*p.x)*cos(m.y*PI*p.y), b = cos(m.y*PI*p.x)*cos(m.x*PI*p.y);
    return (a + m.z*b)*.5;
}

vec3 gA, gB;
float gF, gWidth;

float field(vec2 p){ return mix(chladni(p, gA), chladni(p, gB), gF); }

// sand lies where the plate stays still
float sandDensity(vec2 p){ float f = field(p); return exp(-(f*f)/(gWidth*gWidth)); }

vec2 jitterOf(vec2 cell){ return vec2(hash21(cell + 7.1), hash21(cell + 3.3)) - .5; }

// height of the grain in this cell above the plate: 0 if it is resting
float airAlt(vec2 cell){
    for (int j = 0; j < 4; j++){
        float age = uOnsetAge[j];
        if (age > 2.0) continue;
        float pw = uOnsetPow[j];
        float id = uOnsetId[j];
        if (hash21(cell*1.7 + id*13.1) > .02 + .13*pw) continue;
        float v = (.7 + 1.0*hash21(cell + 3.7 + id*5.3))*(.55 + .65*pw);
        float z = v*age - .5*GRAV*age*age;
        if (z > 0.0) return z;
    }
    return 0.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float I = uIntensity;

    // pitch picks a point on the ladder of modes; the two neighbours are blended
    float u = clamp(uPitch, 0.0, 1.0)*float(NM - 1) - 1e-3;
    int i0 = int(floor(u));
    gA = MODES[i0];
    gB = MODES[min(i0 + 1, NM - 1)];
    gF = smoothstep(0.0, 1.0, fract(u));
    gWidth = .022 + .012*(1.0 - uLevel) + .035*uBeat;

    // camera looks down at the plate, rocking with the tempo and leaning in on the bass
    float el = 1.0 + .12*sin(uBeatClock*TAU/16.0);
    float dist = 3.1 - .12*uBass;
    vec3 ro = dist*vec3(.18*sin(uBeatClock*TAU/32.0), sin(el), -cos(el));
    vec3 fw = normalize(-ro);
    vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(fw*1.55 + uv.x*rt + uv.y*up);

    // the plate turns slowly; work in its frame
    float spin = uBeatClock*TAU/32.0 + uTravel*.015;
    mat2 R = rot(spin);
    vec2 roxz = R*ro.xz, rdxz = R*rd.xz;
    vec3 rop = vec3(roxz.x, ro.y, roxz.y);
    vec3 rdp = vec3(rdxz.x, rd.y, rdxz.y);

    vec3 pal = palette(.06 + .8*uPitch + iTime*.012);
    vec3 col = vec3(0.0);
    float onPlate = 0.0;
    float rr = 2.0;

    if (rd.y < 0.0){
        vec3 P = rop + rdp*(-rop.y/rdp.y);
        vec2 q = P.xz;
        rr = length(q);
        if (rr < 1.0){
            onPlate = 1.0;
            float f0 = field(q);
            float brushed = .5 + .5*sin(rr*260.0 + hash21(floor(q*40.0))*2.0);
            col = vec3(.010, .011, .014)*(1.0 + .4*brushed);
            col += pal * abs(f0) * (.006 + .07*uBass) * min(I, 1.5);

            // resting sand grains
            vec2 gc = q*G;
            vec2 cell = floor(gc);
            float h = hash21(cell);
            vec2 jit = jitterOf(cell);
            vec2 gp = (cell + .5 + jit*.6)/G;
            float dens = sandDensity(gp);
            float dotD = length(fract(gc) - .5 - jit*.6*.5);
            float grain = step(1.0 - dens*.95, h) * smoothstep(.42, .12, dotD);
            if (airAlt(cell) > 0.0) grain = 0.0;               // it is in the air right now
            float tw = pow(.5 + .5*sin(iTime*(3.0 + 9.0*h) + h*60.0), 6.0);
            vec3 gcol = mix(pal, vec3(1.0, .97, .9), .35 + .3*h);
            col += gcol * grain * (.55 + .9*uLevel + 2.2*tw*uHigh) * min(I, 1.6);

            // soft glow along the nodal lines
            col += pal * exp(-(f0*f0)/(gWidth*gWidth*6.0)) * (.015 + .07*uLevel) * min(I, 1.5);
            // the bolt in the middle that drives the plate, and the rim
            col += pal * smoothstep(.035, .022, rr) * (.12 + .7*uBeat);
            col += pal * smoothstep(.02, .0, abs(rr - .985)) * (.25 + .8*uBass + .8*uBeat);
            col *= smoothstep(1.0, .985, rr) + smoothstep(.02, .0, abs(rr - .985));
        }
        col += palette(iTime*.02 + .3) * exp(-max(rr - 1.0, 0.0)*4.0) * (1.0 - onPlate) * (.02 + .06*uLevel);

        // grains in flight: walk the ray's ground track, one grain-cell at a time, from the plate
        // up to the highest a grain can climb, and test the grains found there against the ray
        if (uOnsetAge.x < 2.0){
            float best = 0.0;
            const int S = 64;
            for (int k = 0; k < S; k++){
                float z = .004 + float(k)*(.80/float(S));
                vec3 Pk = rop + rdp*((rop.y - z)/(-rdp.y));
                if (dot(Pk.xz, Pk.xz) > 1.0) continue;
                vec2 cell = floor(Pk.xz*G);
                float alt = airAlt(cell);
                if (alt < .003) continue;
                vec2 c = (cell + .5 + jitterOf(cell)*.6)/G;
                vec3 gp = vec3(c.x, alt, c.y);
                float d = length(cross(rdp, gp - rop));
                if (d > .0075) continue;
                if (hash21(cell) < 1.0 - sandDensity(c)*.95) continue;   // only grains that were sand
                float hot = smoothstep(.0075, .002, d);
                best = max(best, hot*(.7 + .6*smoothstep(.0, .35, alt)));
            }
            col += mix(pal, vec3(1.0, .97, .9), .6) * best * 2.6 * min(I, 1.6);
        }
    }

    // afterglow: moving sand and tossed grains leave a short trace
    vec2 puv = fragCoord/iResolution.xy;
    col += min(texture(uPrev, puv).rgb, vec3(2.0)) * (.30 + .08*uLevel) * (.5 + .5*onPlate);

    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .3*max(lum - 1.0, 0.0));
    fragColor = vec4(col, 1.0);
}
