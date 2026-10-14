// One source of truth for Sentinel's tuning, shared by shape, model, camera and both renderers.
const DEG = Math.PI / 180;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export const R = 1;                                   // shell radius, world units
export const FOV = 28 * DEG;                          // vertical; telephoto so it reads as an object
export const KEY = norm([-0.6, 0.5, -0.6]);           // direction TO the key light: upper-left-behind
export const LATTICE = { set: 1, tube: 0.03, tilt: [18 * DEG, 12 * DEG] };   // set 1 = 10 great circles; fallback set 0 (6). tube: documentation only; sdf.glsl carries the value
export const TUBE_JITTER = 0.0225;                // the strand's radius (R): a thicker tube of light; xe's 393k grains keep it dense and the per-grain gain (particles.js) keeps it beaded
export const NODE_JITTER = 0.014;                 // the readout nodes are picked on v1.3's strand radius: the 64 nodes and their text do not move as the tube widens
export const NODES = 64;
// The hand: an instant shove + drag where the pointer moves, measured ACROSS the view ray through the raw pointer, so the
// face under the hand feels it. radius in R (0.3 = 40 px at R 135); back: the far hemisphere's share (it stays coherent
// behind the scatter); spread: per-particle gain 1 +- spread, so neighbours part as sparks instead of the tube bending.
export const HAND = { radius: 0.3, back: 0.35, spread: 0.6, shove: 6e-3, drag: 1e-3 };
export const LAG = { poke: 0.85, wake: 0.955, pointer: 0.05, orbit: 0.05, particle: 0.10, velGain: 0.09, velFriction: 0.98, trailDecay: 0.985, trailGrow: 0.35, trailRadius: 0.05 };
export const EXPOSURE = { gain: 1.8, velPenalty: 0.6, decay: 0.992, show: 0.35, hide: 0.315 };
export const ORBIT = { yaw: 0.11, pitch: 0.04, shake: 0.008, idle: 0.026 };   // radians
export const EMBER = { coreR: 0.045, haloR: 0.42, hdr: 3.0, halo: 0.25, offset: 0.08 };   // in R
// The ember is a light INSIDE the cage. light: its colour added to a grain's lit face (x emberLevel x the falloff); reach: view-plane
// sigma (R) of that light, so the cage outside the halo stays cold silver; falloff: radius (R) of the 1/(1+(d/falloff)^2) term (at rest
// every strut sits 1 R away: only a scattered particle that comes close flares); split: depth softness (R) of "nearer than the ember"
// (only those particles cover it); occCore/occHalo: the most a front strut takes from the core / the halo (x (1 - e^-3): floors 19 % / 57 %; the rest of the halo is the
// glow in the air in front of the strut: never cut); veil: the Canvas2D tier's erase under a front sprite.
export const EMBER_LIGHT = { light: 0.9, reach: 0.32, falloff: 1.0, split: 0.15, occCore: 0.85, occHalo: 0.45, veil: 0.8 };   // veil: one erase of the union (GL's core max ~0.81)
export const TIMING = { greet: 0.6, lose: 1.5, tier0Dwell: 0.4, tier0Radius: 0.3, sentryEvery: 9, sentryDur: 2.5, idleAfter: 4 };
// Integrity is a ledger. Under the hand the deficit only grows: a capped live reading of the trail (soft-saturating) or the
// damage accrued while the hand paints (rate acc, saturating), never below floor. After `quiet` s with no painting the reset
// fires: the deficit holds until the resync front crosses the shell, releases `release` of itself in one roll, then heals
// with half-life `heal` and seals under `sealAt`. Deficits under `event` heal silently (no word, no wave). Painting aborts.
export const INTEGRITY = { rest: 0.998, floor: 0.12, live: 1.6, liveCap: 0.3, acc: 0.78, active: 0.1, quiet: 1.0,
                           event: 0.09, release: 0.35, roll: 0.3, heal: 0.85, sealAt: 0.002, wave: 1.2, tearRef: 0.3 };
// The resync front: a ring leaving the ember across the visible disc (view-space radius), front * inOut3(t) over INTEGRITY.wave s. kick: velocity toward
// home as it passes; seal: per-60 Hz-frame fraction of trail cleared behind it; ember: core pulse (v1's click flare, 0.6 s).
// The ring's light is in RENDER_VS (x0.5 of the tap's boost, the tap's growth) and canvas2d.js.
export const RESET = { front: 2.4, band: 0.14, kick: 0.012, seal: 0.35, ember: 0.4 };
// A tear is one fast pass: the raw probe path crossed the shell within `window` s while lag velocity exceeded `vel`; re-armed below `calm`.
export const TEAR = { vel: 0.35, window: 0.8, calm: 0.15, read: 0.15 };   // read: the finding latches once the hand is calm (= re-arm)
export const COLORS = { ink: '#06080B', haze: '#0E1219', slate: '#383E4E', shadow: '#2A313A', mid: '#9AA7B4', hi: '#C3CDD6', rim: '#D7E9F7', ember: '#F0A65E', hot: '#FFD8A6', breach: '#E5484D' };
export const hexRGB = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearRGB = (hex) => hexRGB(hex).map(srgbToLinear);
// Device tilt (src/tilt.js): on phones and tablets the ember leans downhill as the device tilts, through the pointer's own lean
// (ember 0.08 R x lean, key light +0.35 x lean, haze 0.22 R x lean). Angles are degrees of gravity from a neutral that follows how
// the device is held: it follows once the device has been still for `settle` s (settleTau), creeps while it moves (driftTau), and
// catches up on a re-pose (> repose deg, until < reposeOut). lean = lean * tanh((t - dead * tanh(t / dead)) / soft).
// askIOS false (the owner, 2026-10-14: no prompts): requestPermission is never called, so iOS keeps the pointer-only page; on
// false: no tilt anywhere. ease: s, the smoothstep gain 0 -> 1 after every reseed, so tilt eases in and never switches on.
export const TILT = { on: true, askIOS: false, ease: 1.5,
  lean: 1.5, soft: 16, dead: 1.5, still: 4, settle: 2.0, settleTau: 3.0, driftTau: 20, repose: 40, reposeOut: 2, reposeTau: 0.4,
  side: [0.80, 0.95], warm: 300, gap: 500 };   // side: |screen-x . gravity| fade (held sideways under rotation lock); warm/gap: ms
