// The living layer (LIVING-SPEC.md, .review/living/lead/). PROTOTYPE on branch living-proto-dom: throwaway, behind ?living=<flags>.
// Flags: exits | lamp or wake | swell or breath (+ halo) | drop | blink or clickdrop. "all" = exits,swell,lamp,drop,blink (the A set).
// No flags = the page exactly as a004993 (nothing created, no attribute set, no frame requested).
//
// One page clock phi (the ember's breath, 1.9 rad/s), one material (dust.js), one loop (Motion's frame batch, with the scene).
// Overlay pieces (lamp, wake, drop, click) draw into ONE small Canvas2D window (408 CSS px) that rides the light by transform.
// Line pieces (swell, breath, the lamp touching a line) write custom properties on the hovered .service-light (CSS reads them).
import { frame, cancelFrame, cubicBezier } from 'motion';
import { TAU, clamp, smooth, sprites, bead, flicker, warmTone, grainSize, levelFor, hash, GLINT_MS, SETTLE_MS } from './dust.js';

const PHI = 1.9;                                  // rad/s: the ember's breath, a 3307 ms cycle
const CYCLE = (TAU / PHI) * 1000;
const easeOut = cubicBezier(0.22, 1, 0.36, 1), easeIn = cubicBezier(0.64, 0, 0.78, 0), easeWave = cubicBezier(0.16, 1, 0.3, 1), easeSine = cubicBezier(0.37, 0, 0.63, 1);
const WIN = 408, HALF = WIN / 2;                  // the overlay window (CSS px): the afterglow's 180 px + its 24 px feather, each side
const CELL = 40, JIT = 14, TETHER = 8;            // the dust field: one grain per 40 x 40 cell, jittered +-14, drifting within +-8 of home
const SOFT = { k: 95, c: 23 };                    // the wordmark visitor light's spring (main.js soft): the lamp is that light

export function parseLiving(value) {
  if (value == null) return null;
  const set = new Set(String(value).split(/[,\s]+/).filter(Boolean));
  if (set.has('0')) return null;
  if (set.delete('all') || set.delete('1')) ['exits', 'swell', 'lamp', 'drop', 'blink'].forEach((f) => set.add(f));
  if (set.has('wake')) set.delete('lamp');        // the B options replace their A
  if (set.has('breath')) set.delete('swell');
  if (set.has('clickdrop')) set.delete('blink');
  for (const f of [...set]) if (!['exits', 'lamp', 'wake', 'swell', 'breath', 'halo', 'drop', 'blink', 'clickdrop'].includes(f)) set.delete(f);
  return set.size ? set : null;
}

function tween(v) {
  return {
    from: v, to: v, t0: 0, dur: 0, ease: easeOut,
    value(now) { if (this.dur <= 0 || now >= this.t0 + this.dur) return this.to; return this.from + (this.to - this.from) * this.ease((now - this.t0) / this.dur); },
    set(to, dur, ease, now) { if (to === this.to) return; this.from = this.value(now); this.to = to; this.t0 = now; this.dur = dur; this.ease = ease; },
    jump(v) { this.from = this.to = v; this.dur = 0; },
  };
}

