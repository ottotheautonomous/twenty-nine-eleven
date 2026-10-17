// SPDX-License-Identifier: 0BSD
// GPGPU particle lattice for Sentinel (raw WebGL2). Lifted from the Twenty Nine
// Eleven kit, 04-particles/particles.js, and changed: homes are uploaded from
// shape.js instead of seeded; state is an offset from home (so half floats keep
// precision); a third MRT attachment carries the cascaded proximity response,
// the warm term and the build; the spring weakens under the trail; morphing removed.
import { createProgram, bindTex, FULLSCREEN_VS } from './gl.js';
import { LAG, HAND, RESET, EMBER_LIGHT, FORM, COLORS, linearRGB, DBG } from './constants.js';
import { FLOW, FLOW_GLSL } from './flow.js';

const COL_COOL = linearRGB(COLORS.mid);   // FORM's cool far tint (a negative FORM.tint): the base palette's mid silver

const SIM_FS = (noiseSrc) => noiseSrc + FLOW_GLSL + `   // (the union SDF, sdf.glsl, is no longer compiled in: since the flow each grain is pulled to its own tube analytically)
in vec2 vUv;
uniform sampler2D uOff, uVel, uAux, uHome, uFluid, uTrail;
uniform mat4 uViewProj, uView;
uniform vec3 uCamRight, uCamUp, uLightDir;
uniform float uTime, uRatio, uK06;
uniform float uBuild, uOpen, uFlinch, uTight, uIdle, uPresent;
uniform vec3 uProbeRaw, uPokeVel, uHandDir;   // raw probe on the centre plane; its world velocity (R/s, |v| <= 4); the view ray through it
uniform float uPoke, uShove, uDrag;    // raw pointer speed 0..1 (0.15 s tail); impulse gains
uniform vec3 uHand;                    // reach across the ray (R), far side's share, per-particle spread
uniform vec3 uReset; uniform float uKick;   // the resync front: (radius R, amp, band sigma); kick toward home as it passes
uniform float uFluidPush, uSwirl, uSwirlFreq, uSpring, uAttract, uFriction, uSpeedLerp, uWrap, uBound, uTubeR;   // uTubeR: the attract-free tube's radius (R)
uniform vec4 uVRes; uniform vec3 uVResA;       // PROTOTYPE living verbs: Resolve (front rad, band phase, on, crest), its anchor
layout(location = 0) out vec4 oOff;            // xyz offset from home, w = wrap-diffuse lighting
layout(location = 1) out vec4 oVel;            // xyz, w = smoothed speed
layout(location = 2) out vec4 oAux;            // d1, d2 (cascaded displacement), warm, built
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 Hm = texelFetch(uHome, c, 0), O = texelFetch(uOff, c, 0), V = texelFetch(uVel, c, 0), A = texelFetch(uAux, c, 0);
  int kf = int(Hm.w); vec3 home = flowHome(Hm.xyz, kf); float r = fract(Hm.w);
  vec3 p = home + O.xyz, v = V.xyz;

  // Build-inward front: expands from the ember outward in screen space, noise-perturbed.
  vec3 hv = (uView * vec4(home, 1.0)).xyz;
  float s = clamp(length(hv.xy), 0.0, 1.0) + 0.12 * r;
  float built = smoothstep(s - 0.08, s, 1.2 * uBuild);

  // Proximity: the lattice notices the probe, through two cascaded lerps (90 % in 1.05 s).
  // Proximity measures from the raw probe; the softness lives in the cascade alone (90 % in 0.6 s).
  float prox = uPresent * (1.0 - smoothstep(0.35, 1.2, distance(p, uProbeRaw))) * (0.5 + 0.3 * sin(uTime + r * 12.34) * r);
  float idle = uIdle * 0.2 * (0.5 + 0.5 * sin(-2.0 * uTime + home.x)) * (0.5 + 0.5 * cos(-uTime)) * mix(0.5, 2.0, r);
  float target = max(idle, prox);
  float d1 = mix(A.x, target, uK06), d2 = mix(A.y, d1, uK06);

  float scale = mix(1.35, 1.0, built) * (1.0 + 0.06 * uOpen + 0.12 * d2 + 0.06 * uFlinch);
  vec3 homeT = home * scale;

  vec4 clip = uViewProj * vec4(p, 1.0);
  vec2 suv = clip.xy / max(clip.w, 1e-4) * 0.5 + 0.5;
  bool on = clip.w > 0.0 && all(greaterThan(suv, vec2(0.0))) && all(lessThan(suv, vec2(1.0)));
  vec2 f = on ? texture(uFluid, suv).xy : vec2(0.0);
  float trail = on ? texture(uTrail, suv).r : 0.0;
  float fl = length(f);
  // The resync front (after the hand stops): a ring leaving the ember across the visible disc (view-space radius of the
  // home, like the build front: a sphere around the core would cross the shell everywhere at once and only flash);
  // particles are kicked home as it passes and the breach stops weakening the spring behind it. amp 0 = nothing.
  float rs = length(hv.xy), dfr = rs - uReset.x;
  float wave = uReset.y * exp(-dfr * dfr / (uReset.z * uReset.z));
  float behind = uReset.y * (1.0 - smoothstep(uReset.x - 0.25, uReset.x, rs));

  // 0 the hand: an instant, velocity-weighted shove where the pointer moves. Measured across the view ray through the raw
  //   probe (which sits on the centre plane, inside the shell), so the face under the hand feels it; the far side gets
  //   uHand.y and stays coherent. A still hand (poke 0) adds exactly nothing.
  vec3 dp = p - uProbeRaw; float along = dot(dp, uHandDir);                                      // < 0: the near face
  vec3 dq = dp - uHandDir * along; float dd = max(length(dq), 1e-3);
  float hk = 1.0 - smoothstep(0.0, uHand.x, dd); hk *= hk * mix(1.0, uHand.y, smoothstep(-0.2, 0.2, along));
  // poke squared: below saturation a slower pass dwells longer under the hand (dwell ~ 1/speed, poke ~ speed), so a
  // linear poke would shove a reading-speed pass as far as a brisk one. Squared, only brisk passes scatter.
  float hand = uPoke * uPoke * hk * (1.0 + uHand.z * (2.0 * r - 1.0));                           // spread: neighbours part as sparks
  v += (dq / dd) * hand * uShove * uRatio;                                                       // in the view plane, away from the pointer
  v += uPokeVel * hand * uDrag * uRatio;                                                         // along the hand's motion
  v += (uCamRight * f.x + uCamUp * f.y) * uFluidPush * uRatio;                                   // 1 fluid push (the tear)
  vec3 n = BitangentNoise4D(vec4((Hm.xyz + p - home) * uSwirlFreq, uTime * (1.0 + 0.7 * r)));   // the noise rides with the grain along its ring
  float vCoh = uVRes.z > 0.0 ? smoothstep(0.0, 0.6, uVRes.x - acos(clamp(dot(normalize(home), uVResA), -1.0, 1.0))) : 0.0;   // PROTOTYPE Resolve: noise settles
  v += n * uSwirl * (1.0 - 0.5 * uTight) * (1.0 - 0.35 * vCoh) * (0.7 + 0.3 * r) * uRatio;      // 2 swirl
  v += (homeT - p) * uKick * wave * uRatio;                                                     // the front kicks it home
  float k = uSpring * (1.0 + 0.3 * uTight) * built * (1.0 - 0.65 * min(fl, 1.0)) * (1.0 - 0.7 * trail * (1.0 - behind));
  v += (homeT - p) * k * uRatio;                                                                 // 3 spring
  // The grain's OWN tube (analytic): distance and normal from the nearest point of its ring's circle (radius = scale),
  // so flowing grains at crossings aren't captured by the crossing ring.
  vec3 nW = uFlowAx[kf]; float hN = dot(p, nW); vec3 pr = p - nW * hN; float rho = max(length(pr), 1e-6);
  vec3 dv = p - pr * (scale / rho); float dl = max(length(dv), 1e-6);
  float d = dl - uTubeR * scale;                                                                 // inside the tube the grain wanders free
  vec3 nrm = dv / dl;
  if (d > 0.0) v -= nrm * uAttract * built * (0.7 + 0.3 * r) * uRatio;                           // 4 attraction to its own tube

  v *= uFriction;
  v = clamp(v, vec3(-0.5), vec3(0.5));
  p += v * uRatio;
  float len = length(p); if (len > uBound) p *= uBound / len;

  float diff = max((dot(nrm, uLightDir) + uWrap) / (1.0 + uWrap), 0.0);
  float inside = d < 0.0 ? mix(0.35, 1.0, smoothstep(-0.12, 0.0, d)) : 1.0;
  float warm = max(dot(nrm, -normalize(p + vec3(1e-5))), 0.0) * 0.6 * (1.0 - smoothstep(0.35, 0.75, length(hv.xy)));   // warm: no longer read by the renderer (the ember's light is per fragment now); kept so the sim is unchanged

  oOff = vec4(p - home, diff * inside);
  oVel = vec4(v, mix(V.w, length(v), uSpeedLerp));
  oAux = vec4(d1, d2, warm, built);
}`;

