import { frame, cancelFrame } from 'motion';
import { createShape } from './shape.js';
import { createModel } from './model.js';
import { createLabels } from './labels.js';
import { createCanvasRenderer } from './canvas2d.js';
import { probeGPU, createWebGLRenderer } from './webgl.js';
import { watchContext } from './gl.js';
import { LATTICE } from './constants.js';

// Tier table (start values). side = state texture size allocated once; rows = active prefix (no reallocation).
export const TIERS = {
  xe: { name: 'xe', mobile: false, state32: true, side: [512, 512], rowsStart: 256, rowsMax: 256, fluidRes: 128, jacobi: 8, bloomLevels: 6, hdrScale: 1, dprCap: 1.25, mpCap: 2.0, fps: 60 },
  uhd: { name: 'uhd', mobile: false, state32: false, side: [512, 256], rowsStart: 128, rowsMax: 256, fluidRes: 96, jacobi: 6, bloomLevels: 5, hdrScale: 1, dprCap: 1.0, mpCap: 1.0, fps: 60 },
  android: { name: 'android', mobile: true, state32: false, side: [256, 256], rowsStart: 128, rowsMax: 256, fluidRes: 64, jacobi: 4, bloomLevels: 4, hdrScale: 0.75, dprCap: 1.5, mpCap: 0.75, fps: 30 },
  iphone: { name: 'iphone', mobile: true, state32: false, side: [512, 256], rowsStart: 128, rowsMax: 256, fluidRes: 128, jacobi: 8, bloomLevels: 5, hdrScale: 1, dprCap: 1.75, mpCap: 1.1, fps: 60 },
  c2d: { name: 'c2d', mobile: false, sprites: 2000, dprCap: 1.0, mpCap: 1.3, fps: 30 },
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
  let active = false, lost = false, accum = 0, drawNow = false, pendingDelta = 0;
  let sceneTime = 0, simAt = 1.9, simAllowed = false, readyFired = false, readyCbs = [];
  let scale = 1, cap = 1, ema = 16.7, slow = 0, fast = 0, frozenUntil = 0, rows = tier.rowsStart || 0;
  let stillPending = false, readoutEl = null, glError = 0;

  function budget() {
    const w = Math.max(1, canvas.clientWidth || innerWidth), h = Math.max(1, canvas.clientHeight || innerHeight);
    const mp = (coarse.matches && tier.name === 'c2d' ? 0.9 : tier.mpCap) * 1e6;
    return { w, h, max: Math.sqrt(mp / (w * h)) };
  }
  const governed = () => renderer && renderer.type === 'webgl2' && !probe.software && !params.has('quality');
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
    scale = governed() ? Math.min(scale || cap, cap) : cap;
    if (!governed()) scale = cap;
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

  function governor(delta) {
    if (!governed() || sceneTime < 3 || performance.now() < frozenUntil) return;
    ema = ema * 0.94 + delta * 0.06;
    const budgetMs = tier.fps === 30 ? [38, 24] : [20, 11];
    // A steady 33 ms with low variance is a 30 Hz display, not a slow GPU.
    if (tier.fps === 60 && Math.abs(delta - 33.3) < 2 && Math.abs(ema - 33.3) < 2) { slow = 0; return; }
    slow = ema > budgetMs[0] ? slow + 1 : 0;
    fast = ema < budgetMs[1] ? fast + 1 : 0;
    if (slow > 60) {
      slow = 0;
      if (scale > cap * 0.56) { scale = Math.max(cap * 0.55, scale * 0.8); resize(); }
      else if (rows > tier.rowsStart / 4) { rows = Math.max(tier.rowsStart / 4, rows / 2); renderer.setRows?.(rows); frozenUntil = performance.now() + 2000; }
    } else if (fast > 180) {
      fast = 0;
      if (rows < tier.rowsStart) { rows = Math.min(tier.rowsStart, rows * 2); renderer.setRows?.(rows); frozenUntil = performance.now() + 2000; }
      else if (scale < cap) { scale = Math.min(cap, scale * 1.15); resize(); }
    }
  }

  function updateTick({ delta }) {
    if (!active || lost) return;
    const interval = tier.fps === 30 || renderer?.type === 'canvas2d' ? 1000 / 30 : 1000 / 60;
    accum += Math.min(delta, 50);
    drawNow = accum >= interval - 2;
    if (!drawNow) return;
    pendingDelta = Math.min(accum, 100); accum = 0;
    if (!rendererReady()) return;
    if (!readyFired) { renderer.warmup?.(); fireReady(); }
    sceneTime += (pendingDelta / 1000) * uniforms.u_motion.value;
    view.time += (pendingDelta / 1000) * uniforms.u_motion.value;
    model.state.simulate = simAllowed && sceneTime >= simAt;
    model.step(pendingDelta, view);
  }
  function renderTick({ delta }) {
    if (!active || lost || !drawNow) return;
    drawNow = false;
    if (!rendererReady()) return;
    renderer.draw(view, pendingDelta);
    labels.position(model.labels, model.cam);
    governor(delta);
    if (readoutEl) readoutEl.textContent = `${renderer.type} ${tier.name} ${Math.round(1000 / ema)}fps ${scale.toFixed(2)}x ${canvas.width}x${canvas.height}${rows ? ` rows ${rows}` : ''}${renderer.sprites ? ` sprites ${renderer.sprites}` : ''} | integrity ${model.state.integrity.toFixed(3)} vel ${model.state.vel.toFixed(2)} labels ${model.labels.length}${renderer.glError ? ` | gl ${renderer.glError()}` : ''}`;
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
    accum = 0;
    if (on) { frame.update(updateTick, true); frame.render(renderTick, true); }
    else { cancelFrame(updateTick); cancelFrame(renderTick); drawOnce(); }
  }

  watchContext(canvas, {
    onLost() { lost = true; cancelFrame(updateTick); cancelFrame(renderTick); },
    onRestored() {
      renderer?.destroy?.();
      renderer = createWebGLRenderer(canvas, uniforms, shape, model, { tier, probe, flags, debug }) || null;
      canvas.dataset.renderer = renderer ? renderer.type : 'static';
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
