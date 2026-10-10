/*
 * Velocity-only stable-fluids solver for a mouse-reactive hero (raw WebGL2).
 *
 * Derived from WebGL-Fluid-Simulation by Pavel Dobryakov
 *   https://github.com/PavelDoGreat/WebGL-Fluid-Simulation (script.js, master @ 2024-11-12)
 *   MIT License, Copyright (c) 2017 Pavel Dobryakov (full text: ../LICENSES/MIT-Dobryakov-WebGL-Fluid-Simulation.txt)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * Changes for the Twenty Nine Eleven kit (2026):
 *  - GLSL ES 3.00 only (WebGL1 path, dye, bloom, sunrays, GUI, analytics removed).
 *  - Velocity only: the field is the product; it pushes particles. No dye.
 *  - Neighbour reads use texelFetch with explicit clamping (no derivative or
 *    filtering dependence; also sidesteps Intel/D3D texelFetchOffset bugs).
 *  - Line (capsule) splat from previous to current pointer, cubic falloff,
 *    instead of a Gaussian dot, so fast flicks leave continuous streaks.
 *  - Multiplicative, frame-rate-independent dissipation pow(decay, dtRatio)
 *    (the 2017-2018 Dobryakov model igloo.inc's 0.98 refers to) instead of the
 *    current 1/(1+d*dt) model.
 *  - Velocity unit: aspect-corrected UV units per second (x measured in units
 *    of canvas height). Pressure/divergence math is unit-agnostic.
 *  - Manual bilinear advection (MANUAL_FILTERING) is enabled only when the
 *    velocity texture is 32F and OES_texture_float_linear is missing. Dobryakov
 *    checks OES_texture_float_linear even for half-float targets, which needlessly
 *    forces the manual path on ~half of iOS devices: RG16F is filterable in
 *    core WebGL2.
 */
import { createProgram, createTarget, createPair, blit, bindTex, FULLSCREEN_VS } from './gl.js';

const NEIGHBOURS = `
in vec2 vUv;
ivec2 cl(ivec2 c, ivec2 s) { return clamp(c, ivec2(0), s - 1); }
`;

const SPLAT_FS = NEIGHBOURS + `
uniform sampler2D uTarget;
uniform vec2 uA, uB;        // previous / current pointer, UV (0..1)
uniform vec2 uForce;        // velocity to add at the core, aspect-corrected UV/s
uniform float uRadius;      // in units of canvas height
uniform float uAspect;      // width / height
out vec4 o;
float capsule(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  vec2 s = vec2(uAspect, 1.0);
  float k = clamp(1.0 - capsule(vUv * s, uA * s, uB * s) / max(uRadius, 1e-4), 0.0, 1.0);
#ifdef GAUSSIAN_SPLAT
  k = exp(-pow(capsule(vUv * s, uA * s, uB * s) / max(uRadius, 1e-4), 2.0) * 4.0); // Dobryakov-like falloff
#else
  k = k * k * k;                                                                   // igloo-like cubic falloff
#endif
  vec2 v = texture(uTarget, vUv).xy + uForce * k;
  o = vec4(v, 0.0, 1.0);
}`;

const CURL_FS = NEIGHBOURS + `
uniform sampler2D uVelocity;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), s = textureSize(uVelocity, 0);
  float L = texelFetch(uVelocity, cl(c - ivec2(1, 0), s), 0).y;
  float R = texelFetch(uVelocity, cl(c + ivec2(1, 0), s), 0).y;
  float T = texelFetch(uVelocity, cl(c + ivec2(0, 1), s), 0).x;
  float B = texelFetch(uVelocity, cl(c - ivec2(0, 1), s), 0).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`;