// FORM (FORM-SPEC 2, the block after the depth tone): the see-through cage reads as one 3D form, front in front. By the grain's real
// view position (home + offset), z its depth from the sphere's centre (R, +1 front pole), d = 0 front pole .. 1 back pole: the far fade
// 1 - far d^curve; the smoked glass exp(-smoke L), L the view ray's path inside the unit sphere in front of the grain (0 on the front
// hemisphere, the chord behind, fading to 0 at the limb: no seam); the rim (off); vFTint the far tint (RENDER_FS: toward the ember tone,
// or COLORS.mid when negative, at equal luminance, before the trail and fast terms so the breach rim stays silver). uView[3].xyz is the
// sphere's centre in view space. On vBoost (colour) only: the alpha, the eclipse's coverage, never sees it. Test builds: uFormMode
// 0 all / 1 front only / 2 back only / 3 the depth-mirrored cage (split captures). GLSL comments ship in the bundle: kept short.
export const RENDER_VS = FLOW_GLSL + `
uniform float uDepthTone;
uniform sampler2D uOff, uVel, uAux, uHome;
uniform mat4 uView, uProj;
uniform float uSizeK, uMaxPoint, uTime;
uniform vec3 uRing;          // (longitude, phase 0..1, amplitude)
uniform vec4 uTap;           // (x, y, z, t); t outside (0,1) = none
uniform float uSentry;       // idle sentry band phase 0..1; 0 = none
uniform vec3 uKey;           // key light direction (sentry band origin)
uniform vec3 uProbeRaw, uHandDir, uHand; uniform float uWake;   // the hand: instant light where it moves, ~0.85 s tail
uniform vec3 uReset;         // the resync front (radius R, amp, band sigma): the tap's own light, as a ring leaving the ember
uniform vec3 uEmberView;     // the ember, view space
uniform vec3 uEmberLit;      // (reach sigma R, depth-split softness R, 3D falloff radius R)
uniform vec2 uBead;          // the per-grain bead gain's range (lo, hi), eased with the grain count (webgl.js drawOpts)
uniform float uScatterR;     // the forward scatter's own view-plane reach (R), never the cast's
uniform vec4 uForm; uniform float uFormTint; out float vFTint;
${DBG ? 'uniform float uFormMode;' : ''}
// PROTOTYPE living verbs (LIVING-SPEC 4): the six row-2 signatures, light placed in home space; each block is uniform-gated
uniform vec3 uRingN[10], uRingE1[10], uRingE2[10];   // the ten great circles (world): normal and the frame of their along-ring angle
uniform vec4 uVRes; uniform vec3 uVResA;   // Resolve: (front rad, band phase, on, phone crest light), anchor
uniform vec4 uVAp;           // Aperture: (radius R, light, attention, on)
uniform vec4 uVCo[6];        // Compose: per edge (ring, a0, len, light); ring < 0 = none
uniform vec4 uVCoB;          // Compose: (bleed share of the edge light, bleed reach rad, on, -)
uniform vec4 uVTpL[3];       // Toolpath: per leg (ring, start angle, dir, len)
uniform vec4 uVTp;           // Toolpath: (head s rad, head light, tau ms, on)
uniform vec4 uVTpT;          // Toolpath: (plunge ms, dwell ms, feed rad/ms, legs)
uniform float uVEdL[10], uVEdS[10]; uniform float uVEd;   // Edit: per-ring light delta and grain size; on
uniform vec3 uTGlint, uTWhite, uTDawn;
out float vLight, vSpeed, vFade, vD2, vBuilt, vBoost, vGrow, vOcc, vEk, vLimb, vBead, vSk; out vec3 vToE; out vec4 vTint;
void main() {
  int w = textureSize(uHome, 0).x;
  ivec2 c = ivec2(gl_VertexID % w, gl_VertexID / w);
  vec4 Hm = texelFetch(uHome, c, 0), O = texelFetch(uOff, c, 0), V = texelFetch(uVel, c, 0), A = texelFetch(uAux, c, 0);
  int kf = int(Hm.w); vec3 home = flowHome(Hm.xyz, kf); float r = fract(Hm.w);
  vec3 p = home + O.xyz;
  vec4 vp = uView * vec4(p, 1.0);
  gl_Position = uProj * vp;

  vec3 pn = vec3(cos(uRing.x), 0.0, -sin(uRing.x));
  float planeD = abs(dot(home, pn));
  vec3 inPlane = normalize(home - pn * dot(home, pn) + vec3(1e-5));
  float ang = acos(clamp(dot(inPlane, vec3(0.0, -1.0, 0.0)), -1.0, 1.0));
  float ring = uRing.z * exp(-pow((ang - 3.14159265 * uRing.y) / 0.22, 2.0)) * exp(-pow(planeD / 0.10, 2.0));
  float tap = (uTap.w > 0.0 && uTap.w < 1.0) ? exp(-pow((distance(home, uTap.xyz) - 2.4 * uTap.w) / 0.14, 2.0)) * (1.0 - uTap.w) : 0.0;
  float sentry = uSentry > 0.0 ? 0.15 * exp(-pow((0.5 + 0.5 * dot(normalize(home), uKey) - (1.0 - uSentry)) / 0.08, 2.0)) : 0.0;
  float flick = r < 0.08 ? 0.6 + 0.4 * sin(0.8 * uTime + 97.0 * r) * sin(1.73 * uTime + 31.0 * r) : 1.0;
  // ---- PROTOTYPE living verbs ----
  float vAdd = 0.0, vMul = 1.0, vSz = 1.0; vec3 tRgb = vec3(0.0); float tW = 0.0;
  int rk = kf; float rth = 0.0;                        // the grain's own ring (exact, packed in home.w): a nearest-ring guess popped at crossings
  if (uVCoB.z > 0.0 || uVTp.w > 0.0 || uVEd > 0.0) rth = atan(dot(home, uRingE2[rk]), dot(home, uRingE1[rk]));   // its angle along the ring
  if (uVRes.z > 0.0) {         // Resolve: the twinkle falls into step behind a coherence front from the anchor; its mean is kept
    float gc = acos(clamp(dot(normalize(home), uVResA), -1.0, 1.0));
    float c = smoothstep(0.0, 0.6, uVRes.x - gc), band = sin(2.4 * gc - uVRes.y);
    if (r < 0.08) flick = 0.6 + 0.4 * mix(sin(0.8 * uTime + 97.0 * r) * sin(1.73 * uTime + 31.0 * r), band, c);
    else if (r < 0.22) vMul *= 1.0 + 0.4 * c * band;   // the set grows from 8 % to 22 %; new members twinkle about 1, so no light is added
    vAdd += uVRes.w * c * smoothstep(0.5, 1.0, band);   // phones only: the crests +0.12
  }
  if (uVAp.w > 0.0) {          // Aperture: a view-space ring closing on the ember; outside it the cage gives 6 % to the attention
    float rs = length((uView * vec4(home, 1.0)).xy - uEmberView.xy);
    float ap = uVAp.y * exp(-pow((rs - uVAp.x) / 0.05, 2.0)) * (1.0 - 0.5 * smoothstep(0.7, 1.0, rs)) * smoothstep(0.24, 0.3, rs);
    vAdd += ap; vMul *= 1.0 - uVAp.z * smoothstep(uVAp.x, uVAp.x + 0.08, rs);
  }
  if (uVCoB.z > 0.0) {         // Compose: one cell's edges, each lit whole at once; then light bleeds past its corners
    for (int i = 0; i < 6; i++) {
      vec4 e = uVCo[i];
      if (e.x < 0.0 || int(e.x + 0.5) != rk) continue;
      float u = mod(rth - e.y + 3.14159265, 6.2831853) - 3.14159265;        // along the edge from its first corner
      float inside = smoothstep(-0.025, 0.0, u) * smoothstep(e.z + 0.025, e.z, u);
      float out_ = max(-u, u - e.z), bl = out_ > 0.0 ? 1.0 - smoothstep(0.0, uVCoB.y, out_) : 0.0;
      float add = e.w * (inside + uVCoB.x * bl * bl * (1.0 - inside));
      vAdd += add; tRgb += uTGlint * add; tW += add;
    }
  }
  if (uVTp.w > 0.0) {          // Toolpath: a white-hot head at constant feed; the cut behind it holds and cools from dawn to silver
    float U = 0.0, tAt = uVTpT.x;
    for (int i = 0; i < 3; i++) {
      if (float(i) >= uVTpT.w) break;
      vec4 L = uVTpL[i];
      if (int(L.x + 0.5) == rk) {
        float u = mod(L.z * (rth - L.y) + 3.14159265, 6.2831853) - 3.14159265;
        if (u > -0.15 && u < L.w + 0.15) {
          float uu = U + u;
          float head = uVTp.y * exp(-pow((uu - uVTp.x) / 0.04, 2.0));
          float inLeg = smoothstep(-0.02, 0.0, u) * smoothstep(L.w + 0.02, L.w, u);
          float cut = 0.18 * inLeg * smoothstep(uVTp.x + 0.012, uVTp.x - 0.012, uu) * step(1e-3, uVTp.z - uVTpT.x);
          float age = uVTp.z - (tAt + clamp(u, 0.0, L.w) / uVTpT.z);
          float dawn = 1.0 - smoothstep(0.0, 500.0, age);
          vAdd += head + cut;
          tRgb += mix(uTDawn, uTWhite, exp(-pow((uu - uVTp.x) / 0.025, 2.0))) * head + uTDawn * (cut * dawn); tW += head + cut * dawn;
        }
      }
      tAt += L.w / uVTpT.z + uVTpT.y; U += L.w;
    }
  }
  if (uVEd > 0.0) { vMul *= 1.0 + uVEdL[rk]; vSz *= uVEdS[rk]; }   // Edit: six rings fall back, the four face-on rings gain a little
  vTint = tW > 0.0 ? vec4(tRgb / tW, clamp(tW / (1.0 + vAdd), 0.0, 1.0)) : vec4(0.0);

  float dfr = length((uView * vec4(home, 1.0)).xy) - uReset.x;          // the resync ring: view-space radius from the ember
  float wave = uReset.y * exp(-dfr * dfr / (uReset.z * uReset.z));
  float grow = 1.0 + 0.3 * (ring + tap + wave) + 0.12 * A.y;
  float size = uSizeK / max(-vp.z, 1e-3) * grow * vSz;                 // one size for all: per-particle grain clumped the tube into blobs
  gl_PointSize = clamp(size, 1.0, uMaxPoint);
  vFade = clamp(size * size, 0.0, 1.0) * flick;
  vec3 dp = p - uProbeRaw; float along = dot(dp, uHandDir);                  // the hand, measured across the view ray through the pointer
  float hk = 1.0 - smoothstep(0.0, 1.1 * uHand.x, length(dp - uHandDir * along)); hk *= hk * mix(1.0, uHand.y, smoothstep(-0.2, 0.2, along));
  float touch = uWake * hk;                                            // at most +HAND.glow boost (1.6): a brisk pass puts <= 4 bloom blocks over 0.8 (measured)
  vBoost = (1.0 + 1.5 * (ring + tap) + 0.25 * wave + sentry + touch + vAdd) * vMul;   // the resync ring crosses the dense limb: x0.25 keeps the wider tube to <= 3 bloom blocks
  // beads: a per-grain gain, skewed g^3 (mean 0.8 on every tier), so the wide 393k tube reads as a beaded ridge, not a soft band (a
  // uniform 0.5-1.7 spread barely moved the bead contrast). 393k: 0.2-2.6; the 32-131k tiers (phones, uhd) take a milder 0.45-1.85, or
  // their few bright grains stand apart as sand in a faint body. fract(r * 61.7): a second random. vBead: the same gain over its mean
  // (g^3 averages 1/4, so the mean is .75 lo + .25 hi): the eclipse's coverage weight (the beads block, the faint body barely does)
  { float g = fract(r * 61.7), bg = mix(uBead.x, uBead.y, g * g * g); vBoost *= bg; vBead = bg / (0.75 * uBead.x + 0.25 * uBead.y); }
  { float zf = (uView * vec4(normalize(home), 0.0)).z; vBoost *= 1.0 - uDepthTone * (1.0 - smoothstep(-0.9, 0.2, zf)); }   // depth tone: back hemisphere dims gently
  { vec3 cV = uView[3].xyz;${DBG ? `
    if (uFormMode > 2.5) { vp.z = 2.0 * cV.z - vp.z; gl_Position = uProj * vp; float s3 = uSizeK / max(-vp.z, 1e-3) * grow * vSz; gl_PointSize = clamp(s3, 1.0, uMaxPoint); vFade = clamp(s3 * s3, 0.0, 1.0) * flick; }` : ''}
    float z = vp.z - cV.z, d = clamp(0.5 - 0.5 * z, 0.0, 1.0), L = 0.0;${DBG ? `
    if ((uFormMode > 0.5 && uFormMode < 1.5 && z < 0.0) || (uFormMode > 1.5 && uFormMode < 2.5 && z >= 0.0)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);` : ''}
    if (uForm.z > 0.0) { float tg = length(vp.xyz); vec3 rd = vp.xyz / max(tg, 1e-4); float b = dot(rd, cV), disc = b * b - dot(cV, cV) + 1.0;
      if (disc > 0.0) { float sq = sqrt(disc); L = clamp(tg - (b - sq), 0.0, 2.0 * sq); } }
    float e = 1.0 - min(1.0, abs(z)); e *= e;
    vBoost *= (1.0 - uForm.x * pow(d, uForm.y)) * exp(-uForm.z * L) * (1.0 + uForm.w * e * e);
    vFTint = uFormTint * smoothstep(0.35, 1.0, d); }
  vGrow = grow;
  vLimb = mix(0.25, 1.0, smoothstep(0.1, 0.6, abs((uView * vec4(normalize(home), 0.0)).z)));   // 1 face-on .. 0.25 edge-on (the wide tube stacks there)
  // The ember sits inside the cage. Only particles NEARER than it cover it (alpha = coverage, read by the ember pass), soft across
  // +-split so a scattered particle crossing its depth never pops. It is also a point light: vToE the direction to it; vEk its reach,
  // a view-plane gaussian (the cage outside the halo stays silver) over a 3D falloff (at rest every strut is 1 R away; only a
  // scattered particle that comes close flares).
  vOcc = smoothstep(-uEmberLit.y, uEmberLit.y, vp.z - uEmberView.z);
  vec3 toE = uEmberView - vp.xyz; float dE = max(length(toE), 1e-4);
  vToE = toE / dE;
  vEk = exp(-dot(toE.xy, toE.xy) / (uEmberLit.x * uEmberLit.x)) / (1.0 + dE * dE / (uEmberLit.z * uEmberLit.z));
  vSk = exp(-dot(toE.xy, toE.xy) / max(uScatterR * uScatterR, 1e-6));
  vLight = O.w; vSpeed = V.w; vD2 = A.y; vBuilt = A.w;
}`;

