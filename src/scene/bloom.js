/*
 * Mip-chain bloom for raw WebGL2: Karis-averaged 13-tap prefilter, CoD-style
 * downsample chain, 9-tap tent upsample with "radius" mix (pmndrs semantics,
 * so igloo.inc's levels 6 / threshold 0.2 / radius 0.85 / intensity 1 carry over),
 * plus a cheaper dual-Kawase variant for low tiers.
 *
 * DOWN_FS and UP_FS are altered versions of pmndrs/postprocessing
 *   src/materials/glsl/convolution.downsampling.{vert,frag} and convolution.upsampling.{vert,frag}
 *   (https://github.com/pmndrs/postprocessing, main @ 2026-10-05), and the threshold of
 *   src/materials/glsl/luminance.frag.
 *   Copyright (c) 2015 Raoul van Rüschen. Zlib License:
 *   This software is provided 'as-is', without any express or implied warranty. In no event
 *   will the authors be held liable for any damages arising from the use of this software.
 *   Permission is granted to anyone to use this software for any purpose, including commercial
 *   applications, and to alter it and redistribute it freely, subject to the following restrictions:
 *   1. The origin of this software must not be misrepresented; you must not claim that you wrote
 *      the original software. If you use this software in a product, an acknowledgment in the
 *      product documentation would be appreciated but is not required.
 *   2. Altered source versions must be plainly marked as such, and must not be misrepresented as
 *      being the original software.
 *   3. This notice may not be removed or altered from any source distribution.
 *   ALTERED (Twenty Nine Eleven kit, 2026): ported to GLSL ES 3.00 without three.js; tap
 *   offsets computed in the fragment shader instead of 12 varyings; three.js colorspace
 *   include removed; luminance threshold merged into a new Karis-averaged prefilter.
 *
 * PREFILTER_FS (Karis average) and the dual-Kawase pair are kit originals
 * (SPDX-License-Identifier: 0BSD), written from: J. Jimenez, "Next Generation Post
 * Processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014 (13-tap as 5 boxes,
 * weight 1/(1+luma) per box on the first downsample, renormalised); M. Bjorge,
 * "Bandwidth-Efficient Rendering", SIGGRAPH 2015 (dual filter).
 * LearnOpenGL's "Phys. Based Bloom" code was NOT used (its code is CC BY-NC 4.0).
 */
import { createProgram, createTarget, blit, bindTex, FULLSCREEN_VS } from './gl.js';

