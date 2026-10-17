// One source of truth for Sentinel's tuning, shared by shape, model, camera and both renderers.
const DEG = Math.PI / 180;
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export const R = 1;                                   // shell radius, world units
export const FOV = 28 * DEG;                          // vertical; telephoto so it reads as an object
export const KEY = norm([-0.6, 0.5, -0.6]);           // direction TO the key light: upper-left-behind
export const LATTICE = { set: 1, tube: 0.03, tilt: [18 * DEG, 12 * DEG] };   // set 1 = 10 great circles; fallback set 0 (6). tube: the union SDF's radius (sdf.glsl, dead since the flow); the sim's own tube is particles.cfg.tube
export const TUBE_JITTER = 0.0225;                // the strand's radius (R): a thicker tube of light; xe's 393k grains keep it dense and the per-grain gain (particles.js) keeps it beaded
export const NODE_JITTER = 0.014;                 // the readout nodes are picked on v1.3's strand radius: the 64 nodes and their text do not move as the tube widens
export const NODES = 64;
// The hand: an instant shove + drag where the pointer moves, measured ACROSS the view ray through the raw pointer, so the
// face under the hand feels it. radius in R (0.59 = 80 px at R 135); back: the far hemisphere's share (it stays coherent
// behind the scatter); spread: per-particle gain 1 +- spread, so neighbours part as sparks instead of the tube bending.
// sat: the raw pointer speed (NDC heights/s) that gets the full shove; glow: the light under the hand (x the wake, RENDER_VS).
// Round one (2026-10-16) takes the owner's 3114 tune link: reach .59, far side .80, shove .0095, full force at 1.3, glow 1.6
// (the link's 2.0 bloomed 11 blocks on a brisk pass; 1.6 measures 4). shove / (1 - friction) = .119 stays under the .15 tear guard.
export const HAND = { radius: 0.59, back: 0.80, spread: 0.6, shove: 9.5e-3, drag: 1e-3, sat: 1.3, glow: 1.6 };
// wake .975: the glow under a resting pointer lingers 1.5 s (the link's .985: 2.5 s and a press bloom); trailDecay .95: the breach
// fades 90 % in 0.75 s (GPU trail and the CPU ledger grid together); trailGrow .40; trailRadius .10 H.
export const LAG = { poke: 0.85, wake: 0.975, pointer: 0.05, orbit: 0.05, particle: 0.10, velGain: 0.09, velFriction: 0.98, trailDecay: 0.95, trailGrow: 0.40, trailRadius: 0.10 };
export const EXPOSURE = { gain: 1.8, velPenalty: 0.6, decay: 0.992, show: 0.35, hide: 0.315 };
// radians. yaw .35: the camera turns far toward the pointer (owner's tune; the wordmark's parallax is normalised by the yaw, so it
// does not grow). yawCoarse: touch screens' yaw; null = yaw, until the owner chooses (a phone row slide at .35 swings the cage ~32°;
// .25 is the offered option, ?yawc=0.25 in test builds).
export const ORBIT = { yaw: 0.35, yawCoarse: null, pitch: 0.04, shake: 0.008, idle: 0.036 };
// Centre light (DEPTH-SPEC §3, retuned to the owner's link 2026-10-16): a big, present light (haloR 0.85 R), layered 3D body (coreK 82,
// gold body 0.52 * exp(-20 r^2)), slow incommensurate inner smoulder (lifeP 5.3 s / 8.9 s), and trailing glow inertia (trailMs 800)
// when the ember leans. Lengths in R; trailMs in milliseconds (the lab's share key et stays in seconds so the owner's link works).
export const EMBER = { coreR: 0.045, haloR: 0.85, hdr: 3.0, halo: 0.25, offset: 0.08, coreK: 82, body: 0.52, bodyK: 20, bodyMix: 0.4, life: [0.03, 0.04], lifeP: [5.3, 8.9], trailMs: 800 };
// The ember is a light INSIDE the cage. light: its colour added to a grain's lit face (x emberLevel x the falloff); reach: view-plane
// sigma (R) of that light (at .80 the back strands glow amber while the front strands, lit only on their inner rim, stay silver: the
// cage's depth at a glance); falloff: radius (R) of the 1/(1+(d/falloff)^2) term (at rest every strut sits 1 R away: only a scattered
// particle that comes close flares); split: depth softness (R) of "nearer than the ember" (only those particles cover it).
// The amber eclipse (TUNE-ADDENDUM §4): the struts may visibly eclipse the light; the light never breaks into lobes, never shows dark
// grit, and what the dust takes comes back as amber. occCore/occBody/occHaze: the most a saturated front strand takes from the core,
// the gold body (inside the cage) and the outer haze (the air in front of the struts, so the glow stays one shape). occDen/occBead:
// a grain covers by optical density x its own bead gain, so the beads block and the faint tube body barely does (full coverage per
// grain drew dark ragged outlines and dented the light's shape). redden: the light seen through dust turns from white-hot to the ember
// tone at the same luminance. keep: the core as a whole keeps >= 40 % (one value for the whole core; a floor one strand never reaches,
// for two struts crossing or a scatter cloud). scatter: forward scatter on front grains (off; if used, its own reach scatterR, never
// reach). veil: the Canvas2D tier's erase under the weighted front mask (with the same amber return and keep).
export const EMBER_LIGHT = { light: 2.5, reach: 0.80, falloff: 1.0, split: 0.15,
  occCore: 0.80, occBody: 0.60, occHaze: 0.40, occDen: 0.35, occBead: 1.0, redden: 0.55, keep: 0.40, scatter: 0, scatterR: 0.22, veil: 0.60 };