export const RENDER_FS = `
in float vLight, vSpeed, vFade, vD2, vBuilt, vBoost, vGrow, vOcc, vEk, vLimb, vBead, vSk; in vec3 vToE; in vec4 vTint;
uniform vec3 uColDark, uColLight, uColFast, uEmberCol, uEmberHot, uLightView;
in float vFTint; uniform vec3 uColCool;
uniform vec3 uOccW;          // the eclipse's coverage: (optical density, share weighted by the bead gain, forward scatter gain)
uniform float uKeyWarm; uniform vec3 uTWarm;   // PROTOTYPE Key light: the lit side warms toward #FFEBD0
uniform float uIntensity, uWrapR, uEmberLevel, uEmberLight, uEngage, uDim;
uniform vec2 uFastRange, uBlurRange, uInvRes;
uniform sampler2D uTrail;
out vec4 o;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0; q.y = -q.y;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  vec3 n = vec3(q, sqrt(1.0 - r2));
  float diff = max((dot(n, uLightView) + uWrapR) / (1.0 + uWrapR), 0.0);
  float lit = vLight * (0.55 + 0.45 * diff);
  vec3 col = mix(uColDark, uColLight, lit);
  col = mix(col, uColFast, smoothstep(uFastRange.x, uFastRange.y, vSpeed));
  { const vec3 Y = vec3(0.2126, 0.7152, 0.0722); float l = dot(col, Y);   // PROTOTYPE living verbs: tone of the added light, luminance kept
    if (vTint.a > 0.0) col = mix(col, vTint.rgb * l / max(dot(vTint.rgb, Y), 1e-4), vTint.a);
    if (uKeyWarm > 0.0) col = mix(col, uTWarm * l / max(dot(uTWarm, Y), 1e-4), uKeyWarm * diff); }
  // the ember's light on the grain's sphere: behind the ember the face we see looks at it (a lit disc, brightest at its centre); in
  // front of it only the rim that points inward catches it (a back-lit edge) and the body over the core stays cold
  col += uEmberCol * (uEmberLight * uEmberLevel * vEk * max(dot(n, vToE), 0.0));
  if (uOccW.z > 0.0) col += uEmberHot * (uOccW.z * uEmberLevel * vOcc * vSk * pow(max(-vToE.z, 0.0), 2.0));   // forward scatter (off in round one)
  if (vFTint != 0.0) { const vec3 Yw = vec3(0.2126, 0.7152, 0.0722); vec3 tc = vFTint > 0.0 ? uEmberCol : uColCool;
    col = mix(col, tc * (dot(col, Yw) / max(dot(tc, Yw), 1e-4)), abs(vFTint)); }
  vec3 tr = texture(uTrail, gl_FragCoord.xy * uInvRes).rgb;
  float front = min(1.0, tr.g * 2.5 + tr.b * 0.25);                   // igloo's front channel: a bright head, x0.9 per frame, gone in ~20 frames
  col += uColFast * (front + tr.r * 0.1 * vLimb);                     // the breach rim brightens the lattice: the tear's head at full strength everywhere, its lingering light x0.1 and quieter edge-on; it does not scratch the ember
  col += uColFast * vD2 * vD2 * 0.8;
  float a = (1.0 - 0.35 * smoothstep(uBlurRange.x, uBlurRange.y, vSpeed)) * vFade * vBuilt;   // moved particles stay visible
  a *= 1.0 - smoothstep(0.75, 1.0, r2);
  float energy = pow(1.0 / vGrow, 1.5);
  // alpha: coverage by the particles NEARER than the ember only, as optical density x the grain's bead weight (a faint grain barely
  // covers, a bead saturates); the modal dim is applied once, in the composite
  o = vec4(col * a * uIntensity * vBoost * energy * (1.0 + 0.1 * uEngage), min(1.0, a * vOcc * uOccW.x * mix(1.0, vBead, uOccW.y)));
}`;