const LUMA = `float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;

// Full res -> half res. 13 taps grouped as CoD's 5 boxes, each box weighted by
// 1/(1+luma) (Karis) and renormalised: kills single-pixel fireflies that would
// otherwise pulse as huge bloom discs. Also the NaN/Inf/overflow guard.
const PREFILTER_FS = LUMA + `
in vec2 vUv;
uniform sampler2D uInput;
uniform vec2 uTexel;          // 1 / input size
uniform float uThreshold;     // 0.2 (igloo)
uniform float uSmoothing;     // 0.03 (pmndrs default)
out vec4 o;
#ifdef BLOOM_NO_CLAMP
vec3 tap(vec2 off) { return texture(uInput, vUv + off * uTexel).rgb; }   // test only: shows why the clamp exists
#else
vec3 tap(vec2 off) { return clamp(texture(uInput, vUv + off * uTexel).rgb, 0.0, 64.0); } // clamp: Inf -> 64, NaN -> 0 on tested GPUs, caps HDR spikes
#endif
vec4 box(vec3 a, vec3 b, vec3 c, vec3 d, float w) {
  vec3 m = (a + b + c + d) * 0.25;
  float k = w / (1.0 + luma(m));
  return vec4(m * k, k);
}
void main() {
  vec3 A = tap(vec2(-2, 2)), B = tap(vec2(0, 2)), C = tap(vec2(2, 2));
  vec3 D = tap(vec2(-1, 1)), E = tap(vec2(1, 1));
  vec3 F = tap(vec2(-2, 0)), G = tap(vec2(0, 0)), H = tap(vec2(2, 0));
  vec3 I = tap(vec2(-1, -1)), J = tap(vec2(1, -1));
  vec3 K = tap(vec2(-2, -2)), L = tap(vec2(0, -2)), M = tap(vec2(2, -2));
  vec4 s = box(D, E, I, J, 0.5)
         + box(A, B, F, G, 0.125) + box(B, C, G, H, 0.125)
         + box(F, G, K, L, 0.125) + box(G, H, L, M, 0.125);
  vec3 c = s.rgb / max(s.a, 1e-6);
  c *= smoothstep(uThreshold, uThreshold + uSmoothing, luma(c));   // pmndrs luminance mask
  o = vec4(c, 1.0);
}`;

// pmndrs convolution.downsampling (altered, see header).
const DOWN_FS = `
in vec2 vUv;
uniform sampler2D uInput;
uniform vec2 uTexel;          // 1 / input size
out vec4 o;
#define WEIGHT_INNER 0.125
#define WEIGHT_OUTER 0.05556
float clampToBorder(vec2 uv) { return float(uv.s >= 0.0 && uv.s <= 1.0 && uv.t >= 0.0 && uv.t <= 1.0); }
vec4 t(vec2 off, float w) { vec2 uv = vUv + uTexel * off; return w * clampToBorder(uv) * texture(uInput, uv); }
void main() {
  vec4 c = t(vec2(-1, 1), WEIGHT_INNER) + t(vec2(1, 1), WEIGHT_INNER) + t(vec2(-1, -1), WEIGHT_INNER) + t(vec2(1, -1), WEIGHT_INNER);
  c += t(vec2(-2, 2), WEIGHT_OUTER) + t(vec2(0, 2), WEIGHT_OUTER) + t(vec2(2, 2), WEIGHT_OUTER) + t(vec2(-2, 0), WEIGHT_OUTER);
  c += t(vec2(2, 0), WEIGHT_OUTER) + t(vec2(-2, -2), WEIGHT_OUTER) + t(vec2(0, -2), WEIGHT_OUTER) + t(vec2(2, -2), WEIGHT_OUTER);
  c += WEIGHT_OUTER * texture(uInput, vUv);
  o = c;
}`;

// pmndrs convolution.upsampling (altered, see header).
const UP_FS = `
in vec2 vUv;
uniform sampler2D uInput;     // coarser level (previous upsample result)
uniform sampler2D uSupport;   // same-size downsample level
uniform vec2 uTexel;          // 1 / uInput size
uniform float uRadius;        // 0.85 (igloo / pmndrs default)
out vec4 o;
void main() {
  vec4 c = vec4(0.0);
  c += texture(uInput, vUv + uTexel * vec2(-1.0, 1.0)) * 0.0625;
  c += texture(uInput, vUv + uTexel * vec2(0.0, 1.0)) * 0.125;
  c += texture(uInput, vUv + uTexel * vec2(1.0, 1.0)) * 0.0625;
  c += texture(uInput, vUv + uTexel * vec2(-1.0, 0.0)) * 0.125;
  c += texture(uInput, vUv) * 0.25;
  c += texture(uInput, vUv + uTexel * vec2(1.0, 0.0)) * 0.125;
  c += texture(uInput, vUv + uTexel * vec2(-1.0, -1.0)) * 0.0625;
  c += texture(uInput, vUv + uTexel * vec2(0.0, -1.0)) * 0.125;
  c += texture(uInput, vUv + uTexel * vec2(1.0, -1.0)) * 0.0625;
  o = mix(texture(uSupport, vUv), c, uRadius);
}`;

// Dual-Kawase (Bjorge 2015), kit original. 5 taps down, 8 taps up.
const KAWASE_DOWN_FS = `
in vec2 vUv;
uniform sampler2D uInput;
uniform vec2 uTexel;          // 1 / input size
uniform float uOffset;        // 1.0
out vec4 o;
void main() {
  vec2 h = uTexel * 0.5 * uOffset;
  vec4 s = texture(uInput, vUv) * 4.0;
  s += texture(uInput, vUv - h) + texture(uInput, vUv + h);
  s += texture(uInput, vUv + vec2(h.x, -h.y)) + texture(uInput, vUv - vec2(h.x, -h.y));
  o = s / 8.0;
}`;
const KAWASE_UP_FS = `
in vec2 vUv;
uniform sampler2D uInput, uSupport;
uniform vec2 uTexel;          // 1 / uInput size
uniform float uOffset, uRadius;
out vec4 o;
void main() {
  vec2 h = uTexel * 0.5 * uOffset;
  vec4 s = texture(uInput, vUv + vec2(-h.x * 2.0, 0.0));
  s += texture(uInput, vUv + vec2(-h.x, h.y)) * 2.0;
  s += texture(uInput, vUv + vec2(0.0, h.y * 2.0));
  s += texture(uInput, vUv + vec2(h.x, h.y)) * 2.0;
  s += texture(uInput, vUv + vec2(h.x * 2.0, 0.0));
  s += texture(uInput, vUv + vec2(h.x, -h.y)) * 2.0;
  s += texture(uInput, vUv + vec2(0.0, -h.y * 2.0));
  s += texture(uInput, vUv + vec2(-h.x, -h.y)) * 2.0;
  o = mix(texture(uSupport, vUv), s / 12.0, uRadius);
}`;

export function createBloom(gl, caps, opts = {}) {
  const cfg = { levels: 6, threshold: 0.2, smoothing: 0.03, radius: 0.85, kawase: false, kawaseOffset: 1.0, ...opts };
  const fmt = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
  const P = {
    pre: createProgram(gl, caps, FULLSCREEN_VS, PREFILTER_FS, cfg.defines || {}),
    down: createProgram(gl, caps, FULLSCREEN_VS, cfg.kawase ? KAWASE_DOWN_FS : DOWN_FS),
    up: createProgram(gl, caps, FULLSCREEN_VS, cfg.kawase ? KAWASE_UP_FS : UP_FS),
  };
  let pre, down = [], up = [];
  function resize(w, h) {
    pre?.dispose(); down.forEach((t) => t.dispose()); up.forEach((t) => t.dispose()); down = []; up = [];
    let cw = Math.max(1, Math.round(w / 2)), ch = Math.max(1, Math.round(h / 2));
    pre = createTarget(gl, cw, ch, fmt);
    for (let i = 0; i < cfg.levels; i++) {
      cw = Math.max(1, Math.round(cw / 2)); ch = Math.max(1, Math.round(ch / 2));
      down.push(createTarget(gl, cw, ch, fmt));
      if (i < cfg.levels - 1) up.push(createTarget(gl, cw, ch, fmt));
    }
  }
  const ready = () => Object.values(P).every((p) => p.ready());
  function render(sceneTexture, sceneW, sceneH) {
    if (!ready()) return null;
    gl.disable(gl.BLEND);
    let u = P.pre.uniforms; gl.useProgram(P.pre.program);
    gl.uniform1i(u.uInput, bindTex(gl, 0, sceneTexture));
    gl.uniform2f(u.uTexel, 1 / sceneW, 1 / sceneH);
    gl.uniform1f(u.uThreshold, cfg.threshold); gl.uniform1f(u.uSmoothing, cfg.smoothing);
    blit(gl, pre);
    u = P.down.uniforms; gl.useProgram(P.down.program);
    let prev = pre;
    for (const t of down) {
      gl.uniform1i(u.uInput, bindTex(gl, 0, prev.texture));
      gl.uniform2f(u.uTexel, 1 / prev.width, 1 / prev.height);
      if (cfg.kawase) gl.uniform1f(u.uOffset, cfg.kawaseOffset);
      blit(gl, t); prev = t;
    }
    u = P.up.uniforms; gl.useProgram(P.up.program);
    gl.uniform1f(u.uRadius, cfg.radius);
    if (cfg.kawase) gl.uniform1f(u.uOffset, cfg.kawaseOffset);
    for (let i = up.length - 1; i >= 0; i--) {
      gl.uniform1i(u.uInput, bindTex(gl, 0, prev.texture));
      gl.uniform1i(u.uSupport, bindTex(gl, 1, down[i].texture));
      gl.uniform2f(u.uTexel, 1 / prev.width, 1 / prev.height);
      blit(gl, up[i]); prev = up[i];
    }
    return prev.texture; // quarter-res bloom; sample with LINEAR in the grade pass
  }
  return { cfg, resize, render, ready, programs: P };
}

export const SHADERS = { PREFILTER_FS, DOWN_FS, UP_FS, KAWASE_DOWN_FS, KAWASE_UP_FS };
