// SPDX-License-Identifier: 0BSD
// Frame-rate-independent smoothing (lifted from the Twenty Nine Eleven kit,
// common/damp.js; independent re-implementation of documented behaviour).
//   ratio = dtMs / 16.667  (1.0 at 60 Hz, 0.5 at 120 Hz, 2.0 at 30 Hz)
//   damp(k, ratio)     = 1 - (1 - k)^ratio   -> per-frame lerp factor
//   friction(k, ratio) = k^ratio             -> per-frame multiplicative decay
// Changes for Sentinel: cascade step takes an optional per-call k; the pointer
// filter takes its gains as options.
export const frameRatio = (dtMs) => Math.min(Math.max(dtMs, 0), 100) / (1000 / 60);
export const damp = (k, ratio) => 1 - Math.pow(1 - k, ratio);
export const friction = (k, ratio) => Math.pow(k, ratio);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// Two cascaded first-order lerps: a critically-damped-feeling response with no overshoot.
export function createCascade(k1 = 0.06, k2 = 0.06) {
  const s = { a: 0, b: 0 };
  return {
    get value() { return s.b; },
    set(v) { s.a = s.b = v; },
    step(target, ratio, k) {
      s.a = lerp(s.a, target, damp(k ?? k1, ratio));
      s.b = lerp(s.b, s.a, damp(k ?? k2, ratio));
      return s.b;
    },
  };
}

// Pointer smoothing + lag velocity (distance between raw and smoothed pointer).
export function createPointerFilter({ lerpK = 0.05, velGain = 0.035, velFriction = 0.98 } = {}) {
  const p = { x: 0, y: 0, sx: 0, sy: 0, vel: 0 };
  return {
    state: p,
    set(x, y) { p.x = p.sx = x; p.y = p.sy = y; },
    target(x, y) { p.x = x; p.y = y; },
    step(ratio) {
      const t = damp(lerpK, ratio);
      p.sx = lerp(p.sx, p.x, t); p.sy = lerp(p.sy, p.y, t);
      const lag = Math.hypot(p.x - p.sx, p.y - p.sy);
      p.vel = clamp((p.vel + lag * velGain * ratio) * friction(velFriction, ratio));
      return p;
    },
  };
}
