// The hand lab: a tuning panel for the mouse response, for the owner to feel the hand (?tune). Test builds only: sentinel.js imports
// this module behind the env expression (VITE_DEBUG_HOOKS=1 / dev), so a production build never emits it or its stylesheet.
// Spec: .review/handlab/fable/LAB-SPEC.md, round one's TUNE-ADDENDUM §8. Every slider writes the live object the renderer reads on its next
// frame (HAND, LAG, RESET, INTEGRITY, EMBER, EMBER_LIGHT, ORBIT, FLOW, FORM, and the WebGL2 renderer's particles.cfg / fluid.cfg), so a
// change lands within one drawn frame. LIVE is read from those objects at mount (the production values); the slider ends leave room past
// them. OWNER 10·16 is the owner's tune link as 3114 drew it (no eclipse mechanism, haze .60, the .03 tube), for an A/B in one page.
// FORM-SPEC §4 (2026-10-17): the depth-cue rows (sm ff pv ft, fc rm on MORE) and the FORM / ROUND 1 chips.
// CSP: no inline style attributes or <style>; classes from tune-lab.css, Motion (CSSOM) for the fades.
import './tune-lab.css';
import { animate } from 'motion';
import { HAND, LAG, RESET, INTEGRITY, EMBER, EMBER_LIGHT, ORBIT, FLOW, FORM, FOV } from './scene/constants.js';
import { PARTICLE_CFG } from './scene/particles.js';

const BASE = 'form (claude/form, from claude-round1-20261017)';   // the build these numbers describe
const FLUID_CFG = { splatGain: 1.0, splatRadius: 0.14, velocityDecay: 0.96 };   // webgl.js createFluid (the Canvas2D tier has no fluid)
const NARROW = '(max-width: 600px), (max-height: 640px)';
const fx = (v, d) => v.toFixed(d);
const secs90 = (keep) => Math.log(0.1) / Math.log(keep) / 60;   // a per-60 Hz-frame keep: seconds until 90 % is gone
const sec = (s) => (s >= 10 ? fx(s, 0) : s >= 1 ? fx(s, 1) : fx(s, 2)) + ' s';
// The spring's return (Fable §2): slow root of s² + c s + k with c = 1 - friction; underdamped: the envelope's 2 / c.
const tau = (k, fr) => { const c = 1 - fr, d = c * c - 4 * k; return (d >= 0 ? 2 / (c - Math.sqrt(d)) : 2 / c) / 60; };
// FORM's perspective (camera.js): a camera at D R with the FOV widened so the silhouette keeps round one's size (D0 = this layout's own
// distance); near/far = the size ratio of the front and back poles, (D + 1) / (D - 1).
const fovAt = (D, D0) => 2 * Math.atan(Math.tan(FOV / 2) * Math.sqrt(D0 * D0 - 1) / Math.sqrt(D * D - 1)) * 180 / Math.PI;

