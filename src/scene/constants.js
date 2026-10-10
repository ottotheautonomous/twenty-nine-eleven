// One source of truth for Sentinel's tuning, shared by shape, model, camera and both renderers.
const DEG = Math.PI / 180;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export const R = 1;                                   // shell radius, world units
export const FOV = 28 * DEG;                          // vertical; telephoto so it reads as an object
export const KEY = norm([-0.6, 0.5, -0.6]);           // direction TO the key light: upper-left-behind
export const LATTICE = { set: 1, tube: 0.02, tilt: [18 * DEG, 12 * DEG] };   // set 1 = 10 great circles; fallback set 0 (6)
export const TUBE_JITTER = 0.014;                 // tighter strands: a tube of light, not a chalk line
export const NODES = 64;
// The hand: an instant shove + drag where the pointer moves, measured ACROSS the view ray through the raw pointer, so the
// face under the hand feels it. radius in R (0.3 = 40 px at R 135); back: the far hemisphere's share (it stays coherent
// behind the scatter); spread: per-particle gain 1 +- spread, so neighbours part as sparks instead of the tube bending.
export const HAND = { radius: 0.3, back: 0.35, spread: 0.6, shove: 6e-3, drag: 1e-3 };
export const LAG = { poke: 0.85, wake: 0.955, pointer: 0.05, orbit: 0.05, particle: 0.10, velGain: 0.09, velFriction: 0.98, trailDecay: 0.985, trailGrow: 0.35, trailRadius: 0.05 };
export const EXPOSURE = { gain: 1.8, velPenalty: 0.6, decay: 0.992, show: 0.35, hide: 0.315 };
export const ORBIT = { yaw: 0.11, pitch: 0.04, shake: 0.008, idle: 0.026 };   // radians
export const EMBER = { coreR: 0.045, haloR: 0.42, hdr: 3.0, halo: 0.25, offset: 0.08 };   // in R
export const TIMING = { greet: 0.6, lose: 1.5, tier0Dwell: 0.4, tier0Radius: 0.3, sentryEvery: 9, sentryDur: 2.5, idleAfter: 4 };
// Integrity is a ledger. Under the hand the deficit only grows: a capped live reading of the trail (soft-saturating) or the
// damage accrued while the hand paints (rate acc, saturating), never below floor. After `quiet` s with no painting the reset
// fires: the deficit holds until the resync front crosses the shell, releases `release` of itself in one roll, then heals
// with half-life `heal` and seals under `sealAt`. Deficits under `event` heal silently (no word, no wave). Painting aborts.
export const INTEGRITY = { rest: 0.998, floor: 0.12, live: 1.6, liveCap: 0.3, acc: 0.78, active: 0.1, quiet: 1.0,
                           event: 0.09, release: 0.35, roll: 0.3, heal: 0.85, sealAt: 0.002, wave: 1.2, tearRef: 0.3 };
// The resync front: a ring leaving the ember across the visible disc (view-space radius), front * inOut3(t) over INTEGRITY.wave s. kick: velocity toward
// home as it passes; seal: per-60 Hz-frame fraction of trail cleared behind it; boost/grow: the tap's own light; ember: core pulse.
export const RESET = { front: 2.4, band: 0.14, kick: 0.012, seal: 0.35, boost: 1.5, grow: 0.3, ember: 0.3 };
// A tear is one fast pass: the raw probe path crossed the shell within `window` s while lag velocity exceeded `vel`; re-armed below `calm`.
export const TEAR = { vel: 0.35, window: 0.8, calm: 0.15, read: 0.15 };   // read: the finding latches once the hand is calm (= re-arm)
export const COLORS = { ink: '#06080B', haze: '#0E1219', slate: '#383E4E', shadow: '#2A313A', mid: '#9AA7B4', hi: '#C3CDD6', rim: '#D7E9F7', ember: '#F0A65E', hot: '#FFD8A6', breach: '#E5484D' };
export const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearRGB = (hex) => hexRGB(hex).map(srgbToLinear);