const VORTICITY_FS = NEIGHBOURS + `
uniform sampler2D uVelocity, uCurl;
uniform float uCurlStrength, uDt;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), s = textureSize(uCurl, 0);
  float L = texelFetch(uCurl, cl(c - ivec2(1, 0), s), 0).x;
  float R = texelFetch(uCurl, cl(c + ivec2(1, 0), s), 0).x;
  float T = texelFetch(uCurl, cl(c + ivec2(0, 1), s), 0).x;
  float B = texelFetch(uCurl, cl(c - ivec2(0, 1), s), 0).x;
  float C = texelFetch(uCurl, c, 0).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= uCurlStrength * C;
  force.y *= -1.0;
  vec2 v = texelFetch(uVelocity, c, 0).xy + force * uDt;
  o = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0); // keep well under half-float max (65504)
}`;

const DIVERGENCE_FS = NEIGHBOURS + `
uniform sampler2D uVelocity;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), s = textureSize(uVelocity, 0);
  vec2 C = texelFetch(uVelocity, c, 0).xy;
  float L = texelFetch(uVelocity, cl(c - ivec2(1, 0), s), 0).x;
  float R = texelFetch(uVelocity, cl(c + ivec2(1, 0), s), 0).x;
  float T = texelFetch(uVelocity, cl(c + ivec2(0, 1), s), 0).y;
  float B = texelFetch(uVelocity, cl(c - ivec2(0, 1), s), 0).y;
  if (c.x == 0) L = -C.x;           // reflective walls (Dobryakov)
  if (c.x == s.x - 1) R = -C.x;
  if (c.y == s.y - 1) T = -C.y;
  if (c.y == 0) B = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const CLEAR_FS = NEIGHBOURS + `
uniform sampler2D uTexture;
uniform float uValue;
out vec4 o;
void main() { o = uValue * texelFetch(uTexture, ivec2(gl_FragCoord.xy), 0); }`;

const PRESSURE_FS = NEIGHBOURS + `
uniform sampler2D uPressure, uDivergence;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), s = textureSize(uPressure, 0);
  float L = texelFetch(uPressure, cl(c - ivec2(1, 0), s), 0).x;
  float R = texelFetch(uPressure, cl(c + ivec2(1, 0), s), 0).x;
  float T = texelFetch(uPressure, cl(c + ivec2(0, 1), s), 0).x;
  float B = texelFetch(uPressure, cl(c - ivec2(0, 1), s), 0).x;
  float div = texelFetch(uDivergence, c, 0).x;
  o = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT_FS = NEIGHBOURS + `
uniform sampler2D uPressure, uVelocity;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), s = textureSize(uPressure, 0);
  float L = texelFetch(uPressure, cl(c - ivec2(1, 0), s), 0).x;
  float R = texelFetch(uPressure, cl(c + ivec2(1, 0), s), 0).x;
  float T = texelFetch(uPressure, cl(c + ivec2(0, 1), s), 0).x;
  float B = texelFetch(uPressure, cl(c - ivec2(0, 1), s), 0).x;
  vec2 v = texelFetch(uVelocity, c, 0).xy - vec2(R - L, T - B); // Dobryakov's scaling, kept as tuned
  o = vec4(v, 0.0, 1.0);
}`;

const ADVECT_FS = NEIGHBOURS + `
uniform sampler2D uVelocity;
uniform float uDt, uDecay, uAspect;
out vec4 o;
#ifdef MANUAL_FILTERING
// Manual bilinear for devices that cannot filter the velocity format.
// texelFetch-based, so it is also more precise than fixed-point HW filtering.
vec4 bilerp(sampler2D t, vec2 uv) {
  ivec2 s = textureSize(t, 0);
  vec2 st = uv * vec2(s) - 0.5;
  ivec2 i = ivec2(floor(st));
  vec2 f = fract(st);
  vec4 a = texelFetch(t, cl(i, s), 0);
  vec4 b = texelFetch(t, cl(i + ivec2(1, 0), s), 0);
  vec4 c = texelFetch(t, cl(i + ivec2(0, 1), s), 0);
  vec4 d = texelFetch(t, cl(i + ivec2(1, 1), s), 0);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
#define SAMPLE(t, uv) bilerp(t, uv)
#else
#define SAMPLE(t, uv) texture(t, uv)
#endif
void main() {
  vec2 v = SAMPLE(uVelocity, vUv).xy;
  vec2 coord = vUv - uDt * v * vec2(1.0 / uAspect, 1.0);   // semi-Lagrangian back-trace
  o = vec4(SAMPLE(uVelocity, coord).xy * uDecay, 0.0, 1.0);
}`;