// gl: the row writes an object only the WebGL2 renderer has (or a wiring Canvas2D does not read): disabled on the Canvas2D tier.
// kind: live = read every frame as is; cfg = read every frame from the renderer's cfg copy; wiring = read live only in test builds
// (model.js's grid growth is fixed at load in production). The share-link key is the short name.
const PARAMS = [
  { key: 're', name: 'Reach', code: 'HAND.radius', kind: 'live', min: 0.10, max: 1.20, step: 0.01,
    write: (v) => { HAND.radius = v; }, show: (v, e) => `${fx(v, 2)} R · ${Math.round(v * e.R)} px` },
  { key: 'sh', name: 'Shove', code: 'HAND.shove → particles.cfg.shove', kind: 'cfg', min: 0, max: 0.048, step: 0.0005,
    write: (v, t) => { HAND.shove = v; if (t.p) t.p.shove = v; }, show: (v, e, x) => `×${fx(v / LIVE.sh, 2)} · ${Math.round((v / (1 - x.fr)) * e.R * 60)} px/s` },
  { key: 'dr', name: 'Drag', code: 'HAND.drag → particles.cfg.drag', kind: 'cfg', min: 0, max: 0.0050, step: 0.0001,   // above ~.005 at today's reach a brisk stroke runs to the 2.5 R bound (Fable r2 probe: .006 pile 197, .008 pile 1192)
    write: (v, t) => { HAND.drag = v; if (t.p) t.p.drag = v; }, show: (v) => `${fx(v, 4)} · ×${fx(v / LIVE.dr, 1)}` },
  { key: 'sp', name: 'Spread', code: 'HAND.spread', kind: 'live', min: 0, max: 1.50, step: 0.05,
    write: (v) => { HAND.spread = v; }, show: (v) => `±${Math.round(v * 100)} %` },
  { key: 'se', name: 'Full force at', tip: 'the pointer speed that gets the full shove: if a normal pass does nothing, lower this first (below ~1.0 a slow pass strikes hardest, it dwells longer)',
    code: 'HAND.sat (model.js: rawSpeed / sat)', kind: 'live', min: 0.4, max: 4.0, step: 0.1,
    write: (v) => { HAND.sat = v; }, show: (v, e) => `${fx(v, 1)} · ${Math.round((v * e.H) / 2)} px/s` },
  { key: 'pt', name: 'Shove tail', code: 'LAG.poke', kind: 'live', min: 0.50, max: 0.97, step: 0.005,
    write: (v) => { LAG.poke = v; }, show: (v) => `${fx(v, 3)} · ${sec(secs90(v))}` },
  { key: 'lt', name: 'Hand glow', tip: 'how bright the grains under the pointer light up; the light stays with the pointer (no trail: a grain goes dark as it leaves the hand)',
    code: 'HAND.glow (particles.js: uWake gain)', kind: 'live', gl: true, min: 0, max: 4.0, step: 0.05,
    write: (v) => { HAND.glow = v; }, show: (v) => `×${fx(v, 2)}` },
  { key: 'wt', name: 'Glow after you stop', tip: 'how long the patch under a resting pointer stays lit after the pointer stops',
    code: 'LAG.wake', kind: 'live', min: 0.80, max: 0.995, step: 0.005,
    write: (v) => { LAG.wake = v; }, show: (v) => `${fx(v, 3)} · ${sec(secs90(v))}` },
  { key: 'sg', name: 'Splat gain', code: 'fluid.cfg.splatGain', kind: 'cfg', gl: true, min: 0, max: 8.0, step: 0.1,
    write: (v, t) => { if (t.f) t.f.splatGain = v; }, show: (v) => `×${fx(v, 1)}` },
  { key: 'sr', name: 'Splat radius', code: 'fluid.cfg.splatRadius', kind: 'cfg', gl: true, min: 0.03, max: 0.50, step: 0.01,
    write: (v, t) => { if (t.f) t.f.splatRadius = v; }, show: (v, e) => `${fx(v, 2)} H · ${Math.round(v * e.H)} px` },
  { key: 'fp', name: 'Fluid push', code: 'particles.cfg.fluidPush', kind: 'cfg', gl: true, min: 0, max: 0.0030, step: 0.0001,
    write: (v, t) => { if (t.p) t.p.fluidPush = v; }, show: (v) => `${fx(v, 4)} · ×${fx(v / LIVE.fp, 1)}` },
  { key: 'tr', name: 'Trail radius', code: 'LAG.trailRadius', kind: 'live', min: 0, max: 0.20, step: 0.005,
    write: (v) => { LAG.trailRadius = v; }, show: (v, e) => `${fx(v, 3)} H · ${Math.round(v * e.H)} px` },
  { key: 'td', name: 'Trail decay', tip: 'how fast the breach fades (the GPU trail and the integrity ledger together); round one .950: 90 % gone in 0.75 s',
    code: 'LAG.trailDecay (webgl.js GPU trail, model.js grid)', kind: 'live', min: 0.900, max: 0.998, step: 0.001,
    write: (v) => { LAG.trailDecay = v; }, show: (v) => `${fx(v, 3)} · ${sec(secs90(v))}` },
  { key: 'rk', name: 'Reset kick', code: 'RESET.kick', kind: 'live', min: 0, max: 0.080, step: 0.002,
    write: (v) => { RESET.kick = v; }, show: (v) => `${fx(v, 3)} · ×${fx(v / LIVE.rk, 1)}` },
  // ---- FORM (FORM-SPEC §4): the depth cues, so the see-through cage reads as one 3D form, front in front (both renderers) ----
  { key: 'sm', name: 'Smoked glass', tip: 'the cage as a sphere of faintly smoked glass: a strand behind its front surface dims by the glass in front of it (front strands and the eclipse untouched; Canvas2D x2)',
    code: 'FORM.smoke', kind: 'live', min: 0, max: 1.50, step: 0.05,
    write: (v) => { FORM.smoke = v; }, show: (v) => `${fx(v, 2)} · back centre ×${fx(Math.exp(-2 * v), 2)}` },
  { key: 'ff', name: 'Far fade', tip: 'a gentle dimming by real depth, front pole to back pole (replaces Depth dim)',
    code: 'FORM.far', kind: 'live', min: 0, max: 0.60, step: 0.02,
    write: (v) => { FORM.far = v; }, show: (v) => `back pole −${Math.round(v * 100)} %` },
  { key: 'pv', name: 'Perspective', tip: 'the camera distance in sphere radii; the lens widens so the sphere keeps its size on screen: nearer = near strands larger than far ones (20 = round one\'s telephoto)',
    code: 'FORM.dist (20 writes 0 = telephoto)', kind: 'live', min: 5.0, max: 20.0, step: 0.5,
    write: (v) => { FORM.dist = v >= 20 ? 0 : v; },
    show: (v, e) => (v >= 20 || v >= e.D0 ? 'telephoto (round one)' : `${fx(v, 1)} R · near/far ${fx((v + 1) / (v - 1), 2)}× · FOV ${Math.round(fovAt(v, e.D0))}°`) },
  { key: 'ft', name: 'Far tint', tip: 'far strands lean toward the ember tone (+, warm) or the cool silver (−) at equal luminance; the front stays silver',
    code: 'FORM.tint', kind: 'live', min: -0.50, max: 0.50, step: 0.05,
    write: (v) => { FORM.tint = v; }, show: (v) => (v === 0 ? 'off' : `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)} % ${v > 0 ? 'warm' : 'cool'}`) },
  { key: 'bk', name: 'Far side', code: 'HAND.back', kind: 'live', more: true, min: 0, max: 1.00, step: 0.05,
    write: (v) => { HAND.back = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'tg', name: 'Trail grow', code: 'LAG.trailGrow (webgl.js GPU trail; model.js grid: test builds)', kind: 'wiring', more: true, min: 0, max: 0.80, step: 0.05,
    write: (v) => { LAG.trailGrow = v; }, show: (v) => fx(v, 2) },
  { key: 'k', name: 'Spring', code: 'particles.cfg.spring', kind: 'cfg', gl: true, more: true, min: 0.0002, max: 0.0050, step: 0.0001,
    write: (v, t) => { if (t.p) t.p.spring = v; }, show: (v, e, x) => `${fx(v, 4)} · τ ${sec(tau(v, x.fr))}` },
  { key: 'fr', name: 'Friction', code: 'particles.cfg.friction', kind: 'cfg', gl: true, more: true, min: 0.80, max: 0.97, step: 0.005,
    write: (v, t) => { if (t.p) t.p.friction = v; }, show: (v) => `keep ${fx(v, 3)}` },
  { key: 'fd', name: 'Wind decay', code: 'fluid.cfg.velocityDecay', kind: 'cfg', gl: true, more: true, min: 0.90, max: 0.995, step: 0.005,
    write: (v, t) => { if (t.f) t.f.velocityDecay = v; }, show: (v) => `${fx(v, 3)} · ${sec(secs90(v))}` },
  { key: 'q', name: 'Reset after', code: 'INTEGRITY.quiet', kind: 'live', more: true, min: 0.3, max: 3.0, step: 0.1,
    write: (v) => { INTEGRITY.quiet = v; }, show: (v) => `${fx(v, 1)} s` },
  // ---- Additional real-time scene & centre-light controls (ring swirl, lattice physics, ember 3D body, orbit) ----
  { key: 'lap', name: 'Ring lap', tip: 'seconds for a reference ring to complete one full revolution (higher = slower swirl)',
    code: 'FLOW.lap', kind: 'live', more: true, min: 30, max: 600, step: 10,
    write: (v) => { FLOW.lap = v; }, show: (v) => `${Math.round(v)} s` },
  { key: 'fv', name: 'Flow breath', tip: 'amplitude of the per-ring speed modulation',
    code: 'FLOW.vary', kind: 'live', more: true, min: 0, max: 0.50, step: 0.05,
    write: (v) => { FLOW.vary = v; }, show: (v) => `±${Math.round(v * 100)} %` },
  { key: 'dp', name: 'Depth dim', tip: 'round one\'s hemisphere ramp (the back half dims); FORM replaces it with Far fade and Smoked glass',
    code: 'FLOW.depth', kind: 'live', more: true, min: 0, max: 0.45, step: 0.02,
    write: (v) => { FLOW.depth = v; }, show: (v) => `−${Math.round(v * 100)} %` },
  { key: 'fc', name: 'Fade curve', tip: 'the far fade\'s shape by depth: higher keeps it on the back half, lower reaches toward the front',
    code: 'FORM.curve', kind: 'live', more: true, min: 1.0, max: 4.0, step: 0.1,
    write: (v) => { FORM.curve = v; }, show: (v, e, x) => `d^${fx(v, 1)} · limb −${Math.round(x.ff * Math.pow(0.5, v) * 100)} %` },
  { key: 'rm', name: 'Glass rim', tip: 'brightens the outline where front and back meet: a glass bubble, but it says nothing about front versus back',
    code: 'FORM.rim (RENDER_VS; the Canvas2D twin leaves it out)', kind: 'live', gl: true, more: true, min: 0, max: 0.50, step: 0.05,
    write: (v) => { FORM.rim = v; }, show: (v) => `+${Math.round(v * 100)} % at the limb` },
  { key: 'at', name: 'Tube pull', tip: 'how strongly scattered grains are pulled back into their own ring tube',
    code: 'particles.cfg.attract', kind: 'cfg', gl: true, more: true, min: 0, max: 0.0030, step: 0.0001,
    write: (v, t) => { if (t.p) t.p.attract = v; }, show: (v) => `${fx(v, 4)} · ×${fx(v / LIVE.at, 1)}` },
  { key: 'sw', name: 'Ambient swirl', tip: 'strength of the 4D curl-noise drift along the strands',
    code: 'particles.cfg.swirl', kind: 'cfg', gl: true, more: true, min: 0, max: 0.00040, step: 0.00001,
    write: (v, t) => { if (t.p) t.p.swirl = v; }, show: (v) => `${fx(v, 5)} · ×${fx(v / LIVE.sw, 1)}` },
  { key: 'sf', name: 'Swirl scale', tip: 'spatial frequency of the 4D curl-noise field',
    code: 'particles.cfg.swirlFreq', kind: 'cfg', gl: true, more: true, min: 2.0, max: 16.0, step: 0.5,
    write: (v, t) => { if (t.p) t.p.swirlFreq = v; }, show: (v) => fx(v, 1) },
  { key: 'bd', name: 'Outer bound', tip: 'hard spherical ceiling (in R) where thrown grains are clamped',
    code: 'particles.cfg.bound', kind: 'cfg', gl: true, more: true, min: 1.3, max: 4.0, step: 0.1,
    write: (v, t) => { if (t.p) t.p.bound = v; }, show: (v) => `${fx(v, 1)} R` },
  { key: 'sz', name: 'Grain size', tip: 'base point diameter in pixels',
    code: 'particles.cfg.sizePx', kind: 'cfg', gl: true, more: true, min: 0.80, max: 3.00, step: 0.04,
    write: (v, t) => { if (t.p) t.p.sizePx = v; }, show: (v) => `${fx(v, 2)} px` },
  { key: 'in', name: 'Cage light', tip: 'overall emissive intensity per particle',
    code: 'particles.cfg.intensity', kind: 'cfg', gl: true, more: true, min: 0.010, max: 0.080, step: 0.002,
    write: (v, t) => { if (t.p) t.p.intensity = v; }, show: (v) => `${fx(v, 3)} · ×${fx(v / LIVE.in, 2)}` },
  { key: 'eh', name: 'Ember size', tip: 'outer halo radius of the centre light (in R)',
    code: 'EMBER.haloR', kind: 'live', more: true, min: 0.25, max: 1.00, step: 0.01,
    write: (v) => { EMBER.haloR = v; }, show: (v, e) => `${fx(v, 2)} R · ${Math.round(v * e.R)} px` },
  { key: 'eb', name: 'Ember body', tip: 'strength of the intermediate warm gold 3D body around the core',
    code: 'EMBER.body', kind: 'live', gl: true, more: true, min: 0, max: 0.60, step: 0.02,
    write: (v) => { EMBER.body = v; }, show: (v) => fx(v, 2) },
  { key: 'et', name: 'Ember trail', tip: 'seconds the outer gold body/haze trails behind the hot core on lean (the link keeps seconds; the code holds ms)',
    code: 'EMBER.trailMs (x 1000)', kind: 'live', gl: true, more: true, min: 0, max: 1.20, step: 0.05,
    write: (v) => { EMBER.trailMs = 1000 * v; }, show: (v) => `${fx(v, 2)} s` },
  { key: 'el', name: 'Inner cast', tip: 'how strongly the centre ember illuminates nearby cage struts',
    code: 'EMBER_LIGHT.light', kind: 'live', more: true, min: 0, max: 3.5, step: 0.05,
    write: (v) => { EMBER_LIGHT.light = v; }, show: (v) => `×${fx(v, 2)}` },
  { key: 'er', name: 'Cast reach', tip: 'view-plane reach (in R) of the ember light on the cage',
    code: 'EMBER_LIGHT.reach', kind: 'live', more: true, min: 0.15, max: 1.00, step: 0.02,
    write: (v) => { EMBER_LIGHT.reach = v; }, show: (v) => `${fx(v, 2)} R` },
  { key: 'oc', name: 'Core veil', tip: 'the light blocking: how much a saturated front strand takes from the white core',
    code: 'EMBER_LIGHT.occCore', kind: 'live', gl: true, more: true, min: 0, max: 0.95, step: 0.05,
    write: (v) => { EMBER_LIGHT.occCore = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'oh', name: 'Body veil', tip: 'how much a front strand dims the gold body (inside the cage); before round one this also set the haze',
    code: 'EMBER_LIGHT.occBody', kind: 'live', gl: true, more: true, min: 0, max: 0.90, step: 0.05,
    write: (v) => { EMBER_LIGHT.occBody = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'oz', name: 'Haze veil', tip: 'how much a front strand dims the outer haze, the air in front of the struts (light, so the glow stays one shape)',
    code: 'EMBER_LIGHT.occHaze', kind: 'live', gl: true, more: true, min: 0, max: 0.90, step: 0.05,
    write: (v) => { EMBER_LIGHT.occHaze = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'od', name: 'Veil density', tip: 'optical density of one grain: low = a faint grain barely blocks and only the beads do (1 = every grain covers fully: grit)',
    code: 'EMBER_LIGHT.occDen', kind: 'live', gl: true, more: true, min: 0.05, max: 1.00, step: 0.05,
    write: (v) => { EMBER_LIGHT.occDen = v; }, show: (v) => fx(v, 2) },
  { key: 'ob', name: 'Bead veil', tip: 'share of the coverage weighted by each grain\'s bead gain (1 = the beads block, the faint body barely does)',
    code: 'EMBER_LIGHT.occBead', kind: 'live', more: true, min: 0, max: 1.00, step: 0.05,
    write: (v) => { EMBER_LIGHT.occBead = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'rd', name: 'Amber', tip: 'light seen through dust turns from white-hot toward the ember tone (equal luminance)',
    code: 'EMBER_LIGHT.redden', kind: 'live', more: true, min: 0, max: 1.00, step: 0.05,
    write: (v) => { EMBER_LIGHT.redden = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'kp', name: 'Keep', tip: 'the least the core as a whole keeps (a floor for two struts crossing; one strand never reaches it)',
    code: 'EMBER_LIGHT.keep', kind: 'live', more: true, min: 0, max: 0.90, step: 0.05,
    write: (v) => { EMBER_LIGHT.keep = v; }, show: (v) => `${Math.round(v * 100)} %` },
  { key: 'tu', name: 'Tube', tip: 'radius (R) of the strand\'s attract-free tube in the sim: the swirl wanders within it (round one .019 holds the strand at 4009e84\'s width)',
    code: 'particles.cfg.tube (SIM_FS uTubeR)', kind: 'cfg', gl: true, more: true, min: 0.010, max: 0.040, step: 0.001,
    write: (v, t) => { if (t.p) t.p.tube = v; }, show: (v, e) => `${fx(v, 3)} R · ${fx(v * e.R, 1)} px` },
  { key: 'yw', name: 'Orbit yaw', tip: 'how far the cage turns horizontally toward the pointer (radians)',
    code: 'ORBIT.yaw', kind: 'live', more: true, min: 0, max: 0.50, step: 0.01,
    write: (v) => { ORBIT.yaw = v; }, show: (v) => `${fx(v, 2)} rad · ${Math.round((v * 180) / Math.PI)}°` },
  { key: 'id', name: 'Idle drift', tip: 'amplitude of the slow Lissajous camera drift when idle',
    code: 'ORBIT.idle', kind: 'live', more: true, min: 0, max: 0.080, step: 0.002,
    write: (v) => { ORBIT.idle = v; }, show: (v) => `${fx(v, 3)} rad` },
];
for (const p of PARAMS) p.dec = (String(p.step).split('.')[1] || '').length;   // values are written with the step's decimals
const KEYS = PARAMS.map((p) => p.key);
const BY_KEY = new Map(PARAMS.map((p) => [p.key, p]));
// The presets from before round one (4009e84's values for every key a preset does not set). The eclipse rows did not exist then: a legacy
// preset carries the old drawing (every grain covers fully, no amber, no keep, the haze veiled as the body, the .03 tube).
const LEGACY_KEYS = ['re', 'sh', 'dr', 'sp', 'se', 'pt', 'lt', 'wt', 'sg', 'sr', 'fp', 'tr', 'td', 'rk', 'bk', 'tg', 'k', 'fr', 'fd', 'q',
  'lap', 'fv', 'dp', 'at', 'sw', 'sf', 'bd', 'sz', 'in', 'eh', 'eb', 'et', 'el', 'er', 'oc', 'oh', 'yw', 'id'];
const EXTRA_DEFAULTS = [150, 0.15, 0.18, 0.0009, 0.00007, 7.0, 2.5, 1.68, 0.030, 0.46, 0.20, 0.25, 0.90, 0.32, 0.30, 0.20, 0.11, 0.026];
// FORM's rows as round one drew them (the hemisphere ramp dp .18 is a legacy key: EXTRA_DEFAULTS carries it): every preset from before
// claude/form draws without the depth cues.
const CUES_R1 = Object.freeze({ sm: 0, ff: 0, fc: 2.0, pv: 20, ft: 0, rm: 0 });
const row = (...v) => {
  const full = [...v, ...EXTRA_DEFAULTS.slice(Math.max(0, v.length - 20))];
  const o = Object.fromEntries(LEGACY_KEYS.map((k, i) => [k, full[i]]));
  return Object.freeze({ ...o, oz: o.oh, od: 1, ob: 0, rd: 0, kp: 0, tu: 0.03, ...CUES_R1 });
};

// Fable §4 as retuned in .review/handlab/fable-r1/REVIEW.md (watched on the real GPU at 1440x900 dpr 2, brisk and slow passes).
// Keys in table order: re sh dr sp se pt lt wt sg sr fp tr td rk | bk tg k fr fd q | lap fv dp at sw sf bd sz in eh eb et el er oc oh yw id.
const PRESETS = {
  live: { label: 'LIVE', tip: 'claude/form as built: round one with the FORM depth cues (read from the code at mount)', v: null },
  form: { label: 'FORM', tip: 'The recommended depth cues: smoked glass .60, far fade .20, perspective 8 R, warm far .20 (round one\'s Depth dim off)', v: null },
  r1: { label: 'ROUND 1', tip: 'claude-round1-20261017 exactly: LIVE without the depth cues (Depth dim .18, the telephoto camera)', v: null },
  owner: { label: 'OWNER 10·16', tip: 'Your tune link of 2026-10-16 exactly as 3114 drew it: no eclipse mechanism (grit and the dented light), haze .60, the .03 tube, cage light .036, hand glow 2.0, glow after stop .985', v: null },
  v15: { label: 'v1.5', tip: 'The hand published in v1.5 and 4009e84 (the old LIVE)',
    v: row(0.30, 0.006, 0.001, 0.60, 2.0, 0.85, 1.0, 0.955, 1.0, 0.14, 0.0007, 0.05, 0.985, 0.012, 0.35, 0.35, 0.0010, 0.90, 0.98, 1.0) },
  yours: { label: 'YOURS', tip: 'Owner hand pick: WAKE with stronger shove (.0095), drag (.0010), spread (±85 %) and longer glide (.940)',
    v: row(0.90, 0.0095, 0.0010, 0.85, 1.3, 0.85, 2.0, 0.985, 1.0, 0.14, 0.0007, 0.10, 0.992, 0.012, 0.80, 0.45, 0.0010, 0.94, 0.98, 1.0) },
  shove: { label: 'SHOVE', tip: 'Forceful shove: the near face is punched open and bows away; sparks fan out at the exit and sail back',
    v: row(0.60, 0.013, 0.001, 0.20, 1.2, 0.88, 1.6, 0.960, 1.0, 0.14, 0.0007, 0.06, 0.985, 0.030, 0.50, 0.35, 0.0012, 0.92, 0.98, 1.0) },
  drag: { label: 'DRAG', tip: 'Magnetic drag: strands follow the hand like taffy, hang a beat and return',
    v: row(0.60, 0.002, 0.0020, 0.15, 1.3, 0.93, 1.3, 0.970, 1.2, 0.18, 0.0009, 0.05, 0.985, 0.012, 0.60, 0.35, 0.0007, 0.90, 0.985, 1.0) },
  ripple: { label: 'RIPPLE', tip: 'Wash: a wide, weak wind leans the whole cage along the stroke and sways it back over ~2 s',
    v: row(0.45, 0.008, 0.001, 0.40, 1.4, 0.85, 1.3, 0.960, 1.5, 0.30, 0.0007, 0.07, 0.985, 0.020, 0.50, 0.45, 0.0007, 0.90, 0.98, 1.0) },
  wake: { label: 'WAKE', tip: 'Luminous hand: a wide lamp under the pointer that lingers where it stops; the breach rim stays lit along the stroke (over budget on purpose)',
    v: row(0.90, 0.004, 0.0005, 0.30, 1.3, 0.85, 2.0, 0.985, 1.0, 0.14, 0.0007, 0.10, 0.992, 0.012, 0.80, 0.45, 0.0010, 0.90, 0.98, 1.0) },
  holds: { label: 'HOLDS', tip: 'Violent but holds together: struck hard, snaps back in a second, heals at once',
    v: row(0.50, 0.018, 0.002, 0.35, 1.2, 0.88, 1.3, 0.940, 1.5, 0.14, 0.0010, 0.05, 0.975, 0.040, 0.40, 0.35, 0.0025, 0.88, 0.97, 0.6) },
};
// The owner's link (p:yours + these keys) as a preset; the haze followed the halo veil then.
PRESETS.owner.v = Object.freeze({ ...PRESETS.yours.v, re: 0.59, sp: 0.60, td: 0.950, tg: 0.40, fr: 0.920, fd: 0.960, q: 1.9, lap: 130, sw: 0.00016, sf: 6.5,
  bd: 1.8, sz: 1.48, in: 0.036, eh: 0.85, eb: 0.52, et: 0.80, el: 2.50, er: 0.80, oc: 0.80, oh: 0.60, oz: 0.60, yw: 0.35, id: 0.036 });
const LEGACY = new Set(['v15', 'yours', 'shove', 'drag', 'ripple', 'wake', 'holds']);   // links on these bases: an oh without oz sets both
let LIVE = null;   // set at mount from the live objects (liveRow)
const snap = (p, v) => Number((Math.round(v / p.step) * p.step).toFixed(p.dec));
function liveRow(t) {
  const p = t.p || PARTICLE_CFG, f = t.f || FLUID_CFG, L = EMBER_LIGHT;
  const v = { re: HAND.radius, sh: HAND.shove, dr: HAND.drag, sp: HAND.spread, se: HAND.sat, pt: LAG.poke, lt: HAND.glow, wt: LAG.wake,
    sg: f.splatGain, sr: f.splatRadius, fp: p.fluidPush, tr: LAG.trailRadius, td: LAG.trailDecay, rk: RESET.kick, bk: HAND.back, tg: LAG.trailGrow,
    k: p.spring, fr: p.friction, fd: f.velocityDecay, q: INTEGRITY.quiet, lap: FLOW.lap, fv: FLOW.vary, dp: FLOW.depth, at: p.attract, sw: p.swirl,
    sf: p.swirlFreq, bd: p.bound, sz: p.sizePx, in: p.intensity, eh: EMBER.haloR, eb: EMBER.body, et: EMBER.trailMs / 1000, el: L.light, er: L.reach,
    oc: L.occCore, oh: L.occBody, oz: L.occHaze, od: L.occDen, ob: L.occBead, rd: L.redden, kp: L.keep, tu: p.tube ?? PARTICLE_CFG.tube, yw: ORBIT.yaw, id: ORBIT.idle,
    sm: FORM.smoke, ff: FORM.far, fc: FORM.curve, pv: FORM.dist > 0 ? Math.min(20, FORM.dist) : 20, ft: FORM.tint, rm: FORM.rim };
  return Object.freeze(Object.fromEntries(PARAMS.map((q) => [q.key, snap(q, v[q.key])])));
}

// Warning dots (Fable §6). Strictly greater/less than the threshold, with a hair of tolerance so a value sitting exactly on one is
// never flagged by floating-point noise (HOLDS must stay clean).
const over = (a, b) => a > b * (1 + 1e-9) + 1e-15, under = (a, b) => a < b * (1 - 1e-9) - 1e-15;
function warnings(x) {
  const F = {}, add = (k, why) => (F[k] ||= []).push(why);
  const c = Number((1 - x.fr).toFixed(4));
  if (over(x.lt * x.in / 0.032, 1.6)) add('lt', 'over the bloom budget (more than 4 blocks over .8 on a brisk pass; measured 1.6 at cage light .032)');
  if (over(x.oc, 0.5) && over(x.od * Math.max(0.2, 1 - x.ob), 0.6)) add('oc', 'every grain covers fully: dark gritty outlines along strands over the light, and the light dents');
  if (over(x.kp, 0.5)) add('kp', 'the keep engages for a single strand over the big core and halves the light blocking');
  if (under(x.td, 0.95)) add('td', 'a slow pass barely registers on the integrity readout');
  if (over(x.tu, 0.024) && over(x.sw, 0.0001)) add('tu', 'the swirl spreads the strand: wider and fuzzier than 4009e84 (the .03 tube: +34 %)');
  if (over(x.re, 0.6) && over(x.lt, 1.0)) add('re', 'a wide bright hand: bloom blooms over the limb');
  if (over(x.wt, 0.98)) add('wt', 'the glow under a resting pointer lasts longer than 1.9 s');
  if (over(x.sh / c, 0.15)) { const why = 'a saturated pass throws grains past 1.4 R: the cage tears'; add('sh', why); if (x.fr !== LIVE.fr) add('fr', why); }
  if (over((4 * x.dr * x.re) / c, 0.05)) add('dr', 'a brisk stroke rides the hand: strands run out to the 2.5 R bound');
  if (over(x.sp, 1.0)) add('sp', 'negative gains: some grains are pulled in, the strand frays');
  if (under(x.k, 4e-4)) add('k', 'recovery slower than 8 s: the cage sags');
  if (over(x.k, (c * c) / 4)) { const why = 'underdamped: grains overshoot home and bounce'; add('k', why); add('fr', why); }
  if (over((x.sg * x.fp) / (1 - x.fd), 0.10)) { const why = 'the wind alone tears the cage (a slow pass first)'; add('sg', why); add('fp', why); if (x.fd !== LIVE.fd) add('fd', why); }
  if (over(x.tr, 0.12)) add('tr', 'integrity floors in one pass; RESTORING repeats');
  if (over(x.td, 0.993)) add('td', 'the breach lingers longer than 5.5 s');
  if (over(x.rk, 0.04)) add('rk', 'the ring overshoots: a visible bounce at the heal');
  if (under(x.q, 0.5)) add('q', "the heal fires inside a gesture's pauses");
  if (over(x.sm, 1.0)) add('sm', 'the back half goes dark: the amber back, the light inside, fades out');
  if (under(x.pv, 6.5)) add('pv', 'wide-angle: front strands more than 2 % wider, readouts move more than 5 px');
  if (over(Math.abs(x.ft), 0.35)) add('ft', 'the tint reads as a colour change, not light');
  if (over(x.rm, 0.25)) add('rm', 'the outline reads as a flat ring');
  if (x.sm === 0 && x.ff === 0 && under(x.dp, 0.1)) { const why = 'no depth cue: the back is brighter than the front and the cage can turn inside out'; add('sm', why); add('ff', why); }
  return F;
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  el.append(...kids);
  return el;
}
const safeDecode = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };

export function mountTuneLab({ canvas, model, uniforms, getRenderer, params }) {
  let warned = false;
  const guard = (fn) => (...a) => {
    try { return fn(...a); } catch (err) { if (!warned) { warned = true; console.warn('[tune-lab]', err); } return undefined; }
  };

  const targets = () => { const r = getRenderer(); return { p: r?.particles?.cfg || null, f: r?.fluid?.cfg || null, gl: r?.type === 'webgl2' }; };
  PRESETS.live.v = LIVE = liveRow(targets());   // the production values as the code holds them (before any slider writes)
  PRESETS.form.v = Object.freeze({ ...LIVE, sm: 0.60, ff: 0.20, fc: 2.0, pv: 8.0, ft: 0.20, rm: 0, dp: 0 });   // FORM-SPEC §0 (= LIVE unless a test knob moved FORM)
  PRESETS.r1.v = Object.freeze({ ...LIVE, ...CUES_R1, dp: 0.18 });
  const vals = { ...LIVE };
  let base = 'live';                                       // the preset the share link starts from
  const env = () => {   // R in CSS px once the camera has a frame (the lab can mount before it: 135 px is the 1440x900 anchor)
    const cam = model.cam, r = cam?.ready && cam.shellPx?.r > 1 && cam.scaleY > 0 ? cam.shellPx.r / cam.scaleY : 135;
    return { R: r, H: innerHeight, D0: cam?.ready && cam.d0 > 1 ? cam.d0 : 13.37 };   // D0: this layout's own camera distance (camera.js; 13.37 R at 1440x900)
  };
  const clean = (p, v) => {
    v = typeof v === 'string' ? (v.trim() === '' ? NaN : Number(v)) : typeof v === 'number' ? v : NaN;
    if (!Number.isFinite(v)) v = LIVE[p.key];
    v = Math.min(p.max, Math.max(p.min, v));
    v = Number((Math.round(v / p.step) * p.step).toFixed(p.dec));
    return Math.min(p.max, Math.max(p.min, v));
  };
  const same = (n) => KEYS.every((k) => PRESETS[n].v[k] === vals[k]);
  const matchPreset = () => (same(base) ? base : Object.keys(PRESETS).find(same)) || null;   // the chosen preset wins a tie (LIVE and FORM hold the same values)
  function tuneState() {
    const m = matchPreset(); if (m) base = m;
    const b = PRESETS[base].v, diffs = KEYS.filter((k) => vals[k] !== b[k]).map((k) => `${k}:${fx(vals[k], BY_KEY.get(k).dec)}`);
    return base === 'live' && !diffs.length ? '' : [`p:${base}`, ...diffs].join(',');
  }
  function link(st = tuneState()) {
    const other = location.search.replace(/^\?/, '').split('&').filter((s) => s && safeDecode(s.split('=')[0]) !== 'tune');
    return `${location.origin}${location.pathname}?${[...other, st ? `tune=${st}` : 'tune'].join('&')}${location.hash}`;
  }
  const json = () => { tuneState(); return JSON.stringify({ base: BASE, preset: base, ...vals }); };   // preset: the one the values start from

  // ---- DOM (classes only; Motion writes opacity through CSSOM) ----
  const panel = h('aside', { class: 'tune-lab', role: 'group', 'aria-label': 'Hand tuning lab' });
  const kicker = h('span', { class: 'tune-kicker', text: 'TUNE // HAND' });
  const presetEl = h('span', { class: 'tune-preset', text: 'LIVE', 'aria-live': 'polite' });
  const fold = h('button', { class: 'tune-fold', type: 'button', 'aria-expanded': 'true', 'aria-label': 'Collapse', text: '▾' });
  const hint = h('span', { class: 'tune-hint', title: 'H hides the lab', 'aria-hidden': 'true', text: 'H' });
  const body = h('div', { class: 'tune-body' });
  panel.append(h('header', { class: 'tune-head' }, kicker, presetEl, h('span', { class: 'tune-gap' }), fold, hint), body);

  const chipBox = h('div', { class: 'tune-presets' });
  const chips = Object.entries(PRESETS).map(([name, pr]) => {
    const b = h('button', { class: 'tune-chip', type: 'button', 'data-preset': name, 'aria-pressed': 'false', title: pr.tip, text: pr.label });
    chipBox.append(b);
    return b;
  });
  const rowsMain = h('div', { class: 'tune-rows' });
  const rowsMore = h('div', { class: 'tune-rows tune-shelf', hidden: true });
  const ui = new Map();
  for (const p of PARAMS) {
    const id = `tune-${p.key}`;
    const warn = h('span', { class: 'tune-warn', hidden: true });
    const num = h('span', { class: 'tune-num' });
    const out = h('output', { class: 'tune-val', for: id }, warn, num);
    const name = h('label', { class: 'tune-name', for: id, title: `${p.tip ? `${p.tip} · ` : ''}${p.code} · ${p.kind} · today ${fx(LIVE[p.key], p.dec)}`, text: p.name });
    const input = h('input', { id, type: 'range', min: p.min, max: p.max, step: p.step, 'aria-label': p.name });
    input.value = String(vals[p.key]);
    const el = h('div', { class: 'tune-row', 'data-key': p.key }, name, out, input);
    (p.more ? rowsMore : rowsMain).append(el);
    ui.set(p.key, { el, input, out, num, warn });
    input.addEventListener('input', guard(() => setValue(p.key, input.value)));
  }
  const more = h('button', { class: 'tune-more', type: 'button', 'aria-expanded': 'false', text: 'MORE' });
  const resetB = h('button', { class: 'tune-act', type: 'button', title: 'Back to the published hand, and every grain snaps home: a clean cage to compare against', text: 'RESET' });
  const copyV = h('button', { class: 'tune-act', type: 'button', title: 'One line of JSON with all values, for pasting back', text: 'COPY VALUES' });
  const copyL = h('button', { class: 'tune-act', type: 'button', title: 'A link that opens the lab with these values', text: 'COPY LINK' });
  const actions = h('div', { class: 'tune-actions' }, resetB, copyV, copyL);
  const note = h('p', { class: 'tune-note', text: 'shoves start 1.9 s after load · RESET also snaps every grain home · GL-only rows are off on Canvas2D' });
  body.append(chipBox, rowsMain, more, rowsMore, actions, note);

  // ---- state → live objects → readouts ----
  function writeOne(p, t) { p.write(vals[p.key], t); }
  let shownR = 0, shownD0 = 0;
  function refresh() {
    const t = targets(), e = env(), F = warnings(vals), m = matchPreset();
    shownR = Math.round(e.R); shownD0 = e.D0;
    if (m) base = m;
    for (const p of PARAMS) {
      const u = ui.get(p.key), off = !!(p.gl && !t.gl);   // a boolean: toggle(name, undefined) would FLIP the class on every refresh (the non-GL rows blinked dim on every slider tick)
      u.el.classList.toggle('is-off', off); u.input.disabled = off;
      if (u.input.value !== String(vals[p.key]) && Number(u.input.value) !== vals[p.key]) u.input.value = String(vals[p.key]);
      u.num.textContent = off ? 'GL only' : p.show(vals[p.key], e, vals);
      const why = off ? null : F[p.key];
      u.warn.hidden = !why;
      if (why) { u.warn.title = why.join(' · '); u.out.title = why.join(' · '); } else { u.warn.removeAttribute('title'); u.out.removeAttribute('title'); }
    }
    presetEl.textContent = m ? PRESETS[m].label : 'CUSTOM';
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.preset === m)));
  }
  let urlTimer = 0;
  function writeURL() {
    clearTimeout(urlTimer); urlTimer = 0;
    const url = link();
    if (url !== location.href) history.replaceState(history.state, '', url);
  }
  const scheduleURL = () => { clearTimeout(urlTimer); urlTimer = setTimeout(guard(writeURL), 250); };

  function setValue(key, v) {
    const p = BY_KEY.get(String(key));
    if (!p) return undefined;
    vals[p.key] = clean(p, v);
    writeOne(p, targets());
    refresh();
    scheduleURL();
    return vals[p.key];
  }
  function apply(name, { url = true } = {}) {
    name = String(name).toLowerCase();
    if (!Object.hasOwn(PRESETS, name)) return false;
    base = name;
    const t = targets();
    for (const p of PARAMS) { vals[p.key] = PRESETS[name].v[p.key]; writeOne(p, t); }
    refresh();
    if (url) writeURL();
    return true;
  }
  function reapply() { const t = targets(); for (const p of PARAMS) writeOne(p, t); refresh(); }
  // A violent setting can leave grains parked on a neighbouring tube (~.85 R from home, where the tube's pull balances the spring), which
  // the reset ring does not clear; RESET puts every grain back at home so the next comparison starts from a clean cage. WebGL2 only (the
  // debug build exposes its particles); the clear lands between frames and the next sim step, which runs before the draw, relights it.
  // Not on the composed still (motion off): that frame is seeded once and never stepped, so a clear would leave it unlit; it is at home.
  function reseed() { const pt = getRenderer()?.particles; if (!pt?.reset || still()) return false; pt.reset(); return true; }

  // ?tune=p:<preset>,key:value,…  Unknown keys and non-finite values are ignored; values clamp to the range; unknown preset = LIVE.
  function parse(raw) {
    const toks = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
    let p0 = 'live';
    const sets = [];
    for (const tok of toks) {
      const i = tok.indexOf(':'); if (i <= 0) continue;
      const k = tok.slice(0, i).trim().toLowerCase(), v = tok.slice(i + 1).trim();
      if (k === 'p') { p0 = Object.hasOwn(PRESETS, v.toLowerCase()) ? v.toLowerCase() : 'live'; continue; }
      if (!BY_KEY.has(k) || v === '' || !Number.isFinite(Number(v))) continue;
      sets.push([k, Number(v)]);
    }
    return { p0, sets };
  }

  // ---- fades: entrances ease out, exits are the same fade reversed; hidden only once the exit has finished ----
  const slots = { panel: {}, body: {}, shelf: {} };
  function fadeIn(el, slot, duration) {
    const was = el.hidden;
    el.hidden = false;
    slot.a?.stop();
    slot.a = animate(el, { opacity: was ? [0, 1] : 1 }, { duration, ease: 'easeOut' });
  }
  function fadeOut(el, slot, duration) {
    slot.a?.stop();
    const a = (slot.a = animate(el, { opacity: 0 }, { duration, ease: 'easeIn' }));
    a.then(() => { if (slot.a === a) el.hidden = true; }, () => {});
  }
  let open = true, shown = true, moreOpen = false;
  function setOpen(on) {
    open = on;
    fold.setAttribute('aria-expanded', String(on)); fold.setAttribute('aria-label', on ? 'Collapse' : 'Expand'); fold.textContent = on ? '▾' : '▸';
    if (on) fadeIn(body, slots.body, 0.12); else fadeOut(body, slots.body, 0.12);
  }
  function setMore(on) {
    moreOpen = on;
    more.setAttribute('aria-expanded', String(on));
    if (on) fadeIn(rowsMore, slots.shelf, 0.12); else fadeOut(rowsMore, slots.shelf, 0.12);
  }
  function setShown(on) {
    shown = on;
    if (!on && panel.contains(document.activeElement)) document.activeElement.blur();
    if (on) fadeIn(panel, slots.panel, 0.18); else fadeOut(panel, slots.panel, 0.18);
  }

  const revert = new WeakMap();
  async function copy(btn, text, label) {
    let ok = false;
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch { ok = false; }
    if (!ok) {
      actions.querySelector('.tune-copy')?.remove();
      const field = h('input', { class: 'tune-copy', type: 'text', readonly: true, 'aria-label': `${label}: select and copy` });
      field.value = text;
      actions.append(field);
      field.focus({ preventScroll: true }); field.select();
      const drop = () => field.remove();
      field.addEventListener('blur', drop, { once: true });
      setTimeout(drop, 10000);
    }
    btn.textContent = ok ? 'COPIED' : 'SELECT+COPY';
    clearTimeout(revert.get(btn));
    revert.set(btn, setTimeout(() => { btn.textContent = label; }, ok ? 1200 : 2000));
    return ok;
  }

  // ---- events ----
  chips.forEach((c) => c.addEventListener('click', guard(() => apply(c.dataset.preset))));
  fold.addEventListener('click', guard(() => setOpen(!open)));
  more.addEventListener('click', guard(() => setMore(!moreOpen)));
  resetB.addEventListener('click', guard(() => { apply('live'); reseed(); }));
  copyV.addEventListener('click', guard(() => copy(copyV, json(), 'COPY VALUES')));
  copyL.addEventListener('click', guard(() => { writeURL(); return copy(copyL, link(), 'COPY LINK'); }));
  document.addEventListener('keydown', guard((e) => {
    if ((e.key !== 'h' && e.key !== 'H') || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.isComposing) return;
    const t = e.target;
    if (t instanceof Element && (t.closest('textarea, select, [contenteditable]:not([contenteditable="false"])') || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
    if (document.querySelector('dialog[open]')) return;
    setShown(!shown);
  }));
  canvas?.addEventListener('webglcontextrestored', () => queueMicrotask(guard(reapply)));   // sentinel's own handler rebuilt the renderer first
  addEventListener('resize', guard(refresh), { passive: true });
  const still = () => uniforms?.u_motion?.value === 0;
  const kick = guard(() => {   // once a second: the STILL mark, and the px readouts once the camera knows the shell's size
    const t = still() ? 'TUNE // HAND · STILL' : 'TUNE // HAND'; if (kicker.textContent !== t) kicker.textContent = t;
    const e = env(); if (Math.round(e.R) !== shownR || Math.abs(e.D0 - shownD0) > 0.01) refresh();
  });
  setInterval(kick, 1000);

  // ---- mount ----
  try {
    const { p0, sets } = parse(params?.get?.('tune') ?? new URLSearchParams(location.search).get('tune'));
    if (LEGACY.has(p0) && !sets.some(([k]) => k === 'oz')) { const oh = sets.find(([k]) => k === 'oh'); if (oh) sets.push(['oz', oh[1]]); }   // the haze followed the halo veil before round one
    apply(p0, { url: false });
    for (const [k, v] of sets) { const p = BY_KEY.get(k); vals[k] = clean(p, v); }
    reapply();
    kick();
    if (matchMedia(NARROW).matches) { open = false; body.hidden = true; fold.setAttribute('aria-expanded', 'false'); fold.setAttribute('aria-label', 'Expand'); fold.textContent = '▸'; }
    document.body.append(panel);
    slots.panel.a = animate(panel, { opacity: [0, 1] }, { duration: 0.18, ease: 'easeOut' });
  } catch (err) { if (!warned) { warned = true; console.warn('[tune-lab]', err); } }

  const api = {
    set: guard((key, v) => setValue(key, v)),
    get: (key) => (BY_KEY.has(String(key)) ? vals[key] : undefined),
    values: () => ({ ...vals }),
    apply: guard((name) => apply(name)),
    reseed: guard(() => reseed()),
    link: () => link(),
    state: () => tuneState(),
    json: () => json(),
    flags: () => warnings(vals),
    label: () => presetEl.textContent,
    params: () => PARAMS.map(({ key, name, code, kind, gl, more: m, min, max, step, dec }) => ({ key, name, code, kind, gl: !!gl, more: !!m, min, max, step, dec, today: LIVE[key] })),
    presets: () => Object.fromEntries(Object.entries(PRESETS).map(([n, p]) => [n, { ...p.v }])),
    el: panel,
  };
  window.__tneTune = api;
  return api;
}