export function createLiving({ flags, scene, anchor, sentinel, gainK = 1 }) {
  const has = (f) => flags.has(f);
  const DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
  const realNow = () => (window.__realNow ? window.__realNow() : performance.now());
  const coarse = matchMedia('(pointer: coarse)');
  const overlayOn = has('lamp') || has('wake') || has('drop') || has('blink') || has('clickdrop');
  const lineOn = has('swell') || has('breath') || has('lamp');
  const stats = { ticks: 0, draws: 0, ms: [], lineMs: [] };

  let run = false, lineRun = false, awake = false, level = 0, levelAt = -1e9, geo = null, boxesAt = -1e9;
  let canvas = null, ctx = null, spr = null, winX = 0, winY = 0, winShown = false;
  let px = null, py = null, ptype = 'mouse', lastInput = -1e9, lastT = 0;
  const touches = new Set(); let multi = false, lastDrop = null;

  // ---- the lamp (option A): a light that reveals the page's fixed, unlit dust ------------------------------------------------
  const lamp = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, on: false, mode: 'mouse', gain: tween(0), outAt: 0, blinkAt: -1e9, focus: null };
  const lit = new Map();                          // cell key -> grain light (only the grains that are lit or fading)
  const cells = new Map();                        // cell key -> its seeded constants (home, bead, flicker, rank), computed once
  function cell(i, j, key) {
    let c = cells.get(key);
    if (!c) {
      if (cells.size > 6000) cells.clear();
      c = { hx: (i + 0.5) * CELL + (hash(i, j, 1) * 2 - 1) * JIT, hy: (j + 0.5) * CELL + (hash(i, j, 2) * 2 - 1) * JIT, ph: hash(i, j, 3) * TAU,
        b: bead(hash(i, j, 4), hash(i, j, 9)), tw: hash(i, j, 5) < 0.2 ? [hash(i, j, 6) * TAU, hash(i, j, 7) * TAU] : null, rank: hash(i, j, 8) };
      cells.set(key, c);
    }
    return c;
  }
  let stamp = 0;
  // ---- the wake (option B): 7 motes (5 on phones) tethered 16-34 px from the pointer on springs -----------------------------
  const motes = [];
  // ---- drops ---------------------------------------------------------------------------------------------------------------
  const drops = [];
  // ---- lines ---------------------------------------------------------------------------------------------------------------
  const lines = new Map();                        // .service / .verse-ref element -> state
  const cite = { el: null, near: 0, x: 0, nextAt: 0, n: 0 };

  function measure() {
    const A = anchor.getBoundingClientRect();
    const R = A.height / 2;
    geo = { cage: { cx: A.left + A.width / 2, cy: A.top + A.height / 2, R, halo: R * 1.13 }, d: grainSize(A.height, coarse.matches), s: Math.min(devicePixelRatio || 1, 2), dpr: devicePixelRatio || 1 };
    boxesAt = -1e9;
  }
  // Glyph boxes (+6 px are dark): rows, separators, wordmark, tagline lines, the trigger's label and arrow, the verse, instrument, readouts.
  let boxes = [];
  function readBoxes(now) {
    boxesAt = now;
    const out = [];
    const add = (el) => { for (const r of el.getClientRects()) if (r.width && r.height) out.push([r.left, r.top, r.right, r.bottom]); };
    document.querySelectorAll('.service, .service-separator, .name-word, .work-type .motion-label, .contact-trigger > span:first-child, .contact-arrow, .verse-text, .instrument > span, .motion-toggle').forEach(add);
    document.querySelectorAll('.readout').forEach((el) => { if (+getComputedStyle(el).opacity > 0.01) el.querySelectorAll(':scope > span').forEach(add); });
    boxes = out;
  }
  const outside = (x, y, b) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
  function mask(x, y, near) {                     // 0 over glyphs (+6 px, 4 px feather), the focus outline (+4 px), the cage disc + 13 % halo (24 px feather)
    let m = 1;
    for (const b of near) { const d = outside(x, y, b); if (d < 10) { m *= smooth(6, 10, d); if (m <= 0) return 0; } }
    if (lamp.focus) { const d = outside(x, y, lamp.focus); if (d < 13) m *= smooth(9, 13, d); }
    const c = geo.cage; m *= smooth(c.halo, c.halo + 24, Math.hypot(x - c.cx, y - c.cy));
    return m;
  }

  function refreshLevel(now) {
    levelAt = now;
    const gov = sentinel.govState?.() || { steps: [] };
    level = levelFor({ type: sentinel.type, tier: sentinel.tier, steps: gov.steps.length, sprites: gov.sprites });
  }

  function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.className = 'living-dust'; canvas.setAttribute('aria-hidden', 'true'); canvas.hidden = true;
    scene.prepend(canvas);
    ctx = canvas.getContext('2d');
    spr = sprites();
    sizeCanvas();
  }
  function sizeCanvas() {
    const b = Math.round(WIN * geo.s);
    if (canvas.width !== b) { canvas.width = canvas.height = b; }
    canvas.style.width = canvas.style.height = `${WIN}px`;   // CSSOM only (the build's CSP is style-src 'self')
  }

  function wake() {
    if (awake) return;
    awake = true; lastT = performance.now();
    frame.render(tick, true);                    // Motion's own rAF batch, with the scene: no second loop
  }
  function sleep() {
    if (!awake) return;
    awake = false; cancelFrame(tick);
    hideWindow();
  }
  function hideWindow() {
    if (!canvas || !winShown) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = true; winShown = false;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  function startLamp(x, y, mode, now, gain = 1) {
    lamp.mode = mode;
    if (!lamp.on || lamp.gain.value(now) < 0.02) { lamp.x = lamp.tx = x; lamp.y = lamp.ty = y; lamp.vx = lamp.vy = 0; lamp.on = true; }
    lamp.tx = x; lamp.ty = y; lamp.outAt = 0;
    lamp.gain.set(gain, 360, easeOut, now);
    for (const m of motes) if (m.fresh) { m.x = x; m.y = y; m.fresh = false; }
  }
  function lampOut(now, dur = 360) { lamp.outAt = 0; lamp.gain.set(0, dur, easeIn, now); }
  function initMotes() {
    motes.length = 0;
    const n = coarse.matches ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const g = hash(i, 7, 1), s = hash(i, 7, 2);
      motes.push({ th: (i / n) * TAU + hash(i, 7, 3) * 0.6, r: 16 + 18 * hash(i, 7, 4), rate: (0.18 + 0.3 * hash(i, 7, 5)) * (i % 2 ? 1 : -1),
        w: 3.2 + 3.3 * hash(i, 7, 6), b: clamp(bead(g, s), 0.6, 1.6), a: hash(i, 7, 8) * TAU, c: hash(i, 7, 9) * TAU, x: 0, y: 0, vx: 0, vy: 0, fresh: true });
    }
  }
  if (has('wake')) initMotes();

  function spawnDrop(x, y, kind, now) {
    if (drops.length >= 3) return;
    if (lastDrop && now - lastDrop.t < 80 && Math.hypot(x - lastDrop.x, y - lastDrop.y) < 12) return;   // taps within 80 ms and 12 px merge
    lastDrop = { t: now, x, y };
    const rot = hash(Math.round(x), Math.round(y), 11) * TAU, L = Math.max(level, 0);
    const ring = (n, delay, dur, r0, r1, k, seed) => {
      const count = Math.max(1, Math.round(n * L));   // the governor level thins the ring (phones: 0.6)
      return { delay, dur, r0, r1, k, grains: Array.from({ length: count }, (_, i) => ({
        th: rot + ((i + 0.5) / count) * TAU + (hash(i, seed, 1) * 2 - 1) * 0.08, dr: (hash(i, seed, 2) * 2 - 1) * 1.5, b: bead(hash(i, seed, 3), hash(i, seed, 4)) })) };
    };
    const seed = Math.round(now) & 0xffff;
    drops.push(kind === 'click'
      ? { x, y, t0: now, rings: [ring(14, 0, 480, 6, 26, 0.6, seed)] }
      : { x, y, t0: now, rings: [ring(22, 0, 640, 8, 44, 1, seed), ring(12, 140, 500, 6, 26, 0.5, seed + 1)] });
    wake();
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  function tick({ timestamp }) {
    const t0 = DEBUG ? realNow() : 0;
    const now = performance.now(), dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000)); lastT = now;
    if (now - levelAt > 1000) refreshLevel(now);
    let busy = false;
    if (overlayOn && geo) busy = overlay(now, dt) || busy;
    const tl = DEBUG ? realNow() : 0;
    if (lineOn) busy = linesTick(now) || busy;
    if (DEBUG) { stats.ticks++; stats.ms.push(realNow() - t0); stats.lineMs.push(realNow() - tl); if (stats.ms.length > 1200) { stats.ms.shift(); stats.lineMs.shift(); } }
    if (!busy) sleep();
  }

  function overlay(now, dt) {
    // idle: 4 s quiet -> gain 0.6 over 2 s and the radius breathes; 20 s untouched -> fade out over 2 s and sleep (mouse / keyboard)
    const quiet = now - lastInput;
    if (lamp.on && lamp.mode !== 'touch' && run) {
      if (quiet > 20000) lamp.gain.set(0, 2000, easeSine, now);
      else if (quiet > 4000 && lamp.gain.to > 0.6) lamp.gain.set(0.6, 2000, easeSine, now);
    }
    if (lamp.outAt && now >= lamp.outAt) lampOut(now);
    let gain = lamp.gain.value(now);
    if (lamp.on && gain <= 0 && lamp.gain.to === 0) lamp.on = false;
    // the lamp's spring toward the visit point (substeps: stable at any frame time)
    for (let left = dt; left > 1e-6;) {
      const h = Math.min(0.004, left); left -= h;
      lamp.vx += (SOFT.k * (lamp.tx - lamp.x) - SOFT.c * lamp.vx) * h; lamp.vy += (SOFT.k * (lamp.ty - lamp.y) - SOFT.c * lamp.vy) * h;
      lamp.x += lamp.vx * h; lamp.y += lamp.vy * h;
    }
    const alive = drops.length || (lamp.on && gain > 0) || lit.size;
    if (!alive || !run && !drops.length && !lit.size && gain <= 0) { hideWindow(); return Boolean(alive); }
    if (now - boxesAt > 400) readBoxes(now);

    // the window rides the lamp (or the pointer for the wake, or the newest drop)
    const cx = has('lamp') && (lamp.on || lit.size) ? lamp.x : has('wake') && lamp.on ? (px ?? lamp.x) : drops.length ? drops.at(-1).x : lamp.x;
    const cy = has('lamp') && (lamp.on || lit.size) ? lamp.y : has('wake') && lamp.on ? (py ?? lamp.y) : drops.length ? drops.at(-1).y : lamp.y;
    ensureCanvas();
    const snap = (v) => Math.round(v * geo.dpr) / geo.dpr;
    winX = snap(cx - HALF); winY = snap(cy - HALF);
    canvas.style.transform = `translate3d(${winX}px, ${winY}px, 0)`;
    if (!winShown) { canvas.hidden = false; winShown = true; }
    const s = geo.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.setTransform(s, 0, 0, s, -winX * s, -winY * s);
    const near = boxes.filter((b) => b[2] > winX - 12 && b[0] < winX + WIN + 12 && b[3] > winY - 12 && b[1] < winY + WIN + 12);
    const tsec = now / 1000, phi = PHI * tsec, d0 = geo.d;
    const draw = (x, y, a, size, tone, glint = 0) => {
      if (x < winX || x > winX + WIN || y < winY || y > winY + WIN) return;
      for (let k = 0, w = 1 - glint; k < 2; k++, w = glint) if (a * w > 0.003) {
        ctx.globalAlpha = Math.min(1, a * w); ctx.drawImage(spr[k ? 6 : tone], x - size / 2, y - size / 2, size, size);
        if (DEBUG) stats.draws++;
      }
    };

    // blink (desktop click, option A): R x 0.88 and gain x 1.2 over 90 ms, back over 260 ms
    const bt = now - lamp.blinkAt, blink = bt < 0 ? 0 : bt < 90 ? easeOut(bt / 90) : bt < 350 ? 1 - easeSine((bt - 90) / 260) : 0;
    gain *= 1 + 0.2 * blink;
    const speed = Math.hypot(lamp.vx, lamp.vy);
    const touch = lamp.mode === 'touch';
    const idleMix = lamp.mode === 'touch' ? 0 : smooth(4000, 6000, quiet);
    const R = (touch ? 120 : 100) * (1 - 0.35 * Math.min(speed / 1200, 1)) * (1 + 0.06 * idleMix * Math.sin(phi)) * (1 - 0.12 * blink);

    if (has('lamp')) {
      const i0 = Math.floor((lamp.x - HALF) / CELL) - 1, i1 = Math.floor((lamp.x + HALF) / CELL) + 1;
      const j0 = Math.floor((lamp.y - HALF) / CELL) - 1, j1 = Math.floor((lamp.y + HALF) / CELL) + 1;
      stamp++;
      const k1 = 0.021, k2 = 0.017, k3 = 0.012, w1 = 0.31 * tsec, w2 = 0.23 * tsec, w3 = 0.17 * tsec;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = i * 8192 + j, c = cell(i, j, key), hx = c.hx, hy = c.hy, e = lit.get(key);
        if (!e && (!lamp.on || Math.abs(hx - lamp.x) > R + TETHER + 2 || Math.abs(hy - lamp.y) > R + TETHER + 2)) continue;   // dark and out of reach
        // drift: a slow divergence-free (curl) field shared by neighbours, plus a little of the grain's own wander; tethered +-8 px
        // psi = sin(k1 x + w1) cos(k2 y - w2) + 0.5 sin(k3 (x + y) + w3); offset = 250 (d psi/dy, -d psi/dx): about +-7 px, 1.5-3 px/s
        const S1 = Math.sin(hx * k1 + w1), C1 = Math.cos(hx * k1 + w1), S2 = Math.sin(hy * k2 - w2), C2 = Math.cos(hy * k2 - w2), C3 = Math.cos((hx + hy) * k3 + w3);
        let ox = 250 * (-k2 * S1 * S2 + 0.5 * k3 * C3), oy = -250 * (k1 * C1 * C2 + 0.5 * k3 * C3);
        const ph = c.ph;
        ox += 2.2 * Math.sin(0.4 * tsec + ph); oy += 2.2 * Math.cos(0.33 * tsec + ph * 1.3);
        const om = Math.hypot(ox, oy); if (om > TETHER) { ox *= TETHER / om; oy *= TETHER / om; }
        const x = hx + ox, y = hy + oy;
        const d = Math.hypot(x - lamp.x, y - lamp.y);
        let target = 0;
        if (lamp.on && c.rank < level) {
          target = smooth(1, 0.3, d / R) * gain;
          if (touch) target *= smooth(16, 32, d);                 // a ring around the fingertip: the dust under the finger stays dark
        }
        let l = e ? e.l : 0;
        if (target > 0 || l > 0) {
          l += (target - l) * (1 - Math.exp(-dt / (target > l ? 0.08 : 0.52)));   // rise tau 80 ms, fall tau 520 ms (the afterglow)
          if (l < 0.002 && target <= 0) { lit.delete(key); continue; }
          if (e) { e.l = l; e.s = stamp; } else lit.set(key, { l, s: stamp });
          const win = smooth(HALF, HALF - 24, d);                   // the afterglow is windowed to 180 px with a 24 px feather
          if (win <= 0) continue;
          const tw = c.tw ? flicker(tsec, c.tw[0], c.tw[1]) : 1;
          let a = Math.min(0.32, 0.26 * c.b * l * tw) * win * gainK;   // gainK: the review's 'louder' knob (1 = real)
          if (a < 0.003) continue;
          a *= mask(x, y, near);
          draw(x, y, a, d0, warmTone(x, y, geo.cage));
        }
      }
      for (const [key, e] of lit) if (e.s !== stamp) lit.delete(key);
    }

    if (has('wake') && motes.length) {
      const tx = px ?? lamp.tx, ty = py ?? lamp.ty;
      for (const m of motes) {
        m.th += m.rate * dt;
        const gx = (lamp.mode === 'keyboard' ? lamp.tx : tx) + m.r * Math.cos(m.th), gy = (lamp.mode === 'keyboard' ? lamp.ty : ty) + m.r * Math.sin(m.th);
        for (let left = dt; left > 1e-6;) {
          const h = Math.min(0.004, left); left -= h;
          m.vx += (m.w * m.w * (gx - m.x) - 2 * 0.85 * m.w * m.vx) * h; m.vy += (m.w * m.w * (gy - m.y) - 2 * 0.85 * m.w * m.vy) * h;
          m.x += m.vx * h; m.y += m.vy * h;
        }
        const ex = m.x - tx, ey = m.y - ty, em = Math.hypot(ex, ey);
        if (em > 60) { m.x = tx + (ex * 60) / em; m.y = ty + (ey * 60) / em; }   // the wake stretches to at most 60 px
        let a = Math.min(0.32, 0.26 * m.b * flicker(tsec, m.a, m.c)) * gain * gainK;
        if (touch) a *= smooth(16, 32, Math.hypot(m.x - tx, m.y - ty));
        a *= mask(m.x, m.y, near);
        draw(m.x, m.y, a, d0, warmTone(m.x, m.y, geo.cage));
      }
    }

    // drops: two rings of dust (a water drop) on the tap wave's curve; light: an 80 ms glint to 0.40 x bead, then (1 - t)^2
    for (let n = drops.length; n--;) {
      const dr = drops[n]; let live = false;
      for (const rg of dr.rings) {
        const age = now - dr.t0 - rg.delay, t = age / rg.dur;
        if (t > 1) continue;
        live = true;
        if (age < 0) continue;
        const r = rg.r0 + (rg.r1 - rg.r0) * easeWave(clamp(t));
        const tg = GLINT_MS / rg.dur;
        const fall = t < tg ? 1 - (1 - t / tg) ** 3 : ((1 - t) / (1 - tg)) ** 2;
        const glint = age < GLINT_MS ? fall : 1 - easeOut(clamp((age - GLINT_MS) / SETTLE_MS));
        const size = d0 * (age < GLINT_MS ? 0.6 + 0.6 * fall : 1.2 - 0.2 * (1 - glint));
        for (const g of rg.grains) {
          const x = dr.x + (r + g.dr) * Math.cos(g.th), y = dr.y + (r + g.dr) * Math.sin(g.th);
          let a = Math.min(0.40 * g.b * rg.k * fall, 0.40 + 0.08 * glint) * gainK * mask(x, y, near);
          draw(x, y, a, size, warmTone(x, y, geo.cage), glint);
        }
      }
      if (!live) drops.splice(n, 1);
    }
    return Boolean(drops.length || lamp.on || lit.size);
  }

  // ---- lines: the swell (A), the breath (B), and the lamp touching a drawn underline -------------------------------------------
  function lineState(el) {
    let st = lines.get(el);
    if (!st) {
      const line = el.querySelector(':scope > .service-light');
      if (!line) return null;
      const i = lines.size + 1;
      st = { el, line, cite: el.matches('.verse-ref'), active: false, drawnAt: 0, nextAt: 0, exitAt: 0, sw: null, n: 0, a: hash(i, 3, 1) * TAU, b: hash(i, 3, 2) * TAU,
        bw: hash(i, 3, 3) * TAU, liftPending: false, written: {} };
      lines.set(el, st);
    }
    return st;
  }
  function write(st, name, value) { if (st.written[name] !== value) { st.written[name] = value; st.line.style.setProperty(name, value); } }
  function clearLine(st) {
    for (const name of Object.keys(st.written)) st.line.style.removeProperty(name);
    st.written = {}; st.sw = null;
  }
  function launch(st, now, x0, k = 1) {
    const r = st.el.getBoundingClientRect(), W = r.width;
    const xl = clamp((x0 ?? r.left + W / 2) - r.left, 0, W);
    const b = flicker(now / 1000, st.a, st.b);
    st.sw = { x0: xl, t0: now, W, alpha: (0.22 + 0.10 * b) * k * gainK }; st.liftPending = false;
    st.n++;
    st.nextAt = now + CYCLE * (0.75 + 0.5 * hash(st.n, 5, Math.round(st.a * 100)));   // 2500-4100 ms, never equal twice
  }
  function linesTick(now) {
    let busy = false;
    for (const st of lines.values()) {
      if (!lineRun) { if (Object.keys(st.written).length) clearLine(st); continue; }
      const shown = st.active || now < st.exitAt;
      if (!shown && !st.sw) { if (Object.keys(st.written).length) clearLine(st); continue; }
      busy = true;
      if (has('swell')) {
        if (st.cite) {
          if (st.pendingCentre) { if (now >= st.nextAt) { st.pendingCentre = false; launch(st, now, null, 1); cite.nextAt = st.nextAt; } }
          else if (cite.near > 0 && !st.sw && now >= cite.nextAt) { launch(st, now, cite.x, 0.6); cite.nextAt = st.nextAt; }
        } else if (st.active && !st.sw && st.liftPending && now >= st.drawnAt + 120) launch(st, now, px);   // the lift: one swell from the lift point
        else if (st.active && !st.sw && now >= st.nextAt) launch(st, now, px);
        if (st.sw) {
          const { x0, t0, W, alpha } = st.sw, age = now - t0, w = (160 * age) / 1000;
          const pl = w / Math.max(1, x0 + 10), pr = w / Math.max(1, W - x0 + 10), rise = smooth(0, 120, age);
          write(st, '--swell-x', `${x0.toFixed(2)}px`); write(st, '--swell-w', `${w.toFixed(2)}px`);
          write(st, '--swell-al', (alpha * rise * (1 - smooth(0.7, 1, pl))).toFixed(4));
          write(st, '--swell-ar', (alpha * rise * (1 - smooth(0.7, 1, pr))).toFixed(4));
          if (pl >= 1 && pr >= 1) { st.sw = null; write(st, '--swell-al', '0'); write(st, '--swell-ar', '0'); }
        }
      }
      if (has('breath') && !st.cite) {
        const amp = st.active ? smooth(st.drawnAt, st.drawnAt + 400, now) : 1, phi = (PHI * now) / 1000;
        write(st, '--breath', (1 + 0.12 * amp * Math.sin(phi) * (0.65 + 0.35 * Math.sin(1.73 * phi + st.bw))).toFixed(4));
      }
      if (has('lamp') && !st.cite) {                  // the lamp touching the line: +0.15 (sigma 20 px) at the lamp's x
        const r = st.el.getBoundingClientRect(), ly = r.bottom - 3.5, g = lamp.on ? lamp.gain.value(now) * gainK : 0;   // (the lamp's own gain)
        const dx = Math.max(r.left - lamp.x, 0, lamp.x - r.right), d = Math.hypot(dx, lamp.y - ly);
        write(st, '--lamp-x', `${clamp(lamp.x - r.left, 0, r.width).toFixed(2)}px`);
        write(st, '--lamp-a', (0.15 * g * smooth(1, 0.3, d / (lamp.mode === 'touch' ? 120 : 100))).toFixed(4));
      }
    }
    return busy;
  }

  // ---------------------------------------------------------------------------------------------------------------------------
  const api = {
    flags,
    measure() { measure(); if (canvas) sizeCanvas(); },
    policy({ run: nextRun, lines: nextLines, instant }) {
      const now = performance.now();
      const wasRun = run; run = Boolean(nextRun) && overlayOn; lineRun = Boolean(nextLines) && lineOn;
      if (!run && wasRun) {
        if (instant) { lamp.on = false; lamp.gain.jump(0); lit.clear(); drops.length = 0; hideWindow(); }
        else lampOut(now);
      }
      if (instant && !lineRun) for (const st of lines.values()) clearLine(st);
      if (run || lineRun || lit.size || lamp.on) wake();
    },
    pointer(x, y, type = 'mouse') {
      const now = performance.now();
      px = x; py = y; ptype = type; lastInput = now;
      if (!run || !(has('lamp') || has('wake'))) { if (lineRun && lines.size) wake(); return; }
      if (type === 'touch' && !touches.size) return;
      startLamp(x, y, type === 'touch' ? 'touch' : 'mouse', now);
      wake();
    },
    down(x, y, type, target, id) {
      const now = performance.now();
      px = x; py = y; ptype = type; lastInput = now;
      if (type === 'touch') { touches.add(id); if (touches.size > 1) multi = true; }
      if (!run) return;
      if (type === 'touch') { if (has('lamp') || has('wake')) { startLamp(x, y, 'touch', now); wake(); } return; }
      const control = target?.closest?.('button, a, input, textarea, select, label');
      const c = geo?.cage, onCage = c && Math.hypot(x - c.cx, y - c.cy) < c.halo;
      if (has('blink') && lamp.on && !control && !onCage) { lamp.blinkAt = now; wake(); }
      if (has('clickdrop') && !control && !onCage && !target?.closest?.('.service, .work-type, h1, .verse, .instrument')) spawnDrop(x, y, 'click', now);
    },
    up(x, y, type, { tap = false, target = null, id } = {}) {
      const now = performance.now();
      px = x; py = y;
      if (type !== 'touch') return;
      touches.delete(id);
      const row = target?.closest?.('.service');
      if (run && has('drop') && tap && !multi && !row && !target?.closest?.('button, a, input, textarea, select, label')) spawnDrop(x, y, 'tap', now);
      if (row) { const st = lines.get(row); if (st && has('swell')) st.liftPending = true; }
      if (run && lamp.on) { if (row) lamp.outAt = now + 600; else lampOut(now); }
      if (!touches.size) multi = false;
    },
    cancel(id) { touches.delete(id); if (!touches.size) multi = false; if (lamp.on) lampOut(performance.now()); },
    leave(type) { if (type === 'touch') return; if (lamp.on && lamp.mode !== 'keyboard') lampOut(performance.now()); px = py = null; },
    activity() { lastInput = performance.now(); },
    focus(rect, visible) {
      const now = performance.now(); lastInput = now;
      if (!visible) return;
      lamp.focus = [rect.left - 9, rect.top - 9, rect.right + 9, rect.bottom + 9];
      if (!run || !(has('lamp') || has('wake'))) return;
      startLamp(rect.left + rect.width / 2, rect.top + rect.height / 2, 'keyboard', now, 0.6);
      wake();
    },
    blur() { lamp.focus = null; if (lamp.mode === 'keyboard' && lamp.on) lampOut(performance.now()); },
    // text-motion's onActive: the row word (or the citation) is hovered / focused / touched
    lineActive(el, active) {
      if (!lineOn) return;
      const st = lineState(el); if (!st) return;
      const now = performance.now();
      if (st.cite) return;                            // the citation has its own rules (citation* below)
      if (active) {
        st.active = true; st.exitAt = 0; st.liftPending = false;
        st.drawnAt = now + 240;                       // text-motion's draw: scaleX 0 -> 1 in 240 ms
        if (!st.sw) st.nextAt = st.drawnAt + 120;     // the first swell 120 ms after the draw completes (~360 ms after the hover)
      } else { st.active = false; st.exitAt = now + 180; st.liftPending = false; }   // the line's exit: 180 ms; a band in flight fades with it
      if (lineRun) wake();
    },
    // the verse panel's citation: one swell from the centre when its draw-out finishes; then 0.6x swells only while the pointer is near
    citationDrawn(el) {
      if (!has('swell')) return;
      const st = lineState(el); if (!st) return;
      const now = performance.now();
      st.active = true; st.sw = null; st.nextAt = now + 1450; st.pendingCentre = true; cite.nextAt = 0;   // the soft draw: 1.0 s + 0.45 s spread
      if (lineRun) wake();
    },
    citationNear(el, near, x) { cite.near = near; cite.x = x; },
    citationOff(el) { const st = lines.get(el); if (st) { st.active = false; st.exitAt = 0; st.pendingCentre = false; clearLine(st); } cite.near = 0; },
  };
  if (DEBUG) {
    api.debug = {
      state: () => ({ run, lineRun, awake, level, lamp: { x: lamp.x, y: lamp.y, on: lamp.on, mode: lamp.mode, gain: lamp.gain.value(performance.now()) }, lit: lit.size, drops: drops.length,
        motes: motes.map((m) => [m.x, m.y]), lines: [...lines.values()].map((s) => ({ t: s.el.textContent.trim().slice(0, 20), active: s.active, sw: s.sw, written: { ...s.written } })),
        canvas: Boolean(canvas), hidden: canvas ? canvas.hidden : true, win: [winX, winY], ticks: stats.ticks, draws: stats.draws }),
      stats: () => { const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; }; return { ticks: stats.ticks, draws: stats.draws, p50: q(stats.ms, 0.5), p95: q(stats.ms, 0.95), max: q(stats.ms, 1), lineP95: q(stats.lineMs, 0.95), n: stats.ms.length }; },
      reset: () => { stats.ticks = stats.draws = 0; stats.ms.length = 0; stats.lineMs.length = 0; },
    };
  }
  measure();
  return api;
}