export function createFluid(gl, caps, opts = {}) {
  const cfg = {
    simRes: 128,             // short side; long side = simRes * aspect (igloo 128)
    pressureIterations: 3,   // igloo 2-3; Dobryakov 20. 3 is plenty for a force field
    pressure: 0.8,           // pressure carry-over (Dobryakov PRESSURE)
    curl: 0,                 // vorticity confinement; 0 = calm (igloo footer), 10-30 = swirly
    velocityDecay: 0.98,     // per 60 Hz frame
    splatRadius: 0.08,       // fraction of canvas height
    splatGain: 1.0,          // multiplies pointer velocity (UV/s) written at the core
    maxSplatGapMs: 150,      // skip the line if the pointer was idle this long (no teleport streaks)
    ...opts,
  };
  const half = caps.rg16f && caps.rgba16f;
  const velFmt = half
    ? { internalFormat: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
  const scalarFmt = half
    ? { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT }
    : { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT };
  const manual = !half && !caps.floatLinear;
  const velFilter = manual ? gl.NEAREST : gl.LINEAR;

  const P = {
    splat: createProgram(gl, caps, FULLSCREEN_VS, SPLAT_FS),
    curl: createProgram(gl, caps, FULLSCREEN_VS, CURL_FS),
    vorticity: createProgram(gl, caps, FULLSCREEN_VS, VORTICITY_FS),
    divergence: createProgram(gl, caps, FULLSCREEN_VS, DIVERGENCE_FS),
    clear: createProgram(gl, caps, FULLSCREEN_VS, CLEAR_FS),
    pressure: createProgram(gl, caps, FULLSCREEN_VS, PRESSURE_FS),
    gradient: createProgram(gl, caps, FULLSCREEN_VS, GRADIENT_FS),
    advect: createProgram(gl, caps, FULLSCREEN_VS, ADVECT_FS, manual ? { MANUAL_FILTERING: true } : {}),
  };

  let W = 0, H = 0, aspect = 1, velocity, pressure, divergence, curlT;
  function resize(canvasW, canvasH) {
    aspect = canvasW / canvasH;
    const w = Math.round(aspect >= 1 ? cfg.simRes * aspect : cfg.simRes);
    const h = Math.round(aspect >= 1 ? cfg.simRes : cfg.simRes / aspect);
    if (w === W && h === H) return;
    W = w; H = h;
    velocity?.dispose(); pressure?.dispose(); divergence?.dispose(); curlT?.dispose();
    velocity = createPair(gl, W, H, { ...velFmt, filter: velFilter });
    pressure = createPair(gl, W, H, { ...scalarFmt, filter: gl.NEAREST });
    divergence = createTarget(gl, W, H, { ...scalarFmt, filter: gl.NEAREST });
    curlT = createTarget(gl, W, H, { ...scalarFmt, filter: gl.NEAREST });
  }

  const ready = () => Object.values(P).every((p) => p.ready());

  // Pointer bookkeeping: call pointer(x, y, now) on every pointermove with UV in
  // 0..1 (y up). The splat itself is issued at most once per frame in step().
  const ptr = { has: false, ax: 0, ay: 0, bx: 0, by: 0, t: 0, pending: false };
  function pointer(x, y, nowMs) {
    if (!ptr.has || nowMs - ptr.t > cfg.maxSplatGapMs) { ptr.ax = ptr.bx = x; ptr.ay = ptr.by = y; ptr.has = true; }
    else { ptr.bx = x; ptr.by = y; ptr.pending = true; }
    ptr.t = nowMs;
  }

  function use(p) { gl.useProgram(p.program); return p.uniforms; }

  function splatLine(ax, ay, bx, by, fx, fy, radius = cfg.splatRadius) {
    const u = use(P.splat);
    gl.uniform1i(u.uTarget, bindTex(gl, 0, velocity.read.texture));
    gl.uniform2f(u.uA, ax, ay); gl.uniform2f(u.uB, bx, by);
    gl.uniform2f(u.uForce, fx, fy);
    gl.uniform1f(u.uRadius, radius); gl.uniform1f(u.uAspect, aspect);
    blit(gl, velocity.write); velocity.swap();
  }

  // dtSec: real frame time in seconds (clamp it, e.g. <= 1/30).
  function step(dtSec) {
    if (!ready()) return false;
    const ratio = dtSec * 60;
    gl.disable(gl.BLEND);
    if (ptr.pending) {
      const fx = ((ptr.bx - ptr.ax) * aspect) / Math.max(dtSec, 1e-3) * cfg.splatGain; // aspect-corrected UV/s
      const fy = (ptr.by - ptr.ay) / Math.max(dtSec, 1e-3) * cfg.splatGain;
      splatLine(ptr.ax, ptr.ay, ptr.bx, ptr.by, fx, fy);
      ptr.ax = ptr.bx; ptr.ay = ptr.by; ptr.pending = false;
    }
    let u;
    if (cfg.curl > 0) {
      u = use(P.curl); gl.uniform1i(u.uVelocity, bindTex(gl, 0, velocity.read.texture)); blit(gl, curlT);
      u = use(P.vorticity);
      gl.uniform1i(u.uVelocity, bindTex(gl, 0, velocity.read.texture));
      gl.uniform1i(u.uCurl, bindTex(gl, 1, curlT.texture));
      gl.uniform1f(u.uCurlStrength, cfg.curl); gl.uniform1f(u.uDt, dtSec);
      blit(gl, velocity.write); velocity.swap();
    }
    u = use(P.divergence); gl.uniform1i(u.uVelocity, bindTex(gl, 0, velocity.read.texture)); blit(gl, divergence);
    u = use(P.clear); gl.uniform1i(u.uTexture, bindTex(gl, 0, pressure.read.texture)); gl.uniform1f(u.uValue, cfg.pressure);
    blit(gl, pressure.write); pressure.swap();
    u = use(P.pressure); gl.uniform1i(u.uDivergence, bindTex(gl, 0, divergence.texture));
    for (let i = 0; i < cfg.pressureIterations; i++) {
      gl.uniform1i(u.uPressure, bindTex(gl, 1, pressure.read.texture));
      blit(gl, pressure.write); pressure.swap();
    }
    u = use(P.gradient);
    gl.uniform1i(u.uPressure, bindTex(gl, 0, pressure.read.texture));
    gl.uniform1i(u.uVelocity, bindTex(gl, 1, velocity.read.texture));
    blit(gl, velocity.write); velocity.swap();
    u = use(P.advect);
    gl.uniform1i(u.uVelocity, bindTex(gl, 0, velocity.read.texture));
    gl.uniform1f(u.uDt, dtSec); gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uDecay, Math.pow(cfg.velocityDecay, ratio));
    blit(gl, velocity.write); velocity.swap();
    return true;
  }

  return {
    cfg, resize, step, pointer, splatLine, ready, programs: P,
    get texture() { return velocity.read.texture; }, // sample with texture() at screen UV; .xy = aspect-corrected UV/s
    get size() { return [W, H]; }, get manualFiltering() { return manual; },
    dispose() { velocity?.dispose(); pressure?.dispose(); divergence?.dispose(); curlT?.dispose(); Object.values(P).forEach((p) => gl.deleteProgram(p.program)); },
  };
}

// Exported for compile tests.
export const SHADERS = { SPLAT_FS, CURL_FS, VORTICITY_FS, DIVERGENCE_FS, CLEAR_FS, PRESSURE_FS, GRADIENT_FS, ADVECT_FS };
