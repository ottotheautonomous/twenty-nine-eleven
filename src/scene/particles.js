// SPDX-License-Identifier: 0BSD
// GPGPU particle lattice for Sentinel (raw WebGL2). Lifted from the Twenty Nine
// Eleven kit, 04-particles/particles.js, and changed: homes are uploaded from
// shape.js instead of seeded; state is an offset from home (so half floats keep
// precision); a third MRT attachment carries the cascaded proximity response,
// the warm term and the build; the spring weakens under the trail; morphing removed.
import { createProgram, bindTex, FULLSCREEN_VS } from './gl.js';
import { LAG } from './constants.js';

const SIM_FS = (noiseSrc, sdfSrc) => noiseSrc + sdfSrc + `
in vec2 vUv;
uniform sampler2D uOff, uVel, uAux, uHome, uFluid, uTrail;
uniform mat4 uViewProj, uView;
uniform vec3 uCamRight, uCamUp, uLightDir;
uniform vec3 uProbe;
uniform float uTime, uRatio, uK06;
uniform float uBuild, uOpen, uFlinch, uTight, uIdle, uPresent;
uniform vec3 uProbeRaw, uPokeVel;      // raw probe on the centre plane; its world velocity (R/s, |v| <= 4)
uniform float uPoke, uShove, uDrag;    // raw pointer speed 0..1 (0.15 s tail); impulse gains
uniform float uFluidPush, uSwirl, uSwirlFreq, uSpring, uAttract, uFriction, uSpeedLerp, uWrap, uBound;
layout(location = 0) out vec4 oOff;            // xyz offset from home, w = wrap-diffuse lighting
layout(location = 1) out vec4 oVel;            // xyz, w = smoothed speed
layout(location = 2) out vec4 oAux;            // d1, d2 (cascaded displacement), warm, built
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 Hm = texelFetch(uHome, c, 0), O = texelFetch(uOff, c, 0), V = texelFetch(uVel, c, 0), A = texelFetch(uAux, c, 0);
  vec3 home = Hm.xyz; float r = Hm.w;
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

  // 0 the hand: an instant, velocity-weighted shove from the raw probe. A still hand does nothing.
  vec3 dp = p - uProbeRaw; float dd = max(length(dp), 1e-3);
  float hk = 1.0 - smoothstep(0.0, 0.55, dd); hk *= hk;
  float hand = uPoke * hk;
  v += (dp / dd) * hand * uShove * uRatio;                                                       // radial, away from the hand
  v += uPokeVel * hand * uDrag * uRatio;                                                         // along the hand's motion
  v += (uCamRight * f.x + uCamUp * f.y) * uFluidPush * uRatio;                                   // 1 fluid push (the tear)
  vec3 n = BitangentNoise4D(vec4(p * uSwirlFreq, uTime * (1.0 + 0.7 * r)));
  v += n * uSwirl * (1.0 - 0.5 * uTight) * (0.7 + 0.3 * r) * uRatio;                            // 2 swirl
  float k = uSpring * (1.0 + 0.3 * uTight) * built * (1.0 - 0.65 * min(fl, 1.0)) * (1.0 - 0.7 * trail);
  v += (homeT - p) * k * uRatio;                                                                 // 3 spring
  float d = sdfScene(p / scale) * scale;
  vec3 g = sdfGradientTetra(p / scale, 1e-3);
  vec3 nrm = g / max(length(g), 1e-6);
  if (d > 0.0) v -= nrm * uAttract * built * (0.7 + 0.3 * r) * uRatio;                           // 4 attraction to the tubes

  v *= uFriction;
  v = clamp(v, vec3(-0.5), vec3(0.5));
  p += v * uRatio;
  float len = length(p); if (len > uBound) p *= uBound / len;

  float diff = max((dot(nrm, uLightDir) + uWrap) / (1.0 + uWrap), 0.0);
  float inside = d < 0.0 ? mix(0.35, 1.0, smoothstep(-0.12, 0.0, d)) : 1.0;
  float warm = max(dot(nrm, -normalize(p + vec3(1e-5))), 0.0) * 0.6 * (1.0 - smoothstep(0.35, 0.75, length(hv.xy)));   // only struts near the ember's halo

  oOff = vec4(p - home, diff * inside);
  oVel = vec4(v, mix(V.w, length(v), uSpeedLerp));
  oAux = vec4(d1, d2, warm, built);
}`;