// The glyph haze (glyphs.js, composite.glsl): the haze around the cage, seen up close, is a field of the readouts' characters, lit by
// the ember from inside the cage and crossed by the strands' shadows. Characters never move; light moves over them. Lengths: pitch,
// size, stirPx, maskPx CSS px; inner/outer/falloff/wall shell radii; strut: the light a strand's shadow keeps; strutW: its half-width
// (rad on the sphere). peak: the display alpha of a fully lit cell (sRGB, added). rate: re-types per second per cell at light 1
// (x (0.3 + light)); stir: the rate's multiplier under the hand. settleMs: a new backing scale gets its own atlas once it has held this
// long (a resize's debounced 120 ms transient never does). Durations in milliseconds.
export const GLYPHS = { on: true, egg: false,
  pitch: [12, 18], pitchPhone: [11, 16], size: 10.5, sizePhone: 9.5,
  inner: [1.05, 1.20], outer: [1.70, 2.40], falloff: 0.55,
  peak: 0.078, peakPhone: 0.07, warm: 0.25, wall: 1.5, strut: 0.5, strutW: 0.05, maskPx: 8,
  lightMs: 140, rollMs: 60, rollSteps: 3, rate: 0.05, stir: 8, stirPx: 96, ripplePxMs: 0.7, rippleMs: 450,
  wake: [0.25, 0.5], wakeMs: 400, maskMs: 160, inMs: 1200, shedMs: 600, eggEveryMs: [60000, 120000], eggHoldMs: 2400, settleMs: 250 };
