// Rabbit Hole - Cuniculus' main visualizer.
// Bass: tunnel breathes, camera pushes in.   Mids: floating neon rings.
// Highs: glitter.   Spectrum: the wall panels.   Kick: a ring of light racing ahead, a speed surge and
// a colour step; the tunnel changes shape every 16 kicks.   Light trails and galaxy dust streams weave down the middle.
// Rule: nothing may flash the whole screen. Keep the walls dark enough to see the hole.

#define TAU 6.28318530718
#define FAR 70.0

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash11(float p){ p = fract(p*.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p){ vec3 q = fract(vec3(p.xyx)*.1031); q += dot(q, q.yzx + 33.33); return fract((q.x+q.y)*q.z); }

float hash31(vec3 p){ p = fract(p*.1031); p += dot(p, p.zyx + 31.32); return fract((p.x+p.y)*p.z); }

vec2 path(float z){
    return vec2(sin(z*.19)*1.5 + sin(z*.071)*2.6, cos(z*.153)*1.2 + sin(z*.057)*2.0);
}

float ngon(vec2 p, float n){
    float s = TAU/n;
    float a = mod(atan(p.y, p.x) + s*.5, s) - s*.5;
    return length(p)*cos(a);
}

// cross-section "radius" of the tunnel: circle, hexagon, square, pentagon
float metric(vec2 p, float id){
    id = mod(id, 4.0);
    if (id < 0.5) return length(p);
    if (id < 1.5) return ngon(p, 6.0);
    if (id < 2.5) return ngon(p, 4.0);
    return ngon(p, 5.0);
}

float gSec, gMorph;

// long-exposure light trails: pairs of lines that swerve around the tunnel like tail lights
vec2 trail(float z, float k){
    float pair = floor(k*.5), side = mod(k, 2.0) - .5;
    float a = z*.21 + pair*2.6 + sin(z*.12 + pair*2.3 + iTime*.25)*1.5;
    float r = 1.0 + .45*sin(z*.29 + pair*4.1 - iTime*.4);
    vec2 dir = vec2(cos(a), sin(a));
    return r*dir + side*.13*vec2(-dir.y, dir.x);
}

// centre of a galaxy dust ribbon spiralling down the tunnel
vec2 ribbon(float z, float k){
    float th = z*.15 + k*3.14159 + iTime*.12;
    return (1.2 + .3*sin(z*.21 + k*1.9))*vec2(cos(th), sin(th));
}

vec2 tunnelUV(vec3 p){
    vec2 q = p.xy - path(p.z);
    return q * rot(p.z*.07 + sin(p.z*.045)*.8);
}

float wall(vec3 p){
    vec2 q = tunnelUV(p);
    float r = mix(metric(q, gSec - 1.0), metric(q, gSec), gMorph);
    float R = 2.0 + .22*uBass*sin(p.z*1.1 - iTime*5.0) + .12*uBass;
    return R - r;
}

// floating neon ring nearest to p; returns distance, id in 'rid'
float ring(vec3 p, out float rid){
    float zc = (floor(p.z/5.0) + .5)*5.0;
    rid = zc;
    float h = hash11(zc*.37);
    vec3 l = p - vec3(path(zc), zc);
    l.xy *= rot(iTime*(h - .5)*1.6 + zc);
    float n = floor(h*4.0);
    float m = n < 1.0 ? length(l.xy) : ngon(l.xy, n + 2.0);
    float rad = .75 + .45*uMid + .2*spectrum(.1 + h*.5) + .15*uKick;
    return length(vec2(m - rad, l.z)) - .015;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord){
    vec2 uv = (fragCoord - .5*iResolution.xy) / iResolution.y;
    float I = uIntensity;

    gSec = floor(uKickCount/16.0);
    gMorph = smoothstep(0.0, 1.0, clamp(mod(uKickCount, 16.0) + min(uOnsetAge.x*2.5, 1.0), 0.0, 1.0));

    // camera rides the tunnel's centre line
    float cz = uTravel;
    vec3 ro = vec3(path(cz), cz);
    vec3 ta = vec3(path(cz + 3.0), cz + 3.0);
    vec3 fw = normalize(ta - ro);
    vec3 rt = normalize(cross(vec3(0, 1, 0), fw));
    vec3 up = cross(fw, rt);
    vec2 suv = uv * rot(sin(iTime*.21)*.5 + sin(uTravel*.043)*.7);
    float focal = .78 - (.10*uBass + .14*uKick)*min(I, 1.5);
    vec3 rd = normalize(fw*focal + suv.x*rt + suv.y*up);

    // march: solid wall, translucent glowing rings
    float t = 0.0, d = 0.0;
    vec3 glow = vec3(0.0);
    bool hit = false;
    for (int i = 0; i < 80; i++){
        vec3 p = ro + rd*t;
        d = wall(p);
        if (d < .002*(1.0 + t)){ hit = true; break; }
        float rid;
        float dr = ring(p, rid);
        float st = min(d*.8, max(dr, .04));
        vec3 rc = palette(rid*.031 + iTime*.04 + .35 + uKickCount*.09);
        glow += rc * st * .010/(.0015 + dr*dr) * exp(-t*.045) * mix(.08, 1.0, smoothstep(.8, 6.0, t));
        t += st;
        if (t > FAR) break;
    }

    vec3 col = vec3(0.0);
    vec3 p = ro + rd*t;
    if (hit){
        vec2 q = tunnelUV(p);
        float a = atan(q.y, q.x)/TAU + .5;
        const float NA = 28.0;
        vec2 g = vec2(a*NA, p.z*1.25);
        vec2 cell = floor(g), f = fract(g);
        float band = abs((cell.x + .5)/NA*2.0 - 1.0);            // mirrored left/right
        float sp = spectrum(band*.82 + .02);
        float h = hash21(cell);
        float lit = smoothstep(h*.6 + .42, h*.6 + .54, sp);       // panel lights when its band is loud enough
        float inner = smoothstep(.0, .07, f.x)*smoothstep(1.0, .93, f.x)
                    * smoothstep(.0, .09, f.y)*smoothstep(1.0, .91, f.y);
        vec3 pc = palette(band*.55 + p.z*.018 + iTime*.03);
        col = pc * lit * inner * (.15 + .8*sp*sp) * min(I, 1.3);
        col += pc * inner * .02;                                  // faint unlit panel
        col += palette(p.z*.02 + .5 + uKickCount*.09) * (1.0 - inner) * (.04 + .30*uMid + .25*uKick);   // seams

        // beat shockwave racing ahead of the camera
        // (starts well ahead and stays thin, so it never lights the walls around the camera)
        for (int j = 0; j < 4; j++){
            float age = uOnsetAge[j];
            if (age > 1.6) continue;
            float w = p.z - cz - 4.0 - age*46.0;
            col += palette(uOnsetId[j]*.137 + .1) * exp(-w*w*3.0) * 2.2 * uOnsetPow[j] * exp(-age*2.2);
        }

        // pulse line travelling with the bass
        float pl = fract(p.z*.125 - iTime*.6);
        col += pc * smoothstep(.05, .0, abs(pl - .5)) * uBass * .7;
    }
    float fog = exp(-t*.05);
    col = col*fog + palette(iTime*.05 + .3)*(1.0 - fog)*(.015 + .08*uLevel);
    col += glow * (.18 + .75*uMid*uMid + .35*uKick) * min(I, 1.5);

    // light trails + galaxy streams, sampled along the ray up to the wall
    vec3 streams = vec3(0.0);
    float tmax = min(t, 46.0);
    float jit = hash21(fragCoord);
    const int NS = 52;
    for (int i = 0; i < NS; i++){
        float x0 = (float(i) + jit)/float(NS);
        float ts = tmax*x0*x0;
        float dts = tmax*2.0*x0/float(NS);
        vec3 s = ro + rd*ts;
        vec2 q = s.xy - path(s.z);
        float fade = exp(-ts*.055) * smoothstep(.4, 4.0, ts);
        for (int k = 0; k < 4; k++){
            float fk = float(k);
            float dl = length(q - trail(s.z, fk));
            float w = .008 + dts*.15;
            float pulse = .5 + .5*sin(s.z*.45 - iTime*(2.5 + floor(fk*.5)*1.7) + fk);
            vec3 tc = palette(floor(fk*.5)*.5 + s.z*.012 + iTime*.03 + .15);
            streams += tc * dts * (.0022/(dl*dl + w*w)) * (.35 + .65*pulse) * fade;
        }
        for (int k = 0; k < 2; k++){
            float fk = float(k);
            float dh = length(q - ribbon(s.z, fk));
            float dens = exp(-dh*dh*4.5);
            vec3 gc = palette(s.z*.02 + fk*.37 + .6);
            float wisp = .55 + .45*sin(s.z*1.7 + dh*9.0 + fk*3.0)*sin(s.z*.63 - iTime*.5);
            streams += gc * dens * wisp * dts * .09 * fade;
            vec3 gp = vec3(q*15.0, s.z*3.0);
            float h = hash31(floor(gp) + fk*17.0);
            vec3 gf = fract(gp) - .5;
            float tw = pow(.5 + .5*sin(iTime*(3.0 + 9.0*h) + h*50.0), 5.0);
            float star = step(.82, h) * smoothstep(.42, .05, length(gf)) * tw;
            streams += mix(gc, vec3(1.0), .65) * dens * star * dts * 5.0 * fade * (.4 + 2.5*uHigh);
        }
    }
    col += streams * (.28 + .45*uLevel + .25*uKick) * min(I, 1.6);

    // the light at the end of the hole
    vec3 endDir = normalize(vec3(path(cz + 30.0), cz + 30.0) - ro);
    float e = max(dot(rd, endDir), 0.0);
    col += palette(iTime*.07) * (pow(e, 260.0)*(.5 + 1.6*uKick + .5*uBass) + pow(e, 14.0)*.04*(1.0 + uLevel));


    // sparks streaking past, driven by the highs
    float ang = atan(uv.y, uv.x)/TAU, rad = length(uv);
    for (int i = 0; i < 3; i++){
        float n = 70.0 + float(i)*41.0;
        float ca = floor(ang*n);
        float h = hash11(ca + float(i)*19.0);
        float rr = fract(h*7.0 + uTravel*(.10 + .12*h));
        rr = rr*rr*1.4;
        float da = abs(fract(ang*n) - .5);
        float s = exp(-pow((rad - rr)/(.01 + .09*rr), 2.0)) * smoothstep(.3, .0, da) * step(.84, h);
        col += palette(h + iTime*.1) * s * rr * (uHigh*uHigh*1.2);
    }

    // zooming feedback trail
    vec2 puv = (fragCoord/iResolution.xy - .5)*(.972 - .02*uBass) + .5;
    vec3 prev = min(texture(uPrev, puv).rgb, vec3(2.0));
    col += prev * (.14 + .08*uLevel);

    // soft limiter: bright things stay bright, but the frame as a whole cannot white out
    float lum = dot(col, vec3(.3, .6, .1));
    col *= 1.0/(1.0 + .3*max(lum - 1.0, 0.0));

    fragColor = vec4(col, 1.0);
}
