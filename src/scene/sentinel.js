import { frame, cancelFrame } from 'motion';
import { createShape } from './shape.js';
import { createModel } from './model.js';
import { createLabels } from './labels.js';
import { createCanvasRenderer } from './canvas2d.js';
import { probeGPU, createWebGLRenderer } from './webgl.js';
import { watchContext } from './gl.js';
import { LATTICE } from './constants.js';

// Tier table (start values). side = state texture size allocated once; rows = active prefix (no reallocation).
// Backing caps are high so hi-DPI screens get native-resolution particles (low caps upscale into blur); the
// governor lowers the scale, then quality, when frames run long.
export const TIERS = {
  xe: { name: 'xe', mobile: false, state32: true, side: [512, 512], rowsStart: 512, rowsMax: 512, fluidRes: 128, jacobi: 8, bloomLevels: 6, hdrScale: 1, dprCap: 2.0, mpCap: 3.5, fps: 60 },
  uhd: { name: 'uhd', mobile: false, state32: false, side: [512, 256], rowsStart: 128, rowsMax: 256, fluidRes: 96, jacobi: 6, bloomLevels: 5, hdrScale: 1, dprCap: 1.5, mpCap: 1.6, fps: 60 },
  android: { name: 'android', mobile: true, state32: false, side: [256, 256], rowsStart: 128, rowsMax: 256, fluidRes: 64, jacobi: 4, bloomLevels: 4, hdrScale: 0.75, dprCap: 2.0, mpCap: 1.0, fps: 30 },
  iphone: { name: 'iphone', mobile: true, state32: false, side: [512, 256], rowsStart: 128, rowsMax: 256, fluidRes: 128, jacobi: 8, bloomLevels: 5, hdrScale: 1, dprCap: 2.0, mpCap: 1.6, fps: 60 },
  c2d: { name: 'c2d', mobile: false, sprites: 3000, dprCap: 2.0, mpCap: 2.6, fps: 30 },
};

function pickTier(probe, override, force) {
  if (override && TIERS[override]) return TIERS[override];
  if (!probe.ok || (probe.software && !force)) return TIERS.c2d;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (coarse) return ios || /Apple GPU/.test(probe.gpu) ? TIERS.iphone : TIERS.android;
  if (/UHD Graphics|HD Graphics [456]\d\d|Intel\(R\) HD/i.test(probe.gpu) && !/Iris/i.test(probe.gpu)) return TIERS.uhd;
  return TIERS.xe;
}