export const RENDER_VS = `
uniform sampler2D uOff, uVel, uAux, uHome;
uniform mat4 uView, uProj;
uniform float uSizeK, uMaxPoint, uTime;
uniform vec3 uRing;          // (longitude, phase 0..1, amplitude)
uniform vec4 uTap;           // (x, y, z, t); t outside (0,1) = none
uniform float uSentry;       // idle sentry band phase 0..1; 0 = none
uniform vec3 uKey;           // key light direction (sentry band origin)
uniform vec3 uProbeRaw; uniform float uPoke;   // the hand: instant light where it moves
out float vLight, vSpeed, vFade, vD2, vWarm, vBuilt, vBoost, vGrow;
void main() {
  int w = textureSize(uHome, 0).x;
  ivec2 c = ivec2(gl_VertexID % w, gl_VertexID / w);
  vec4 Hm = texelFetch(uHome, c, 0), O = texelFetch(uOff, c, 0), V = texelFetch(uVel, c, 0), A = texelFetch(uAux, c, 0);
  vec3 home = Hm.xyz; float r = Hm.w;
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

  float grow = 1.0 + 0.3 * (ring + tap) + 0.12 * A.y;
  float g = fract(r * 13.7);                                            // per-particle grain, fixed for life: sparks resolve against the bulk
  float size = uSizeK / max(-vp.z, 1e-3) * grow * mix(0.7, 1.4, g);
  gl_PointSize = clamp(size, 1.0, uMaxPoint);
  vFade = clamp(size * size, 0.0, 1.0) * flick;
  float hk = 1.0 - smoothstep(0.0, 0.6, distance(p, uProbeRaw)); hk *= hk;
  float touch = uPoke * hk;                                            // capped at +1: the tube stays under the bloom threshold
  vBoost = (1.0 + 1.5 * (ring + tap) + sentry + touch) * mix(0.6, 1.5, g);
  vGrow = grow;
  vLight = O.w; vSpeed = V.w; vD2 = A.y; vWarm = A.z; vBuilt = A.w;
}`;

export const RENDER_FS = `
in float vLight, vSpeed, vFade, vD2, vWarm, vBuilt, vBoost, vGrow;
uniform vec3 uColDark, uColLight, uColFast, uEmberCol, uLightView;
uniform float uIntensity, uWrapR, uEmberLevel, uEngage, uDim;
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
  col = mix(col, uEmberCol, vWarm * vWarm * uEmberLevel * 0.25);
  vec2 tr = texture(uTrail, gl_FragCoord.xy * uInvRes).rg;
  col += uColFast * (tr.g * 2.5 + tr.r * 0.3);                        // the breach rim brightens the lattice; it does not scratch the ember
  col += uColFast * vD2 * vD2 * 0.8;
  float a = (1.0 - 0.35 * smoothstep(uBlurRange.x, uBlurRange.y, vSpeed)) * vFade * vBuilt;   // moved particles stay visible
  a *= 1.0 - smoothstep(0.75, 1.0, r2);
  float energy = pow(1.0 / vGrow, 1.5);
  o = vec4(col * a * uIntensity * vBoost * energy * (1.0 + 0.1 * uEngage), a);   // the modal dim is applied once, in the composite
}`;

