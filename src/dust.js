// The cage's grain for the page's overlays (LIVING-SPEC §0: one material). PROTOTYPE (branch living-proto-dom): a copy of
// trigger-sparkle's grain code (its uncommitted src/sparkle.js, 2026-10-14), not yet the extraction sparkle would import from.
// Grain = the GL disc, alpha = 1 - smoothstep(0.75, 1, r^2), 1.68 px at a 270 px anchor; bead (0.35 + 1.6 g^3)(0.6 + 0.4 s);
// flicker 0.6 + 0.4 sin(0.8t + a) sin(1.73t + b); silver #CBD6DF, dawn #FFD8A6, glint #F4F7FA (<= 80 ms); 80 ms glint + 520 ms settle.

export const TAU = Math.PI * 2;
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
export const GLINT_MS = 80, SETTLE_MS = 520;

// Tone k of 0-5 mixes silver toward dawn by k * 0.12 (0 .. 0.6); k = 6 is the glint white. 32 px, drawn scaled (sub-pixel).
function sprite(k) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), im = g.createImageData(32, 32);
  const rgb = k > 5 ? [244, 247, 250] : [203, 214, 223].map((x, i) => Math.round(x + ([255, 216, 166][i] - x) * k * 0.12));
  c.width = c.height = 32;
  for (let i = 0; i < 1024; i++) {
    const u = ((i & 31) + 0.5) / 16 - 1, v = ((i >> 5) + 0.5) / 16 - 1, r2 = u * u + v * v, t = clamp((r2 - 0.75) * 4);
    im.data.set([...rgb, r2 < 1 ? 255 * (1 - t * t * (3 - 2 * t)) : 0], i * 4);
  }
  g.putImageData(im, 0, 0);
  return c;
}
let SPRITES = null;
export const sprites = () => SPRITES || (SPRITES = [0, 1, 2, 3, 4, 5, 6].map(sprite));

// The cage's skewed bead law: a few bright crisp grains in a dimmer body (mean ~0.6, ~5 % above 1.4).
export const bead = (g, s) => (0.35 + 1.6 * g * g * g) * (0.6 + 0.4 * s);
// The scene's flicker law (particles.js:125)
export const flicker = (t, a, b) => 0.6 + 0.4 * Math.sin(0.8 * t + a) * Math.sin(1.73 * t + b);
// Overlay colour law: silver, warmed toward dawn near the cage (lit by the ember). w <= 0.35 -> sprite tone 0..3.
export function warmTone(x, y, cage) {
  if (!cage) return 0;
  const d = Math.hypot(x - cage.cx, y - cage.cy), w = 0.35 * Math.exp(-Math.max(0, d - cage.R) / cage.R);
  return Math.round(w / 0.12);
}
// The cage's grain law on screen (webgl.js sizeK): 1.68 px at a 270 px anchor, x 1.15 on coarse pointers, clamped 1.4 .. 1.9.
export const grainSize = (anchorH, coarse) => clamp(((1.68 * anchorH) / 270) * (coarse ? 1.15 : 1), 1.4, 1.9);

// The house envelope by age (ms): an 80 ms glint (alpha 0 -> 2x, size 0.6 -> 1.2, white), then a 520 ms settle to the grain's tone.
// ease: the site's [0.22, 1, 0.36, 1]. Retirement is the same envelope played backwards.
export function envelope(ageMs, ease, out = {}) {
  if (ageMs < GLINT_MS) {
    const e = 1 - (1 - clamp(ageMs / GLINT_MS)) ** 3;
    out.alpha = 2 * e; out.size = 0.6 + 0.6 * e; out.glint = e;
  } else {
    const e = ease(clamp((ageMs - GLINT_MS) / SETTLE_MS));
    out.alpha = 2 - e; out.size = 1.2 - 0.2 * e; out.glint = 1 - e;
  }
  return out;
}

// Governor level (sparkle's table): full on a healthy desktop, less or none as the governor sheds, none on the static still.
export function levelFor({ type, tier, steps = 0, sprites: n } = {}) {
  if (!type || type === 'static') return 0;
  if (type === 'canvas2d' || tier === 'c2d') return (n ?? 3000) >= 3000 ? 0.5 : 0;
  if (tier === 'iphone' || tier === 'android') return steps ? 0 : 0.6;
  return steps === 0 ? 1 : steps <= 2 ? 0.6 : 0;
}

// Seeded hash in [0, 1) for a cell and a channel (the field is the same on every visit).
export function hash(x, y, k) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1) ^ 0x2911;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
