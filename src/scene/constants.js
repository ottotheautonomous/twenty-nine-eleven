// One source of truth for Sentinel's tuning, shared by shape, model, camera and both renderers.
const DEG = Math.PI / 180;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export const R = 1;                                   // shell radius, world units
export const FOV = 28 * DEG;                          // vertical; telephoto so it reads as an object
export const KEY = norm([-0.6, 0.5, -0.6]);           // direction TO the key light: upper-left-behind
export const LATTICE = { set: 1, tube: 0.02, tilt: [18 * DEG, 12 * DEG] };   // set 1 = 10 great circles; fallback set 0 (6)
export const TUBE_JITTER = 0.02;
export const NODES = 64;
export const LAG = { pointer: 0.05, orbit: 0.05, particle: 0.06, velGain: 0.035, velFriction: 0.98, trailDecay: 0.985, trailGrow: 0.35, trailRadius: 0.05 };
export const EXPOSURE = { gain: 1.8, velPenalty: 0.6, decay: 0.992, show: 0.35, hide: 0.315 };
export const ORBIT = { yaw: 0.11, pitch: 0.04, shake: 0.008, idle: 0.026 };   // radians
export const EMBER = { coreR: 0.045, haloR: 0.42, hdr: 3.0, halo: 0.25, offset: 0.08 };   // in R
export const TIMING = { greet: 0.6, lose: 1.5, tier0Dwell: 0.4, tier0Radius: 0.5, sentryEvery: 9, sentryDur: 2.5, idleAfter: 4 };
export const INTEGRITY = { rest: 0.998, slope: 0.45, floor: 0.85, tearRef: 0.3, tearEvent: 0.96, rearm: 0.99 };
export const COLORS = { ink: '#06080B', haze: '#0D1116', slate: '#383E4E', shadow: '#2A313A', mid: '#9AA7B4', hi: '#C3CDD6', rim: '#D7E9F7', ember: '#F0A65E', hot: '#FFD8A6', breach: '#E5484D' };
export const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearRGB = (hex) => hexRGB(hex).map(srgbToLinear);