export function createSentinel(canvas, anchorEl, uniforms, { debug = 0, readout = false, readouts = null, instrument = null } = {}) {
  const params = new URLSearchParams(location.search);
  const force = params.get('gl') === 'force';
  const probe = params.get('tier') === 'c2d' ? { ok: false } : probeGPU();
  let tier = pickTier(probe, params.get('tier'), force);
  const set = params.has('shape') ? Number(params.get('shape')) : LATTICE.set;
  const count = tier.name === 'c2d' ? 4096 : tier.side[0] * tier.side[1];
  const shape = createShape({ count, set });
  const model = createModel(shape, uniforms);
  const labels = createLabels(readouts, instrument, shape);
  const flags = new Set((params.get('fx') || '').split(',').filter(Boolean));
  const view = { anchorX: 0, anchorY: 0, anchorH: 1, width: 1, height: 1, time: 0, debug, readout };
  let renderer = null, glUsed = false;
  function pick() {
    if (tier.name !== 'c2d' && !glUsed) {
      const r = createWebGLRenderer(canvas, uniforms, shape, model, { tier, probe, flags, debug });
      glUsed = true;                                     // a canvas that has handed out a WebGL context can never give a 2D one
      if (r) return r;
    }
    if (glUsed && tier.name !== 'c2d') return null;      // GL failed on this canvas: the page shows the static still
    return createCanvasRenderer(canvas, uniforms, shape, model, { tier: TIERS.c2d });
  }
  renderer = pick();
  if (!renderer && tier.name !== 'c2d') tier = TIERS.c2d;
  canvas.dataset.renderer = renderer ? renderer.type : 'static';
  canvas.dataset.tier = renderer ? tier.name : 'static';
  canvas.dataset.active = 'false';

  const anchor = { x: 0, y: 0, h: 1 };
  const coarse = matchMedia('(pointer: coarse)');
  let active = false, lost = false, drawNow = false, pendingDelta = 0;
  let sceneTime = 0, simAt = 1.9, simAllowed = false, readyFired = false, readyCbs = [];
  // Governor state. rel = governed fraction of the DPR cap (GL); the ladder steps quality after the scale floor.
  let rel = 1, cap = 1, scale = 1, ema = 1000 / 60, frozenUntil = 0, rows = tier.rowsStart || 0;
  let winMs = 0, winN = 0, calm = 0, backoff = 1, probationUntil = 0;
  let period = 1000 / 60, sinceDraw = 0, lastRaf = 0, lastDrawAt = 0, refresh = 1000 / 60, refreshSeen = false, drawEma = 1000 / 60;
  let step = 0, cooldownUntil = 0, mpScale = 1;
  let stillPending = false, readoutEl = null;
  const quality = { bloomLevels: tier.bloomLevels, hdrScale: tier.hdrScale, jacobi: tier.jacobi, fluidRes: tier.fluidRes };   // per renderer: TIERS stay untouched
  // Only xe doubled its rows: there the first rung sheds them (before resolution and before HDR softens); other tiers keep v1's order.
  const xeRows = (tier.rowsStart || 0) > 256;
  const LADDER_GL = xeRows ? ['rows', 'bloom', 'rows', 'rows', 'jacobi', 'fluidRes', 'fluidRes'] : ['bloom', 'rows', 'rows', 'rows', 'jacobi', 'fluidRes', 'fluidRes'];
  const LADDER_C2D = ['sprites', 'sprites', 'mp'];                                         // 3000 -> 2000 -> 1000, then resolution (three rungs, as v1)
  const FLUID_STEPS = [64, 96, 128];

  function budget() {
    const w = Math.max(1, canvas.clientWidth || innerWidth), h = Math.max(1, canvas.clientHeight || innerHeight);
    const mp = (coarse.matches && renderer?.type === 'canvas2d' ? 1.3 : (tier.mpCap || 1.3)) * mpScale * 1e6;
    return { w, h, max: Math.sqrt(mp / (w * h)) };
  }
  const isGL = () => renderer?.type === 'webgl2';
  const governed = () => renderer && !params.has('quality') && (isGL() ? !probe.software : true);
  function project() {
    const sx = canvas.width / Math.max(1, canvas.clientWidth || innerWidth), sy = canvas.height / Math.max(1, canvas.clientHeight || innerHeight);
    view.anchorX = anchor.x * sx; view.anchorY = anchor.y * sy; view.anchorH = Math.max(1, anchor.h * sy);
    view.width = canvas.width; view.height = canvas.height;
    model.cam.scaleX = sx; model.cam.scaleY = sy;
    model.cam.cssWidth = canvas.clientWidth || innerWidth; model.cam.cssHeight = canvas.clientHeight || innerHeight;
  }
  function resize() {
    if (!renderer) return;
    const { w, h, max } = budget();
    cap = Math.min(devicePixelRatio || 1, tier.dprCap || 1, max);
    scale = governed() && isGL() ? cap * rel : cap;
    const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    renderer.resize?.(width, height);
    frozenUntil = performance.now() + 500;
    project();
  }
  function measure() {
    const rect = anchorEl.getBoundingClientRect();
    anchor.x = rect.left + rect.width / 2; anchor.y = rect.top + rect.height / 2; anchor.h = rect.height;
    project();
    if (!active) drawOnce();
  }

  function fireReady() {
    if (readyFired) return;
    readyFired = true;
    const cbs = readyCbs; readyCbs = [];
    cbs.forEach((cb) => cb());
  }
  const rendererReady = () => renderer && (!renderer.ready || renderer.ready());

  // One ladder step (dir -1 = cheaper, +1 = richer), clamped to the tier's own maxima.
  function applyStep(kind, dir) {
    if (kind === 'rows') { rows = dir < 0 ? Math.max(tier.rowsStart / 8, rows / 2) : Math.min(tier.rowsStart, rows * 2); renderer.setRows?.(rows); return; }
    if (kind === 'sprites') { const n = (renderer.sprites || 3000) + (dir < 0 ? -1000 : 1000); renderer.setSprites?.(Math.max(1000, Math.min(tier.sprites || 3000, n))); return; }
    if (kind === 'mp') { mpScale = dir < 0 ? 0.69 : 1; resize(); return; }
    if (kind === 'bloom') {
      quality.bloomLevels = dir < 0 ? Math.max(1, tier.bloomLevels - 1) : tier.bloomLevels;
      quality.hdrScale = dir < 0 ? tier.hdrScale * 0.75 : tier.hdrScale;
    } else if (kind === 'jacobi') quality.jacobi = dir < 0 ? Math.max(2, tier.jacobi - 2) : tier.jacobi;
    else if (kind === 'fluidRes') {
      const i = FLUID_STEPS.indexOf(quality.fluidRes);
      quality.fluidRes = dir < 0 ? FLUID_STEPS[Math.max(0, i - 1)] : Math.min(tier.fluidRes, FLUID_STEPS[Math.min(FLUID_STEPS.length - 1, i + 1)]);
    }
    renderer.setQuality?.(quality);
  }
  // Governor: judge ~1 s windows of draw-to-draw time against the tier's rate (or the panel's, if slower).
  // A slow window steps down (scale first on GL, then the ladder); ten calm windows × backoff earn one step back up,
  // on probation for 30 s (no further promotion meanwhile): a slow window in probation doubles backoff (max 8),
  // a step that holds halves it.
  function governor(ms) {
    if (!governed() || !refreshSeen || performance.now() < frozenUntil) { winMs = winN = 0; return; }
    if (isGL() ? sceneTime < 3 : !(model.state.simulate && sceneTime >= simAt + 1)) { winMs = winN = 0; return; }
    ema = ema * 0.94 + ms * 0.06;
    winMs += ms; if (++winN < (isGL() ? 60 : 30)) return;
    const mean = winMs / winN; winMs = winN = 0;
    const target = Math.max(tier.fps === 30 || !isGL() ? 1000 / 30 : 1000 / 60, refresh);
    const now = performance.now(), ladder = isGL() ? LADDER_GL : LADDER_C2D;
    if (mean > target * (isGL() ? 1.2 : 1.14)) {
      calm = 0; if (now < probationUntil) { backoff = Math.min(8, backoff * 2); probationUntil = 0; }
      // xe sheds its doubled rows before any resolution: native-density pixels are the point of the tier
      if (isGL() && rel > 0.56 && !(xeRows && step === 0)) { rel = Math.max(0.55, rel * 0.8); resize(); }
      else if (now >= cooldownUntil && step < ladder.length) { applyStep(ladder[step], -1); step++; cooldownUntil = now + 2000; frozenUntil = now + 2000; }
    } else if (mean <= target * 1.05) {
      if (probationUntil && now >= probationUntil) { backoff = Math.max(1, backoff / 2); probationUntil = 0; }
      if (probationUntil) return;                                           // one promotion at a time: it must hold its 30 s first
      if (++calm < 10 * backoff || now < cooldownUntil) return;
      calm = 0;
      if (isGL() && step > (xeRows ? 1 : 0)) { step--; applyStep(ladder[step], +1); }   // xe: resolution comes back before the doubled rows
      else if (isGL() && rel < 1) { rel = Math.min(1, rel * 1.15); resize(); }
      else if (step > 0) { step--; applyStep(ladder[step], +1); }
      else return;
      probationUntil = now + 30000; cooldownUntil = now + 2000; frozenUntil = now + 2000;
    } else calm = 0;
  }

  // Frame gate: draw on whole display refreshes at or above the tier's rate, from the raw rAF interval
  // (Motion's delta is clamped and resynthesised after a wake).
  function updateTick() {
    if (!active || lost) return;
    const now = performance.now(), iv = lastRaf ? Math.min(now - lastRaf, 100) : 1000 / 60;
    if (lastRaf && iv > 4 && iv < 60) { refresh = refreshSeen ? Math.min(refresh + 0.002, iv) : iv; refreshSeen = true; }
    lastRaf = now;
    const interval = tier.fps === 30 || renderer?.type === 'canvas2d' ? 1000 / 30 : 1000 / 60;
    period += (iv - period) * 0.05;
    sinceDraw += iv;
    const every = Math.max(1, Math.floor(interval / period + 0.15));
    drawNow = sinceDraw >= (every - 0.5) * period;
    if (!drawNow) return;
    pendingDelta = Math.min(sinceDraw, 100); sinceDraw = 0;
    if (!rendererReady()) return;
    if (!readyFired) { renderer.warmup?.(); fireReady(); }
    sceneTime += (pendingDelta / 1000) * uniforms.u_motion.value;
    view.time += (pendingDelta / 1000) * uniforms.u_motion.value;
    model.state.simulate = simAllowed && sceneTime >= simAt;
    model.step(pendingDelta, view);
  }
  function renderTick() {
    if (!active || lost || !drawNow) return;
    drawNow = false;
    if (!rendererReady()) return;
    renderer.draw(view, pendingDelta);
    labels.position(model.labels, model.cam);
    const now = performance.now(), ms = lastDrawAt ? now - lastDrawAt : 0; lastDrawAt = now;
    if (ms > 0 && ms < 250) { drawEma = drawEma * 0.9 + ms * 0.1; governor(ms); }
    if (readoutEl) readoutEl.textContent = `${renderer.type} ${tier.name} ${Math.round(1000 / drawEma)}fps ${scale.toFixed(2)}x ${canvas.width}x${canvas.height}${rows && isGL() ? ` rows ${rows}` : ''}${renderer.sprites ? ` sprites ${renderer.sprites}` : ''}${step ? ` step ${step}` : ''} | integrity ${model.state.integrity.toFixed(3)} vel ${model.state.vel.toFixed(2)} labels ${model.labels.length}${renderer.glError ? ` | gl ${renderer.glError()}` : ''}`;
  }
  function drawStillFrame() {
    if (!renderer || lost) return;
    if (!rendererReady()) { if (!stillPending) { stillPending = true; frame.render(() => { stillPending = false; drawStillFrame(); }); } return; }
    if (!readyFired) { renderer.warmup?.(); fireReady(); }
    project();
    if (uniforms.u_motion.value === 0 || params.has('still')) model.drawStill(view); else model.step(0, view);
    renderer.draw(view, 0);
    labels.position(model.labels, model.cam);
  }
  function drawOnce() { if (renderer) frame.render(drawStillFrame); }
  function setActive(on) {
    on = Boolean(on && renderer && !params.has('still'));
    if (on === active) return;
    active = on;
    canvas.dataset.active = String(on);
    sinceDraw = 0; lastRaf = 0; lastDrawAt = 0; frozenUntil = performance.now() + 500;
    if (on) { frame.update(updateTick, true); frame.render(renderTick, true); }
    else { cancelFrame(updateTick); cancelFrame(renderTick); drawOnce(); }
  }

  watchContext(canvas, {
    onLost() { lost = true; if (renderer) renderer.dead = true; cancelFrame(updateTick); cancelFrame(renderTick); },
    onRestored() {
      if (renderer && !renderer.dead) renderer.destroy?.();          // a dead renderer's objects died with the context
      renderer = createWebGLRenderer(canvas, uniforms, shape, model, { tier, probe, flags, debug }) || null;
      canvas.dataset.renderer = renderer ? renderer.type : 'static';
      if (renderer) { renderer.setRows?.(rows); renderer.setQuality?.(quality); }
      lost = false; resize();
      if (active) { active = false; setActive(true); } else drawOnce();
    },
  });
  if (readout) {
    readoutEl = document.createElement('pre');
    readoutEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;margin:0;font:11px monospace;color:#9fb3ae;pointer-events:none;white-space:pre';
    document.body.append(readoutEl);
  }
  resize();
  measure();
  if (renderer?.type === 'canvas2d') queueMicrotask(fireReady);

  return {
    get type() { return renderer ? renderer.type : 'static'; },
    get tier() { return tier.name; },
    model, labels, shape,
    measure, resize: () => { resize(); measure(); }, setActive, drawOnce,
    allowSimulation(on) { simAllowed = Boolean(on); if (!on) model.state.simulate = false; },
    enableSimulationAt(sec) { simAt = sec; },
    fluidPointer(u, v, t) { renderer?.fluid?.pointer(u, v, t); },
    whenReady(cb) { if (readyFired) cb(); else readyCbs.push(cb); },
    lose() {
      const ext = renderer?.gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext(); setTimeout(() => ext.restoreContext(), 300); return true;
    },
    destroy() { setActive(false); renderer?.destroy?.(); },
  };
}