export const TIMING = { greet: 0.6, lose: 1.5, tier0Dwell: 0.4, tier0Radius: 0.3, sentryEvery: 9, sentryDur: 2.5, idleAfter: 4 };
// Integrity is a ledger. Under the hand the deficit only grows: a capped live reading of the trail (soft-saturating) or the
// damage accrued while the hand paints (rate acc, saturating), never below floor. After `quiet` s with no painting the reset
// fires: the deficit holds until the resync front crosses the shell, releases `release` of itself in one roll, then heals
// with half-life `heal` and seals under `sealAt`. Deficits under `event` heal silently (no word, no wave). Painting aborts.
// Round one: quiet 1.9 s (the ring arrives as the grains settle, tau ~1.07 s at friction .92); live/acc x5 (8.0 / 3.9), because the
// trail now forgets 3.4x faster (trailDecay .95): a brisk pass reads .075 again (4009e84 .072), a slow pass .011.
export const INTEGRITY = { rest: 0.998, floor: 0.12, live: 8.0, liveCap: 0.3, acc: 3.9, active: 0.1, quiet: 1.9,
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
export const DBG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
// Device tilt (src/tilt.js): on phones and tablets the ember leans downhill as the device tilts, through the pointer's own lean
// (ember 0.08 R x lean, key light +0.35 x lean, haze 0.22 R x lean). Angles are degrees of gravity from a neutral that follows how
// the device is held: it follows once the device has been still for `settle` s (settleTau), creeps while it moves (driftTau), and
// catches up on a re-pose (> repose deg, until < reposeOut). lean = lean * tanh((t - dead * tanh(t / dead)) / soft).
// askIOS false (the owner, 2026-10-14: no prompts): requestPermission is never called, so iOS keeps the pointer-only page; on
// false: no tilt anywhere. ease: s, the smoothstep gain 0 -> 1 after every reseed, so tilt eases in and never switches on.
export const TILT = { on: true, askIOS: false, ease: 1.5,
  lean: 1.5, soft: 16, dead: 1.5, still: 4, settle: 2.0, settleTau: 3.0, driftTau: 20, repose: 40, reposeOut: 2, reposeTau: 0.4,
  side: [0.80, 0.95], warm: 300, gap: 500 };   // side: |screen-x . gravity| fade (held sideways under rotation lock); warm/gap: ms
// The flow: each ring's dust slides along its own ring (flow.js). Grain homes turn about their ring's own axis, so the strands, the
// readout nodes and their labels never move; only the dust and its beads travel.
export const FLOW = {
  lap: 130,
  m: [1.296, 0.620, 1.127, 0.704, 0.873, 0.958, 0.789, 1.380, 1.211, 1.042],
  dir: [1, -1, 1, 1, 1, -1, -1, 1, 1, 1],
  vary: 0.15, period: [43, 71, 53, 89, 61, 47, 79, 59, 97, 67], phase: [0.3, 2.1, 4.0, 1.2, 5.5, 3.3, 0.9, 2.8, 4.7, 1.7],
  easeIn: 2400, resume: 1200, calm: 0.35, calmEase: 700,   // ms: the entrance ease; resume: the re-ease after pause, a panel or a hidden tab (flow.js resume); calm/calmEase: reading calm (not wired)
  depth: 0,   // round one's .18 hemisphere ramp, replaced by FORM.far + FORM.smoke (FORM-SPEC 2.2); the lab's dp row and its ROUND 1 preset keep it
};
// FORM (FORM-SPEC 2026-10-17): the see-through cage reads as one 3D form, front in front. Colour only, never the eclipse's coverage.
// far/curve: far fade x (1 - far * d^curve), d = (1 - z) / 2 by the grain's view depth z (R, +1 front pole); smoke: smoked-glass body
// x exp(-smoke * L), L = the view ray's path (R) inside the unit sphere in front of the grain; dist: camera distance (R), the FOV widens
// so the silhouette is identical (0 = round one's telephoto, 13.4 R desk / 18.9 R phone); tint: far tint at equal luminance x
// smoothstep(.35, 1, d), + toward the ember tone, - toward COLORS.mid; rim: limb brightening (off); c2d: Canvas2D's smoke = c2d x smoke.
export const FORM = { far: 0.20, curve: 2.0, smoke: 0.60, dist: 8.0, tint: 0.20, rim: 0, c2d: 2.0 };
// Test builds only (tree-shaken from production with DBG): window.__form (the live FORM object, read every frame) and
// ?form=<tokens>: off = round one's cues (FORM's cues 0, the telephoto camera, FLOW.depth .18); front / back = that layer alone,
// mirror = the depth-mirrored cage (the Necker alternative; split captures); far<N> / curve<N> / smoke<N> / tint<N> / rim<N> / c2d<N> /
// dp<N> = that value in % (tint-20 = cool), d<N> = FORM.dist in R (d0 = telephoto); spin<N> as ?spin=<N>: the camera orbits at N deg/s
// (camera.js, the flip test). mode 0 all / 1 front / 2 back / 3 mirror (particles.js, canvas2d.js).
if (DBG && typeof window !== 'undefined') {
  Object.assign(FORM, { mode: 0, spin: 0 });
  window.__form = FORM;
  const q = new URLSearchParams(location.search), sp = Number(q.get('spin'));
  if (Number.isFinite(sp)) FORM.spin = sp;
  const P = { far: 'far', curve: 'curve', smoke: 'smoke', tint: 'tint', rim: 'rim', c2d: 'c2d' };
  for (const t of (q.get('form') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (t === 'off') { Object.assign(FORM, { far: 0, smoke: 0, dist: 0, tint: 0, rim: 0 }); FLOW.depth = 0.18; }
    else if (t === 'front') FORM.mode = 1; else if (t === 'back') FORM.mode = 2; else if (t === 'mirror') FORM.mode = 3;
    else { const m = /^(c2d|[a-z]+)(-?\d+(?:\.\d+)?)$/.exec(t); if (!m) continue; const v = +m[2];
      if (P[m[1]]) FORM[P[m[1]]] = v / 100; else if (m[1] === 'd') FORM.dist = v; else if (m[1] === 'spin') FORM.spin = v; else if (m[1] === 'dp') FLOW.depth = v / 100; }
  }
}
// Test builds only (tree-shaken from production with DBG): ?eclipse=<tokens>, the owner clip's references and options, applied to
// EMBER_LIGHT at load (both renderers and the lab read it). Tokens: off (or 0) = no blocking, the measurement reference; raw = the
// owner's link as 3114 drew it (full coverage per grain, no amber, no keep, haze .60, the .03 sim tube); a number = occCore in % with
// the mechanism on (70 / 80 / 90; the Canvas2D veil scales with it); haze<N> / body<N> / den<N> / bead<N> / red<N> / keep<N> /
// sc<N> = that field in %.
if (DBG && typeof location !== 'undefined') {
  const L = EMBER_LIGHT, F = { haze: 'occHaze', body: 'occBody', den: 'occDen', bead: 'occBead', red: 'redden', keep: 'keep', sc: 'scatter' };
  for (const t of (new URLSearchParams(location.search).get('eclipse') || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (t === 'off' || t === '0') Object.assign(L, { occCore: 0, occBody: 0, occHaze: 0, redden: 0, keep: 0, veil: 0 });
    else if (t === 'raw') Object.assign(L, { occDen: 1, occBead: 0, redden: 0, keep: 0, occHaze: 0.60, veil: 0.30, simTube: 0.03 });
    else if (/^\d+$/.test(t)) { const v = +t / 100; L.veil *= v / L.occCore; L.occCore = v; }
    else { const m = /^([a-z]+)(\d+)$/.exec(t); if (m && F[m[1]]) L[F[m[1]]] = +m[2] / 100; }
  }
}
// Test builds only: ?glyphs=0 turns the glyph haze off (A/B); ?glyphs=egg forces the egg after ~2 s of idle (clips); ?glyphs=<n> sets
// the brightness of a fully lit cell to n/1000 (the default is 78; phones keep their ratio, .070 / .078), for the owner's 3115 review.
if (DBG && typeof location !== 'undefined') {
  const g = new URLSearchParams(location.search).get('glyphs');
  if (g === '0') GLYPHS.on = false;
  else if (g === 'egg') Object.assign(GLYPHS, { egg: true, eggEveryMs: [2000, 2000] });
  else if (/^\d+$/.test(g || '')) { const n = +g / 1000; GLYPHS.peakPhone = n * (0.07 / 0.078); GLYPHS.peak = n; }
}