export function createParticles(gl, caps, { noiseSrc, sdfSrc, side = [256, 256], state32 = false, homes, latticeRotT, shape = 0 }) {
  const [W, H] = side;
  const fmt = state32 ? { internal: gl.RGBA32F, type: gl.FLOAT } : { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
  const P = {
    sim: createProgram(gl, caps, FULLSCREEN_VS, SIM_FS(noiseSrc, sdfSrc)),
    render: createProgram(gl, caps, RENDER_VS, RENDER_FS),
  };
  const cfg = {
    fluidPush: 7e-4, shove: 1.2e-3, drag: 3e-4, swirl: 0.7e-4, swirlFreq: 7.0, spring: 1e-3, attract: 9e-4, friction: 0.9, speedLerp: 0.035, wrap: 0.18, bound: 2.5,
    sizePx: 1.6, intensity: 0.020, fastRange: [0.003, 0.005], blurRange: [0.002, 0.007],
  };
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
  let configured = false;
  const ready = () => Object.values(P).every((p) => p.ready());
  function configure() {
    if (configured || !P.sim.ready()) return;
    gl.useProgram(P.sim.program);
    gl.uniformMatrix3fv(P.sim.uniforms.uLatticeRotT, false, latticeRotT);
    gl.uniform1i(P.sim.uniforms.uShape, shape);
    gl.uniform1i(P.sim.uniforms.uSdfZero, 0);
    configured = true;
  }
  function reset() {
    gl.disable(gl.BLEND);
    for (const S of [A, B]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo);
      for (let i = 0; i < 3; i++) gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // u: the uniforms object. rows: active prefix of the state texture.
  function step(ratio, time, cam, fluidTex, trailTex, u, rows = H) {
    if (!ready()) return false;
    configure();
    const s = P.sim.uniforms;
    gl.disable(gl.BLEND);
    gl.useProgram(P.sim.program);
    gl.uniform1i(s.uOff, bindTex(gl, 0, A.off)); gl.uniform1i(s.uVel, bindTex(gl, 1, A.vel)); gl.uniform1i(s.uAux, bindTex(gl, 2, A.aux));
    gl.uniform1i(s.uHome, bindTex(gl, 3, homeTex)); gl.uniform1i(s.uFluid, bindTex(gl, 4, fluidTex)); gl.uniform1i(s.uTrail, bindTex(gl, 5, trailTex));
    gl.uniformMatrix4fv(s.uViewProj, false, cam.viewProj); gl.uniformMatrix4fv(s.uView, false, cam.view);
    gl.uniform3fv(s.uCamRight, cam.right); gl.uniform3fv(s.uCamUp, cam.up); gl.uniform3fv(s.uLightDir, cam.lightDir);
    gl.uniform3f(s.uProbe, u.u_probeX.value, u.u_probeY.value, u.u_probeZ.value);
    gl.uniform1f(s.uTime, time % 1000); gl.uniform1f(s.uRatio, ratio); gl.uniform1f(s.uK06, 1 - Math.pow(1 - LAG.particle, ratio));
    gl.uniform1f(s.uBuild, u.u_build.value); gl.uniform1f(s.uOpen, u.u_open.value); gl.uniform1f(s.uFlinch, u.u_flinch.value);
    gl.uniform1f(s.uTight, u.u_tight.value); gl.uniform1f(s.uIdle, u.u_idle.value); gl.uniform1f(s.uPresent, u.u_present.value);
    gl.uniform3f(s.uProbeRaw, u.u_probeRX.value, u.u_probeRY.value, u.u_probeRZ.value); gl.uniform3f(s.uPokeVel, u.u_pokeX.value, u.u_pokeY.value, u.u_pokeZ.value);
    gl.uniform1f(s.uPoke, u.u_poke.value); gl.uniform1f(s.uShove, cfg.shove); gl.uniform1f(s.uDrag, cfg.drag);
    gl.uniform1f(s.uFluidPush, cfg.fluidPush); gl.uniform1f(s.uSwirl, cfg.swirl); gl.uniform1f(s.uSwirlFreq, cfg.swirlFreq);
    gl.uniform1f(s.uSpring, cfg.spring); gl.uniform1f(s.uAttract, cfg.attract);
    gl.uniform1f(s.uFriction, Math.pow(cfg.friction, ratio)); gl.uniform1f(s.uSpeedLerp, 1 - Math.pow(1 - cfg.speedLerp, ratio));
    gl.uniform1f(s.uWrap, cfg.wrap); gl.uniform1f(s.uBound, cfg.bound);
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
    gl.uniform3f(r.uProbeRaw, u.u_probeRX.value, u.u_probeRY.value, u.u_probeRZ.value); gl.uniform1f(r.uPoke, u.u_poke.value);
    gl.uniform3fv(r.uColDark, opts.colDark); gl.uniform3fv(r.uColLight, opts.colLight); gl.uniform3fv(r.uColFast, opts.colFast); gl.uniform3fv(r.uEmberCol, opts.ember);
    gl.uniform3fv(r.uLightView, cam.lightView);
    gl.uniform1f(r.uIntensity, opts.intensity); gl.uniform1f(r.uWrapR, cfg.wrap); gl.uniform1f(r.uEmberLevel, opts.emberLevel);
    gl.uniform1f(r.uEngage, u.u_engage.value); gl.uniform1f(r.uDim, u.u_dim.value);
    gl.uniform2fv(r.uFastRange, cfg.fastRange); gl.uniform2fv(r.uBlurRange, cfg.blurRange); gl.uniform2f(r.uInvRes, opts.invRes[0], opts.invRes[1]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  return {
    cfg, ready, reset, step, draw, programs: P, count: W * H, side,
    get mrtOk() { return A.ok && B.ok; },
    dispose() { [homeTex, A.off, A.vel, A.aux, B.off, B.vel, B.aux].forEach((t) => gl.deleteTexture(t)); gl.deleteFramebuffer(A.fbo); gl.deleteFramebuffer(B.fbo); gl.deleteVertexArray(vao); Object.values(P).forEach((p) => gl.deleteProgram(p.program)); },
  };
}
