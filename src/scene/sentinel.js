import { frame, cancelFrame } from 'motion';
import { createShape } from './shape.js';
import { createModel } from './model.js';
import { createLabels } from './labels.js';
import { createCanvasRenderer } from './canvas2d.js';
import { probeGPU, createWebGLRenderer } from './webgl.js';
import { watchContext } from './gl.js';
import { LATTICE } from './constants.js';
import { createGpuTimer, createFenceLag } from './govsignal.js';

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
  if (override && Object.hasOwn(TIERS, override)) return TIERS[override];   // own keys only: ?tier=constructor must not reach the prototype
  if (!probe.ok || (probe.software && !force)) return TIERS.c2d;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (coarse) return ios || /Apple GPU/.test(probe.gpu) ? TIERS.iphone : TIERS.android;
  if (/UHD Graphics|HD Graphics [456]\d\d|Intel\(R\) HD/i.test(probe.gpu) && !/Iris/i.test(probe.gpu)) return TIERS.uhd;
  return TIERS.xe;
}

export function createSentinel(canvas, anchorEl, uniforms, { debug = 0, readout = false, readouts = null, instrument = null } = {}) {
  // Test parameters (gl, tier, shape, fx, quality) exist only in development and test builds, like ?debug; ?still only lightens the page.
  const query = new URLSearchParams(location.search);
  const params = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1' ? query : new URLSearchParams(query.has('still') ? 'still' : '');
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
  // Governor state (policy: see the comment above pushWindow). rel = governed fraction of the DPR cap (GL).
  let rel = 1, cap = 1, scale = 1, rows = tier.rowsStart || 0;
  let sinceDraw = 0, lastRaf = 0, lastDrawAt = 0, refresh = 1000 / 60, rafCount = 0, drawEma = 1000 / 60;
  let stillPending = false, readoutEl = null, cpuAcc = 0, timer = null, fence = null, timerReadyAt = Infinity, pressure = 'nominal', pressureOn = false;
  const rafIv = [];                                                         // last 60 raw rAF intervals: the refresh estimate
  const quality = { bloomLevels: tier.bloomLevels, hdrScale: tier.hdrScale, jacobi: tier.jacobi, fluidRes: tier.fluidRes };   // tier values; no rung changes them any more
  const xeRows = (tier.rowsStart || 0) > 256;
  // Rungs are data. The governor reads only expect (the share of its signal the rung should save, measured 1440x900@2; 0.10 when a
  // rung omits it), max (optional: what it would save if the frame were nothing but what it cuts), skip() and apply(dir); visual
  // (0 invisible … 3 the identity: thick, dense, crisp strands) and target (the signal it relieves) are documentation, and the
  // LADDER order below is the whole policy. skip() = a no-op from the current state: a rung applies only from its own "from" state
  // (prevK / prevN), so a locked rung is never jumped over, and a scale rung whose floor-clamped value would not change the backing
  // is skipped (at dpr 1 both scale rungs skip: resolution is never touched there).
  // Brain rungs register the same way, e.g. RUNGS.brainHalf = { id: 'brainHalf', visual: 0, target: 'gpu', expect: 0.10,
  // skip: () => !brainData, apply(dir) {...} }, and insert their ids in LADDER below.
  const scaleRung = (id, k, prevK, visual, expect) => ({ id, visual, target: 'gpu', expect, max: 1 - (k / prevK) ** 2, fails: 0,
    skip: () => Math.abs(rel - Math.max(1 / cap, prevK)) > 1e-3 || Math.max(k, 1 / cap) >= rel - 1e-3,   // never below 1 backing px per CSS px, nor k × cap
    apply(dir) { rel = Math.max(1 / cap, dir < 0 ? k : prevK); resize(); } });
  const rowsRung = (id, n, prevN, visual, expect) => ({ id, visual, target: 'gpu', expect, max: 1 - n / prevN, fails: 0, skip: () => rows !== prevN,
    apply(dir) { rows = dir < 0 ? n : prevN; renderer.setRows?.(rows); } });
  const spritesRung = (id, n, prevN, visual, expect) => ({ id, visual, target: 'cpu', expect, max: 1 - n / prevN, fails: 0, skip: () => renderer.sprites !== prevN,
    apply(dir) { renderer.setSprites?.(dir < 0 ? n : prevN); } });
  const RUNGS = {
    scale80: scaleRung('scale80', 0.80, 1.00, 1, 0.10), scale64: scaleRung('scale64', tier.mobile ? 0.60 : 0.64, 0.80, 2, 0.15),
    sprites2000: spritesRung('sprites2000', 2000, 3000, 1, 0.30), sprites1000: spritesRung('sprites1000', 1000, 2000, 2, 0.35),
  };
  const expectOf = (r) => (Number.isFinite(r.expect) ? r.expect : 0.1);   // a rung registered without a measured share counts as 0.10
  // The most a rung can plausibly save: twice its expected share, or all it cuts (max). A trial reading above that is the load
  // changing under the trial (a visitor going idle mid-trial), not the rung.
  const boundOf = (r) => Math.min(0.9, Math.max(2 * expectOf(r), r.max || 0));
  // Particle rows: the tier's own ladder when it has one (tier.rowsLadder, e.g. [768, 512, 256, 128]), else halving from rowsStart
  // down to the floor (xe 128, the others 64): xe 512 -> rows256 -> rows128, uhd/phones 128 -> rows64. Each step is one rung named by
  // the count it lands on. Light is conserved below the 131k reference (webgl.js countGain): fewer rows are sparser, never dimmer.
  const rowsFloor = tier.rowsFloor || (xeRows ? 128 : 64), rowsSteps = tier.rowsLadder ? [...tier.rowsLadder] : [];
  if (!tier.rowsLadder) for (let n = tier.rowsStart || 0; n >= rowsFloor; n /= 2) rowsSteps.push(n);
  const rowsIds = rowsSteps.slice(1).map((n, i) => { const id = `rows${n}`, from = rowsSteps[i]; RUNGS[id] = rowsRung(id, n, from, from > 256 ? 2 : 3, from > 256 ? 0.25 : 0.10); return id; });
  // Ladders: shed in order, restored LIFO. Invisible rungs (the brain's) go first; thickness and crispness go last, mildest first.
  const LADDER = tier.name === 'c2d' ? ['sprites2000', 'sprites1000']
    : xeRows ? ['scale80', ...rowsIds.slice(0, 1), 'scale64', ...rowsIds.slice(1)] : ['scale80', ...rowsIds];
  const gov = { mode: 'off', steps: [], locks: new Map(), pins: new Map(), flips: new Map(), cheapAt: new Map(), hist: [], calm: 0, calmCheap: false, holdUntil: 0, backoffUntil: 0,
    trial: null, probe: null, inferredSheds: 0, last: 'start', verdict: 'hold', win: null, lastWin: null, changes: [], modalSeen: false, modalClearedAt: 0, enteredAt: 0 };

  function budget() {
    const w = Math.max(1, canvas.clientWidth || innerWidth), h = Math.max(1, canvas.clientHeight || innerHeight);
    const mp = (coarse.matches && renderer?.type === 'canvas2d' ? 1.3 : (tier.mpCap || 1.3)) * 1e6;
    return { w, h, max: Math.sqrt(mp / (w * h)) };
  }
  const isGL = () => renderer?.type === 'webgl2';
  const governed = () => renderer && !params.has('quality') && (isGL() ? !probe.software : true);
  const budgetMs = () => Math.max(tier.fps === 30 || !isGL() ? 1000 / 30 : 1000 / 60, refresh);
  const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  function attachSignals() {                                              // per renderer (recreated on context restore)
    timer?.dispose(); fence?.dispose(); timer = fence = null; gov.mode = 'off';
    if (!renderer) return;
    // ?notimer (test builds only, like ?quality) forces the inferred path, e.g. for phone-tier tests on a desktop GPU
    if (isGL() && !probe.software && !params.has('notimer') && (governed() || readout)) timer = createGpuTimer(renderer.gl);
    if (isGL() && !probe.software && !timer && governed()) fence = createFenceLag(renderer.gl);
    timerReadyAt = performance.now() + 8000;                                // start-up medians run 2-8 ms for the first 5-8 s
    if (governed()) gov.mode = timer ? 'measured' : 'inferred';
    if (gov.mode === 'inferred' && isGL() && !pressureOn) {                // optional (Chrome 125+): a busy machine is not our GPU cost
      pressureOn = true;
      try { if ('PressureObserver' in globalThis) new PressureObserver((rs) => { pressure = rs.at(-1)?.state || 'nominal'; }).observe('cpu').catch(() => {}); } catch { /* absent: never "bad" */ }
    }
  }
  const govHold = (ms) => { gov.holdUntil = Math.max(gov.holdUntil, performance.now() + ms); gov.win = null; };   // discards the window in progress
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
    govHold(2000); timerReadyAt = Math.max(timerReadyAt, performance.now() + 1000);   // reallocation: judge no transient
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

  // Governor (policy: .review/gov/fable/GOV-SPEC.md). Full quality is the resting state. It acts only on proof that OUR frame is
  // the bottleneck: measured mode (desktop Chromium) reads our own GPU time per frame from a timer query, so CPU jank from other
  // processes or another page's GPU load can never shed anything; inferred mode (no timer: Safari, Firefox, phones, Canvas2D) needs
  // slow frames, a deep GPU queue and a light main thread, sheds at most two rungs per session, never while idle short of a panic,
  // and every step is a trial that must save a measurable share within ~3 s or it is undone and locked. Thickness, density and
  // crispness go last and never below the floors (1 backing px per CSS px; xe rows 128, others 64; sprites 1000). Restores are LIFO,
  // predicted from the saving measured at the shed, and the dead band between "slow" and "calm" keeps it from oscillating. A saving
  // is one reading, so it is capped at what the rung can give, and a state at half the budget gets one revertible restore per rung
  // per 10 min regardless.
  // Statistics are medians of ~1 s windows; start-up, entrance, modal, resize and visibility changes are holds.
  function pushWindow(now, iv, cpu, gpuSamples, lag) {
    const w = gov.win ||= { t0: now, iv: [], cpu: [], gpu: [], lag: [] };
    w.iv.push(iv); w.cpu.push(cpu); if (lag > 0) w.lag.push(lag);
    for (const s of gpuSamples) if (s.at >= timerReadyAt) w.gpu.push(s.ms);
    if (now - w.t0 < 1000 || w.iv.length < 8) return;
    gov.win = null;
    // gpuMed needs 10 timer samples, or all but 2 of the window's frames when it holds fewer (at 7 fps a window closes at 8 frames)
    const closed = { t: now, n: w.iv.length, ms: now - w.t0, ivMed: median(w.iv), cpuMed: median(w.cpu), gpuMed: w.gpu.length >= Math.min(10, w.iv.length - 2) ? median(w.gpu) : NaN, lagMed: w.lag.length ? median(w.lag) : NaN };
    gov.lastWin = closed;
    judge(closed, now);
  }
  // Display refresh: the median of the last 60 raw rAF intervals, accepted only as a stable mode (half of them within ±1.5 ms) and
  // only at a real display period (< 45 ms). Within ±3 % of the estimate it is jitter and changes nothing (no ratchet). Faster is
  // always accepted (rAF cannot outpace the display); slower only when our own cost is known and under half the current period, so
  // frames our GPU paces never pass for a slower display: never in the timer warm-up, never with a deep GPU queue. Under jank the
  // previous estimate stands.
  function estimateRefresh() {
    if (rafIv.length < 30) return;
    const med = median(rafIv), agree = rafIv.filter((x) => Math.abs(x - med) < 1.5).length / rafIv.length;
    if (agree < 0.5 || med >= 45 || Math.abs(med - refresh) <= 0.03 * refresh) return;
    if (med < refresh) { refresh = med; return; }
    const w = gov.lastWin, own = !w ? NaN : timer ? Math.max(w.gpuMed, w.cpuMed) : fence ? (w.lagMed < 2 ? w.cpuMed : NaN) : w.cpuMed;   // NaN: unknown
    if (own < 0.5 * refresh) refresh = med;
  }
  const signalOf = (w) => (gov.mode === 'measured' ? w.gpuMed : w.ivMed);
  function classify(w, B) {
    const c2d = !isGL();
    if (gov.mode === 'measured') {
      if (!Number.isFinite(w.gpuMed)) return { usable: false };
      const top = gov.steps.at(-1), r = top && RUNGS[top], predicted = w.gpuMed / (1 - Math.min(0.9, r ? (r.learned ?? expectOf(r)) : 0));
      // the learned saving can be stale (the load changed under its trial): a state at half the budget gets one revertible restore
      // per rung per 10 min whatever the prediction (a restore that hurts is re-shed by the probe; one that only sits below "slow"
      // is re-shed later with a fresh trial, and it must not come straight back), and none within 10 min of a restore that hurt
      const lastFlip = top && gov.flips.get(top)?.at(-1), lastCheap = top && gov.cheapAt.get(top), calmP = predicted <= 0.7 * B;
      const cheap = w.gpuMed <= 0.5 * B && w.t - (lastFlip ?? -Infinity) > 600000 && w.t - (lastCheap ?? -Infinity) > 600000;
      return { slow: w.gpuMed >= 0.85 * B, panic: w.gpuMed >= 1.5 * B, calm: calmP || cheap, cheapOnly: cheap && !calmP, fast: predicted <= 0.5 * B, usable: true };
    }
    const bad = pressure === 'serious' || pressure === 'critical';
    const lagOk = c2d || (Number.isFinite(w.lagMed) && w.lagMed >= 2);
    // C2D: our CPU share counts only while frames are actually late (under contention a 14 ms draw reads 21-25 ms on time)
    // GL: a busy main thread is not a GPU cost, unless the GPU queue is 3+ frames deep (a full command buffer blocks our gl calls)
    const slow = c2d ? (w.ivMed >= 1.4 * B || (w.cpuMed >= 0.6 * B && w.ivMed >= 1.15 * B)) : (w.ivMed >= 1.4 * B && (w.cpuMed < 0.5 * B || w.lagMed >= 3) && lagOk && !bad);
    return { slow, panic: w.ivMed >= 2.0 * B && lagOk, calm: w.ivMed <= 1.1 * B && w.cpuMed < (c2d ? 0.45 : 0.5) * B, fast: false, usable: true };
  }
  function nextRung(now) {
    for (const id of LADDER) {
      const r = RUNGS[id]; if (!r || gov.steps.includes(id) || r.skip()) continue;
      const lock = gov.locks.get(id); if (lock && now < lock) continue;
      return id;
    }
    return null;
  }
  function record(now, id, dir, reason, extra = {}) {
    gov.last = `${dir < 0 ? '-' : '+'}${id} @${(now / 1000).toFixed(1)}s ${reason}`;
    gov.changes.push({ t: Math.round(now), id, dir, reason, ...extra }); if (gov.changes.length > 200) gov.changes.shift();
  }
  function shed(now, id, reason, trial = true) {
    // baseline = the windows that voted (slow or panic) among the last two (measured) or four (inferred), so neither a spike nor a
    // window from before the load began can fake a saving or a loss
    const r = RUNGS[id], recent = gov.hist.slice(gov.mode === 'measured' ? -2 : -4).filter((h) => h.slow || h.panic), med2 = (k) => median(recent.map((h) => h[k]).filter(Number.isFinite));
    const before = recent.length ? med2('sig') : signalOf(gov.lastWin), cpuBefore = recent.length ? med2('cpu') : gov.lastWin.cpuMed;
    r.apply(-1); gov.steps.push(id);
    gov.trial = trial ? { id, before, cpuBefore, wins: [], cpu: [], vs: [] } : null; gov.probe = null;
    gov.hist.length = 0; gov.calm = 0; gov.calmCheap = false; govHold(1500);   // the first trial window spans 1-2 s after the step
    record(now, id, -1, reason, { before });
  }
  function revert(now, id, saved, why = 'reverted') {                      // 'inconclusive': an unreadable trial, no lock
    const r = RUNGS[id], fail = why !== 'inconclusive'; r.apply(+1); gov.steps.pop();
    if (fail) { r.fails = (r.fails || 0) + 1; gov.locks.set(id, r.fails >= 2 ? Infinity : now + 120000); }   // a registered rung need not declare fails
    if (gov.mode === 'inferred') { gov.backoffUntil = now + 30000; gov.inferredSheds = Math.max(0, gov.inferredSheds - 1); }
    gov.hist.length = 0; gov.calm = 0; gov.calmCheap = false; govHold(3000);
    const c = gov.changes.at(-1); if (c?.id === id && c.dir < 0) { c.saved = saved; c.kept = false; }
    record(now, id, +1, `${why} saved ${Math.round(saved * 100)}%`, { saved, kept: false });
  }
  function restore(now, id, sig) {
    RUNGS[id].apply(+1); gov.steps.pop();
    if (gov.calmCheap) gov.cheapAt.set(id, now);                            // the half-budget re-measure: once per rung per 10 min
    gov.probe = { id, wins: 0, before: sig }; gov.hist.length = 0; gov.calm = 0; gov.calmCheap = false; govHold(1500);
    record(now, id, +1, 'restore');
  }
  function judge(w, now) {
    const B = budgetMs();
    if (!governed() || !readyFired) { gov.verdict = 'off'; return; }
    if (model.state.modal) { gov.modalSeen = true; gov.verdict = 'modal'; return; }
    if (gov.modalSeen) { gov.modalSeen = false; gov.modalClearedAt = now; }
    if (now < gov.modalClearedAt + 3000 || now < gov.holdUntil) { gov.verdict = 'hold'; return; }
    if (!model.state.entered) { gov.enteredAt = 0; gov.verdict = 'entrance'; return; }
    gov.enteredAt ||= now;
    if (now < Math.max(gov.enteredAt + 2000, 10000)) { gov.verdict = 'entrance'; return; }   // and never in the first 10 s after load
    if (w.ivMed > 250) { gov.verdict = 'throttled'; return; }               // background/occluded rAF: never evidence. A slow device at 6 fps (167 ms) still counts
    const v = classify(w, B); if (!v.usable) { gov.verdict = 'warmup'; return; }
    v.sig = signalOf(w); v.cpu = w.cpuMed;
    const idle = uniforms.u_idle.value > 0.5;
    if (gov.trial) {                                                        // did the step help?
      const t = gov.trial; t.wins.push(v.sig); t.cpu.push(w.cpuMed); t.vs.push(v); gov.verdict = 'trial';
      if (t.wins.length < 2) return;
      const after = median(t.wins), r = RUNGS[t.id], keep = Math.max(0.06, 0.35 * expectOf(r));
      let saved = 1 - after / Math.max(1e-6, t.before);
      if (gov.mode === 'inferred' && !isGL() && t.cpuBefore > 0) saved = Math.max(saved, 1 - median(t.cpu) / t.cpuBefore);   // C2D: cutting draw CPU is a win too
      if (t.wins.length < 4 && Math.abs(saved - keep) < 0.05) return;     // too close to call on two windows: two more (~2 s)
      gov.trial = null;
      // More than the rung can give. Canvas2D: the load moved under the trial (a contention dip), so it is unreadable: undone with no
      // lock, and a second one on the same rung within 120 s counts as a failed trial (locked), so it cannot loop. GL: intervals land
      // on whole display refreshes (30 -> 60 fps reads 50 % whatever the rung saves), so the reading is kept, learned at the bound.
      if (gov.mode === 'inferred' && !isGL() && saved > boundOf(r)) {
        const again = now - (r.unreadAt ?? -Infinity) < 120000; r.unreadAt = now;
        revert(now, t.id, saved, again ? 'inconclusive again' : 'inconclusive');
      } else if (saved >= keep) {
        r.learned = Math.min(saved, boundOf(r)); govHold(3000);
        if (gov.mode === 'inferred') gov.hist = t.vs.slice(-4);              // the kept state's own windows already count as evidence
        const c = gov.changes.at(-1); if (c) { c.after = after; c.saved = saved; c.kept = true; }
        gov.last += ` saved ${Math.round(saved * 100)}% kept`;
      } else revert(now, t.id, saved);
      return;
    }
    if (gov.probe) {                                                        // did the restore hurt?
      const p = gov.probe; p.wins++; gov.verdict = 'probe';
      if (v.slow) {
        const r = RUNGS[p.id], cost = 1 - p.before / Math.max(1e-6, v.sig);    // what the rung really saves, as the restore just showed
        if (cost > (r.learned ?? expectOf(r))) r.learned = Math.min(boundOf(r), cost);   // so the next prediction waits for a real drop
        const flips = (gov.flips.get(p.id) || []).filter((t) => now - t < 120000); flips.push(now);
        shed(now, p.id, `restore hurt (flip ${flips.length})`, false);
        if (flips.length >= 3) { gov.pins.set(p.id, now + 600000); gov.flips.delete(p.id); } else gov.flips.set(p.id, flips);
        govHold(3000); return;
      }
      if (p.wins >= 3) gov.probe = null;
    }
    gov.hist.push(v); if (gov.hist.length > 6) gov.hist.shift();
    const votes = gov.hist.slice(-4).filter((h) => h.slow).length, last2 = gov.hist.slice(-2);
    // idle, and C2D always: slow in 5 of the last 6 windows with 2+ panics (iv >= 2 budget): longer than any burst or a 2.5 s sentry
    // pass; a C2D frame under CPU contention reads like our own cost, so only GL with a deep GPU queue sheds on 3 votes while active
    const sustained = gov.hist.length >= 6 && gov.hist.filter((h) => h.slow).length >= 5 && gov.hist.filter((h) => h.panic).length >= 2;
    const wantShed = gov.mode === 'measured' ? (last2.length === 2 && last2.every((h) => h.slow)) || v.panic
      : now >= gov.backoffUntil && gov.inferredSheds < 2 && (idle || !isGL() ? sustained : votes >= 3);
    if (wantShed) {
      const id = nextRung(now);
      if (id) {
        if (gov.mode === 'inferred') gov.inferredSheds++;
        shed(now, id, v.panic ? 'panic' : gov.mode === 'measured' ? `gpu ${w.gpuMed.toFixed(1)}ms` : `iv ${w.ivMed.toFixed(1)}ms cpu ${w.cpuMed.toFixed(1)}ms lag ${Number.isFinite(w.lagMed) ? w.lagMed : '-'}`);
        gov.verdict = 'shed'; return;
      }
    }
    gov.verdict = v.slow ? 'slow' : v.calm ? (idle ? 'idle-calm' : 'calm') : 'mid';
    const top = gov.steps.at(-1);
    if (!top) return;
    const pin = gov.pins.get(top); if (pin && now < pin) return;
    gov.calm = v.calm ? gov.calm + 1 : v.slow ? 0 : gov.calm;             // mid: neither counts nor resets
    gov.calmCheap = gov.calm > 0 && (gov.calmCheap || Boolean(v.cheapOnly));   // a counted window that only the half-budget rule made calm
    if (gov.probe) return;                                                  // calm keeps counting through a probe: restores ~4.5 s apart
    const need = gov.mode === 'measured' ? (v.fast ? 3 : 5) : 8;
    if (gov.calm >= need) restore(now, top, v.sig);
  }

  // Frame gate: draw on whole display refreshes at or above the tier's rate, from the raw rAF interval and the stable refresh
  // estimate (Motion's delta is clamped and resynthesised after a wake; jank no longer inflates the period).
  function updateTick() {
    if (!active || lost) return;
    const now = performance.now(), iv = lastRaf ? Math.min(now - lastRaf, 100) : 1000 / 60;
    if (lastRaf && iv > 4 && iv < 100) { rafIv.push(iv); if (rafIv.length > 60) rafIv.shift(); if (++rafCount % 30 === 0) estimateRefresh(); }
    lastRaf = now;
    const interval = tier.fps === 30 || renderer?.type === 'canvas2d' ? 1000 / 30 : 1000 / 60;
    const every = Math.max(1, Math.floor(interval / refresh + 0.15));     // whole refreshes per draw: 2 for 30 fps at 60 Hz, 2 for 60 fps at 120 Hz
    sinceDraw += iv;
    drawNow = sinceDraw >= (every - 0.5) * refresh;
    if (!drawNow) return;
    pendingDelta = Math.min(sinceDraw, 100); sinceDraw = 0;
    if (!rendererReady()) return;
    if (!readyFired) { renderer.warmup?.(); fireReady(); }
    sceneTime += (pendingDelta / 1000) * uniforms.u_motion.value;
    view.time += (pendingDelta / 1000) * uniforms.u_motion.value;
    model.state.simulate = simAllowed && sceneTime >= simAt;
    const t0 = performance.now(); model.step(pendingDelta, view); cpuAcc = performance.now() - t0;
  }
  const gpuSamples = [];
  function renderTick() {
    if (!active || lost || !drawNow) return;
    drawNow = false;
    if (!rendererReady()) return;
    const lag = fence ? fence.tick() : -1;
    gpuSamples.length = 0; timer?.poll(gpuSamples);
    const t1 = performance.now();
    timer?.begin(t1);
    renderer.draw(view, pendingDelta);
    timer?.end(); fence?.mark();
    labels.position(model.labels, model.cam);
    const now = performance.now(), ms = lastDrawAt ? now - lastDrawAt : 0; lastDrawAt = now;
    if (ms > 0 && ms < 250) { drawEma = drawEma * 0.9 + ms * 0.1; if (governed() || readout) pushWindow(now, ms, cpuAcc + (now - t1), gpuSamples, lag); }
    else if (ms >= 250) gov.win = null;                                     // a stall or a throttled (occluded) rAF: never part of a window
    if (readoutEl) {
      const w = gov.lastWin, f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
      const stack = gov.steps.length ? gov.steps.join('+') : 'full';
      const locks = [...gov.locks].filter(([, u]) => now < u).map(([id, u]) => `${id} ${u === Infinity ? 'session' : Math.round((u - now) / 1000) + 's'}`)
        .concat([...gov.pins].filter(([, u]) => now < u).map(([id, u]) => `pin ${id} ${Math.round((u - now) / 1000)}s`)).join(', ');
      const signals = `gpu ${f(w?.gpuMed, 2)} iv ${f(w?.ivMed)} cpu ${f(w?.cpuMed)} lag ${f(w?.lagMed, 0)} | B ${budgetMs().toFixed(1)}`;
      readoutEl.textContent = `${renderer.type} ${tier.name} ${Math.round(1000 / drawEma)}fps ${scale.toFixed(2)}x ${canvas.width}x${canvas.height}${rows && isGL() ? ` rows ${rows}` : ''}${renderer.sprites ? ` sprites ${renderer.sprites}` : ''}${gov.steps.length ? ` step ${gov.steps.length}` : ''} | integrity ${model.state.integrity.toFixed(3)} vel ${model.state.vel.toFixed(2)} labels ${model.labels.length}${renderer.glError ? ` | gl ${renderer.glError()}` : ''}\n`
        + (gov.mode === 'off' ? `gov off | ${signals}` : `gov ${gov.mode} ${gov.verdict} | ${signals} | ${stack} | last: ${gov.last}${locks ? ` | locks: ${locks}` : ''}`);
    }
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
    sinceDraw = 0; lastRaf = 0; lastDrawAt = 0; govHold(3000);             // hidden or shown: judge nothing for 3 s
    if (on) { frame.update(updateTick, true); frame.render(renderTick, true); }
    else { cancelFrame(updateTick); cancelFrame(renderTick); drawOnce(); }
  }

  watchContext(canvas, {
    onLost() { lost = true; if (renderer) renderer.dead = true; timer = fence = null; cancelFrame(updateTick); cancelFrame(renderTick); },   // their queries died with the context
    onRestored() {
      if (renderer && !renderer.dead) renderer.destroy?.();          // a dead renderer's objects died with the context
      renderer = createWebGLRenderer(canvas, uniforms, shape, model, { tier, probe, flags, debug }) || null;
      canvas.dataset.renderer = renderer ? renderer.type : 'static';
      if (renderer) { renderer.setRows?.(rows); renderer.setQuality?.(quality); }
      attachSignals();
      lost = false; resize();
      if (active) { active = false; setActive(true); } else drawOnce();
    },
  });
  if (readout) {
    readoutEl = document.createElement('pre');
    readoutEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;margin:0;font:11px monospace;color:#9fb3ae;pointer-events:none;white-space:pre';
    document.body.append(readoutEl);
  }
  attachSignals();                                                          // after gov and RUNGS exist, before the first resize
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
    destroy() { setActive(false); timer?.dispose(); fence?.dispose(); timer = fence = null; renderer?.destroy?.(); },
    // Governor state for tests and the ?debug readout (window.__tne.scene.govState() in test builds).
    govState() {
      const w = gov.lastWin;
      return { mode: gov.mode, verdict: gov.verdict, B: budgetMs(), refresh, rel, cap, scale, rows, sprites: renderer?.sprites, w: canvas.width, h: canvas.height,
        ladder: [...LADDER], steps: [...gov.steps], locks: Object.fromEntries(gov.locks), pins: Object.fromEntries(gov.pins),
        flips: Object.fromEntries([...gov.flips].map(([id, t]) => [id, t.length])), cheapAt: Object.fromEntries(gov.cheapAt), last: gov.last, inferredSheds: gov.inferredSheds,
        trial: gov.trial && { id: gov.trial.id, before: gov.trial.before, wins: [...gov.trial.wins] }, probe: gov.probe && { ...gov.probe },
        window: w && { ivMed: w.ivMed, gpuMed: w.gpuMed, cpuMed: w.cpuMed, lagMed: w.lagMed, n: w.n, fps: ((w.n - 1) * 1000) / w.ms }, changes: gov.changes.map((c) => ({ ...c })) };
    },
  };
}