// The sim's and the draw's tuning (each renderer gets its own copy as particles.cfg, which the tune lab writes). Round one (the owner's
// tune link, 2026-10-16): the livelier swirl (.00016 at scale 6.5, with friction .92) and the finer grain (1.48 px), held to 4009e84's
// strand width by a tighter attract-free tube (.019 R; at .03 the swirl widened the strand 34 %); bound 1.8 R; intensity .032 (+17 %
// cage light over 4009e84; the link's .036 was the main bloom lever on fast swipes). Intensity x the bead gain's mean 0.8 at 393k.
export const PARTICLE_CFG = Object.freeze({
  fluidPush: 7e-4, spring: 1e-3, attract: 9e-4, speedLerp: 0.035, wrap: 0.18,
  swirl: 1.6e-4, swirlFreq: 6.5, friction: 0.92, bound: 1.8, tube: 0.019,
  sizePx: 1.48, intensity: 0.032, fastRange: [0.003, 0.005], blurRange: [0.002, 0.007],
});

export function createParticles(gl, caps, { noiseSrc, side = [256, 256], state32 = false, homes }) {
  const [W, H] = side;
  const fmt = state32 ? { internal: gl.RGBA32F, type: gl.FLOAT } : { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
  const P = {
    sim: createProgram(gl, caps, FULLSCREEN_VS, SIM_FS(noiseSrc)),
    render: createProgram(gl, caps, RENDER_VS, RENDER_FS),
  };
  const cfg = { ...PARTICLE_CFG, fastRange: [...PARTICLE_CFG.fastRange], blurRange: [...PARTICLE_CFG.blurRange], shove: HAND.shove, drag: HAND.drag };
  function tex(internal, type, data = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, W, H, 0, gl.RGBA, type, data);
    return t;
  }
  const homeTex = tex(gl.RGBA32F, gl.FLOAT, homes.subarray(0, W * H * 4));
  function mrt() {
    const t = [tex(fmt.internal, fmt.type), tex(fmt.internal, fmt.type), tex(fmt.internal, fmt.type)];
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    t.forEach((x, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, x, 0));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { off: t[0], vel: t[1], aux: t[2], fbo, ok };
  }
  let A = mrt(), B = mrt();
  const vao = gl.createVertexArray();
  let ringsSet = false;
  const ready = () => Object.values(P).every((p) => p.ready());
  function reset() {
    gl.disable(gl.BLEND);
    for (const S of [A, B]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo);
      for (let i = 0; i < 3; i++) gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // u: the uniforms object. rows: active prefix of the state texture.
  function step(ratio, time, cam, fluidTex, trailTex, u, rows = H, verbP = null) {
    if (!ready()) return false;
    const s = P.sim.uniforms;
    gl.disable(gl.BLEND);
    gl.useProgram(P.sim.program);
    gl.uniform1i(s.uOff, bindTex(gl, 0, A.off)); gl.uniform1i(s.uVel, bindTex(gl, 1, A.vel)); gl.uniform1i(s.uAux, bindTex(gl, 2, A.aux));
    gl.uniform1i(s.uHome, bindTex(gl, 3, homeTex)); gl.uniform1i(s.uFluid, bindTex(gl, 4, fluidTex)); gl.uniform1i(s.uTrail, bindTex(gl, 5, trailTex));
    gl.uniformMatrix4fv(s.uViewProj, false, cam.viewProj); gl.uniformMatrix4fv(s.uView, false, cam.view);
    gl.uniform3fv(s.uCamRight, cam.right); gl.uniform3fv(s.uCamUp, cam.up); gl.uniform3fv(s.uLightDir, cam.lightDir);
    gl.uniform1f(s.uTime, time % 1000); gl.uniform1f(s.uRatio, ratio); gl.uniform1f(s.uK06, 1 - Math.pow(1 - LAG.particle, ratio));
    gl.uniform1f(s.uBuild, u.u_build.value); gl.uniform1f(s.uOpen, u.u_open.value); gl.uniform1f(s.uFlinch, u.u_flinch.value);
    gl.uniform1f(s.uTight, u.u_tight.value); gl.uniform1f(s.uIdle, u.u_idle.value); gl.uniform1f(s.uPresent, u.u_present.value);
    gl.uniform3f(s.uProbeRaw, u.u_probeRX.value, u.u_probeRY.value, u.u_probeRZ.value); gl.uniform3f(s.uPokeVel, u.u_pokeX.value, u.u_pokeY.value, u.u_pokeZ.value);
    gl.uniform1f(s.uPoke, u.u_poke.value); gl.uniform1f(s.uShove, cfg.shove); gl.uniform1f(s.uDrag, cfg.drag);
    gl.uniform3f(s.uHandDir, u.u_handDX.value, u.u_handDY.value, u.u_handDZ.value); gl.uniform3f(s.uHand, HAND.radius, HAND.back, HAND.spread);
    gl.uniform3f(s.uReset, u.u_resetFront.value, u.u_resetAmp.value, RESET.band); gl.uniform1f(s.uKick, RESET.kick);
    gl.uniform1f(s.uFluidPush, cfg.fluidPush); gl.uniform1f(s.uSwirl, cfg.swirl); gl.uniform1f(s.uSwirlFreq, cfg.swirlFreq);
    gl.uniform1f(s.uSpring, cfg.spring); gl.uniform1f(s.uAttract, cfg.attract);
    gl.uniform1f(s.uFriction, Math.pow(cfg.friction, ratio)); gl.uniform1f(s.uSpeedLerp, 1 - Math.pow(1 - cfg.speedLerp, ratio));
    gl.uniform1f(s.uWrap, cfg.wrap); gl.uniform1f(s.uBound, cfg.bound); gl.uniform1f(s.uTubeR, cfg.tube);
    { const fl = api.flow; gl.uniform3fv(s['uFlowAx[0]'] || s.uFlowAx, fl.axes); gl.uniform3fv(s['uFlowRot[0]'] || s.uFlowRot, fl.rot); gl.uniform1i(s.uFlowN, fl.N); }
    { const R = verbP?.resolve; gl.uniform4f(s.uVRes, R?.front || 0, R?.band || 0, R?.on || 0, R?.crest || 0); gl.uniform3fv(s.uVResA, R?.a || [0, 0, 1]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, B.fbo);
    gl.viewport(0, 0, W, Math.max(1, Math.min(H, rows)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const t = A; A = B; B = t;
    return true;
  }

  // Draw into the currently bound HDR target (RGBA16F). Additive; alpha accumulates coverage.
  function draw(cam, count, u, opts) {
    if (!ready()) return;
    const r = P.render.uniforms;
    gl.useProgram(P.render.program);
    gl.uniform1i(r.uOff, bindTex(gl, 0, A.off)); gl.uniform1i(r.uVel, bindTex(gl, 1, A.vel)); gl.uniform1i(r.uAux, bindTex(gl, 2, A.aux));
    gl.uniform1i(r.uHome, bindTex(gl, 3, homeTex)); gl.uniform1i(r.uTrail, bindTex(gl, 4, opts.trail));
    gl.uniformMatrix4fv(r.uView, false, cam.view); gl.uniformMatrix4fv(r.uProj, false, cam.proj);
    gl.uniform1f(r.uSizeK, opts.sizeK); gl.uniform1f(r.uMaxPoint, caps.maxPointSize); gl.uniform1f(r.uTime, opts.time % 1000);
    gl.uniform3f(r.uRing, u.u_ringLon.value, u.u_ringPhase.value, u.u_ringAmp.value);
    gl.uniform4f(r.uTap, u.u_tapX.value, u.u_tapY.value, u.u_tapZ.value, u.u_tapT.value);
    gl.uniform1f(r.uSentry, u.u_sentry.value); gl.uniform3fv(r.uKey, cam.lightDir);
    gl.uniform3f(r.uProbeRaw, u.u_probeRX.value, u.u_probeRY.value, u.u_probeRZ.value); gl.uniform1f(r.uWake, u.u_wake.value * HAND.glow);
    gl.uniform3f(r.uHandDir, u.u_handDX.value, u.u_handDY.value, u.u_handDZ.value); gl.uniform3f(r.uHand, HAND.radius, HAND.back, HAND.spread);
    gl.uniform3f(r.uReset, u.u_resetFront.value, u.u_resetAmp.value, RESET.band);
    gl.uniform3fv(r.uColDark, opts.colDark); gl.uniform3fv(r.uColLight, opts.colLight); gl.uniform3fv(r.uColFast, opts.colFast); gl.uniform3fv(r.uEmberCol, opts.ember);
    gl.uniform3fv(r.uLightView, cam.lightView);
    const VP = opts.verbs, EM = VP?.ember;   // Key light / Spill widen the ember's reach at equal energy
    { const L = EMBER_LIGHT; gl.uniform3f(r.uOccW, L.occDen, L.occBead, L.scatter); gl.uniform1f(r.uScatterR, L.scatterR); gl.uniform3fv(r.uEmberHot, opts.hot); }
    gl.uniform3fv(r.uEmberView, cam.emberView); gl.uniform3f(r.uEmberLit, EMBER_LIGHT.reach * (EM?.reach || 1), EMBER_LIGHT.split, EMBER_LIGHT.falloff); gl.uniform1f(r.uEmberLight, EMBER_LIGHT.light * (EM?.light ?? 1));
    if (!ringsSet && opts.rings && opts.tones) {
      gl.uniform3fv(r['uRingN[0]'] || r.uRingN, opts.rings.n); gl.uniform3fv(r['uRingE1[0]'] || r.uRingE1, opts.rings.e1); gl.uniform3fv(r['uRingE2[0]'] || r.uRingE2, opts.rings.e2);
      gl.uniform3fv(r.uTGlint, opts.tones.glint); gl.uniform3fv(r.uTWhite, opts.tones.white); gl.uniform3fv(r.uTDawn, opts.tones.dawn); gl.uniform3fv(r.uTWarm, opts.tones.warm); ringsSet = true;
    }
    if (VP) {   // living verbs
      const Rv = VP.resolve, A = VP.aperture, C = VP.compose, T = VP.toolpath, E = VP.edit;
      gl.uniform4f(r.uVRes, Rv.front, Rv.band, Rv.on, Rv.crest); gl.uniform3fv(r.uVResA, Rv.a);
      gl.uniform4f(r.uVAp, A.radius, A.light, A.att, A.on);
      gl.uniform4fv(r['uVCo[0]'] || r.uVCo, C.edges); gl.uniform4f(r.uVCoB, C.bleed, 0.35, C.on, C.n);
      gl.uniform4fv(r['uVTpL[0]'] || r.uVTpL, T.legs); gl.uniform4f(r.uVTp, T.s, T.head, T.tau, T.on); gl.uniform4f(r.uVTpT, T.plunge, T.dwell, T.feed, T.n);
      gl.uniform1fv(r['uVEdL[0]'] || r.uVEdL, E.light); gl.uniform1fv(r['uVEdS[0]'] || r.uVEdS, E.size); gl.uniform1f(r.uVEd, E.on);
      gl.uniform1f(r.uKeyWarm, VP.key.warm);
    } else { gl.uniform4f(r.uVRes, 0, 0, 0, 0); gl.uniform4f(r.uVAp, 0, 0, 0, 0); gl.uniform4f(r.uVCoB, 0, 0, 0, 0); gl.uniform4f(r.uVTp, 0, 0, 0, 0); gl.uniform1f(r.uVEd, 0); gl.uniform1f(r.uKeyWarm, 0); }
    gl.uniform1f(r.uIntensity, opts.intensity); gl.uniform1f(r.uWrapR, cfg.wrap); gl.uniform1f(r.uEmberLevel, opts.emberLevel);
    gl.uniform1f(r.uEngage, u.u_engage.value); gl.uniform1f(r.uDim, u.u_dim.value);
    { const bd = opts.bead || [0.2, 2.6]; gl.uniform2f(r.uBead, bd[0], bd[1]); }
    gl.uniform2fv(r.uFastRange, cfg.fastRange); gl.uniform2fv(r.uBlurRange, cfg.blurRange); gl.uniform2f(r.uInvRes, opts.invRes[0], opts.invRes[1]);
    { const fl = api.flow; gl.uniform3fv(r['uFlowAx[0]'] || r.uFlowAx, fl.axes); gl.uniform3fv(r['uFlowRot[0]'] || r.uFlowRot, fl.rot); gl.uniform1i(r.uFlowN, fl.N); gl.uniform1f(r.uDepthTone, FLOW.depth); }
    gl.uniform4f(r.uForm, FORM.far, FORM.curve, FORM.smoke, FORM.rim); gl.uniform1f(r.uFormTint, FORM.tint); gl.uniform3fv(r.uColCool, COL_COOL); if (DBG) gl.uniform1f(r.uFormMode, FORM.mode || 0);   // FORM: read every frame (the lab)
    // colour adds; alpha (the near-layer coverage the ember reads) accumulates as 1 - prod(1 - a): bounded in [0, 1], order-free,
    // so the ember's 5-tap blur is a real penumbra instead of a dilation of saturated sums
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  const api = {
    flow: null,
    cfg, ready, reset, step, draw, programs: P, count: W * H, side,
    get mrtOk() { return A.ok && B.ok; },
    dispose() { [homeTex, A.off, A.vel, A.aux, B.off, B.vel, B.aux].forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(A.fbo); gl.deleteFramebuffer(B.fbo); gl.deleteVertexArray(vao); Object.values(P).forEach((p) => gl.deleteProgram(p.program)); },
  };
  return api;
}
