// "Start a conversation" catches the dust (.review/sparkle/lead/SPARKLE-SPEC.md, 2026-10-14). As the pointer comes near, fine grains
// of the Sentinel's dust condense out of the dark around the button: each arrives as a brief glint and settles to soft silver, more of
// them the nearer the pointer, born first on its side. On hover (or keyboard focus) the underline extends as before and sheds a quiet
// dust fall-off downward from the live rule. Leaving plays the same frames backwards. Light only, and never over the copy: one small
// Canvas2D layer UNDER the button (the label and the 1 px rule draw over it), created at the first approach, hidden and frameless
// whenever the pointer is far. No scene file is touched; the governor is read, never changed.

const TB = 0.6;                        // one envelope (s): spark 0.08 s + settle 0.52 s; a retirement is the same envelope played backwards
const SPARK = 0.08 / TB;
const RATE = 90;                       // births and retirements per second, each
const AIR = 0, LINE = 1, END = 2;
const BASE = [0.18, 0.26, 0.0];        // alpha by role: quiet ambient air, soft dust fall-off from the underline, no end-sparks
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const RULE = { type: 'spring', stiffness: 220, damping: 27 };   // the underline's own spring (main.js highlightContact)

// How near the pointer is: d = its distance outside the button, vertical distance weighted (the copy is stacked: the rows above and the
// promise below must not light the field much), smoothstepped over rn px (the verse's nearness law).
export function nearness(dx, dy, rn, wy = 3.6) {
  const t = clamp(1 - Math.hypot(dx, wy * dy) / rn);
  return t * t * (3 - 2 * t);
}

// The one envelope, phase p in [0, 1] (p = age / TB). Birth runs p up; a retirement runs the same p back down from wherever the grain is,
// so retire(t) == birth(TB - t) exactly. alpha and size are multipliers of the settled grain; glint mixes in the white sprite; glide is a
// line grain's progress from its birth offset onto its home. ease: the site's [0.22, 1, 0.36, 1] (Motion's cubicBezier).
export function envelope(p, ease, out = {}) {
  const q = clamp(p);
  if (q < SPARK) {
    const e = 1 - (1 - q / SPARK) ** 3;                       // ease-out cubic
    out.alpha = 2 * e; out.size = 0.6 + 0.6 * e; out.glint = e; out.glide = 0;
  } else {
    const e = ease((q - SPARK) / (1 - SPARK));
    out.alpha = 2 - e; out.size = 1.2 - 0.2 * e; out.glint = 1 - e; out.glide = e;
  }
  return out;
}

// The field's level from the renderer, the tier and the governor's state (read only): full on a healthy desktop, less or none as the
// governor sheds, none on the static still.
export function levelFor({ type, tier, steps = 0, sprites } = {}) {
  if (!type || type === 'static') return 0;
  if (type === 'canvas2d' || tier === 'c2d') return (sprites ?? 3000) >= 3000 ? 0.5 : 0;
  if (tier === 'iphone' || tier === 'android') return steps ? 0 : 0.6;
  return steps === 0 ? 1 : steps <= 2 ? 0.6 : 0;
}

// The GL grain's disc, alpha = 1 - smoothstep(0.75, 1, r^2) (a crisp core, ~12 % rim), at 32 px; drawn scaled, so motion never steps.
// Tone k of 0-5 mixes silver toward dawn by k / 5 * 0.6; k = 6 is the glint white.
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

export function createSparkle({ shell, trigger, label, anchor, rows, verse, sentinel, frame, cancelFrame, animate, motionValue, cubicBezier }) {
  const DEBUG = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
  const coarse = matchMedia('(pointer: coarse)'), ease = cubicBezier(0.22, 1, 0.36, 1), env = {}, rnd = Math.random;
  // The dust fall-off's copy of the underline's scale, animated by highlightContact with the rule's own call and spring (rule() below);
  // hl follows hover on the same spring, so the dust sheds across the live width of the rule.
  const ruleScale = motionValue(0.3), presence = motionValue(0);
  let canvas = null, ctx = null, sprites = null;
  let run = false, awake = false, level = 0, levelAt = -Infinity, cadence30 = false, geo = null, stale = true;
  let nP = 0, n = 0, nv = 0, hoverOn = false, keyboard = false, hlTarget = 0;
  let px = null, py = null, lastX = 0, lastY = 0, time = 0, acc = 0, births = 0, retires = 0, pressAt = -9, pressX = 0;
  let slots = [], lineAt = [];
  const grains = [], ends = [null, null], stats = { ticks: 0, draws: 0, ms: [] };

  function measure() {
    const B = trigger.getBoundingClientRect();
    if (!B.width) return false;
    const [L, R, V, A, S] = [label, rows, verse, anchor, shell].map((e) => e.getBoundingClientRect());
    const dpr = devicePixelRatio || 1, s = Math.min(dpr, 2), cx = B.left + B.width / 2, cy = B.top + B.height / 2;
    const ax = B.width / 2 + 64, ay = clamp(Math.min(40, B.top - R.bottom + B.height / 2 - 10, V.top - B.bottom + B.height / 2 - 10), 14, 40);
    // the canvas: the air ellipse plus a margin, inside the viewport's 16 px gutters, its origin on a device pixel (crisp grains)
    const bw = Math.round(Math.min(2 * ax + 16, innerWidth - 32) * s), bh = Math.round((2 * ay + 12) * s), cw = bw / s, ch = bh / s;
    const snap = (v) => Math.round(v * dpr) / dpr, left = snap(clamp(cx - cw / 2, 16, innerWidth - 16 - cw)), top = snap(cy - ch / 2);
    const d = clamp(((1.68 * A.height) / 270) * (coarse.matches ? 1.15 : 1), 1.4, 1.9), r = d * 0.6 + 0.5;
    geo = { B, cx, cy, ruleY: B.bottom - 2.5, halfW: B.width / 2, ax, ay, s, bw, bh, cw, ch, left, top, ox: left - S.left, oy: top - S.top, d,
      safe: [left + r, top + r, left + cw - r, top + ch - r],
      keep: [[L.left - 5, L.top - 3, L.right + 5, L.bottom + 3], [B.right - 16.8, cy - 12, B.right + 7.2, cy + 12]],   // the label's ink, the arrow
      lx: L.left + L.width / 2, ly: L.top + L.height / 2, sigma: dpr < 1.5 ? 0.9 : 1.1, cap: dpr < 1.5 ? 2.5 : 3 };
    const count = dpr < 1.5 ? 22 : 26;                     // sparse dust slots shedding off the underline (never a solid second line)
    if (count !== slots.length && !lineAt.some(Boolean)) {
      // stratified (even fill, no clumps), born centre-out with a little jitter, retired outside-in
      slots = Array.from({ length: count }, (_, k) => -1 + (2 * (k + rnd())) / count)
        .map((u) => [u, Math.abs(u) + (rnd() * 2 - 1) * 0.08]).sort((a, b) => a[1] - b[1]).map((a) => a[0]);
      lineAt = slots.map(() => null);
    }
    stale = false;
    place();
    return true;
  }
  function place() {
    if (!canvas) return;
    if (canvas.width !== geo.bw || canvas.height !== geo.bh) { canvas.width = geo.bw; canvas.height = geo.bh; }
    ctx.globalCompositeOperation = 'lighter';              // grains add to each other, as the cage's additive points
    ctx.imageSmoothingQuality = 'medium';
    const st = canvas.style;                               // CSSOM only (the build's CSP is style-src 'self')
    st.width = `${geo.cw}px`; st.height = `${geo.ch}px`; st.left = `${geo.ox}px`; st.top = `${geo.oy}px`;
  }
  function wake() {
    if (awake || !run) return;
    const now = performance.now();
    if (now - levelAt > 1000) refreshLevel(now);
    if (level <= 0 || !measure()) return;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'contact-sparkle'; canvas.setAttribute('aria-hidden', 'true');
      shell.insertBefore(canvas, trigger);                 // an earlier positioned sibling: the button, its label and rule paint over it
      const mode = DEBUG ? new URLSearchParams(location.search).get('sparkctx') : null;
      ctx = canvas.getContext('2d', mode === 'desync' ? { desynchronized: true } : mode === 'cpu' ? { willReadFrequently: true } : undefined);
      sprites = [0, 1, 2, 3, 4, 5, 6].map(sprite);
      place();
    }
    awake = true; canvas.hidden = false; acc = births = retires = 0;
    frame.render(tick, true);                              // Motion's own rAF batch, with the scene: no second loop
  }
  function sleep() {
    if (!awake) return;
    awake = false;
    cancelFrame(tick);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, geo.bw, geo.bh);
    canvas.hidden = true;                                  // display none: no layer, no raster, no compositing
  }
  function refreshLevel(now) {
    const gov = sentinel.govState();
    levelAt = now;
    level = levelFor({ type: sentinel.type, tier: sentinel.tier, steps: gov.steps.length, sprites: gov.sprites });
    cadence30 = sentinel.tier === 'android' || sentinel.type === 'canvas2d';
  }
  function setPresence(target, instant) {
    if (instant) { hlTarget = target; presence.jump(target); return; }
    if (target !== hlTarget) { hlTarget = target; animate(presence, target, RULE); }
  }
  const light = () => (keyboard && geo ? [geo.lx, geo.ly] : px == null ? null : [px, py]);   // keyboard: on the label's centre
  const inside = (x, y, k, m = 0) => x > k[0] - m && x < k[2] + m && y > k[1] - m && y < k[3] + m;

  // a home below/around the underline: biased toward the lower half of the button so grains read as dust falling off the rule
  function airHome() {
    const { B, cx, cy, ruleY, ax, ay, safe, keep } = geo, lx = (light() || [cx])[0];
    for (let k = 0; k < 600; k++) {
      const x = cx + (rnd() * 2 - 1) * (ax * 0.85), y = ruleY + (rnd() * 1.15 - 0.15) * Math.max(12, safe[3] - ruleY);
      if (((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 > 1 || !inside(x, y, safe, -2) || keep.some((b) => inside(x, y, b, 3))) continue;
      if (rnd() < Math.exp(-Math.max(B.left - x, 0, x - B.right) / 22 - Math.abs(y - ruleY - 5) / 8 - (x - lx) ** 2 / 14000)) return [x - cx, y - cy];
    }
    return null;
  }
  function grain(role, extra) {
    const g = { role, p: 0, dir: 1, a: 0, lx: 0, ly: 0, at: 0, ...extra };
    g.bead = (0.35 + 1.15 * rnd() ** 3) * (0.65 + 0.35 * rnd());   // softer bead range: no harsh hot spots on the rule
    g.tw = rnd() < 0.2 && [0.8 + 0.6 * rnd(), rnd() * TAU, rnd() * TAU];
    g.ph = [0, 0, 0, 0].map(() => rnd() * TAU);
    grains.push(g);
    return g;
  }

  // births and retirements toward this frame's targets: line dust fall-off and subtle ambient dust; no end sparks.
  function population(na, nl) {
    let air = 0, line = 0;
    for (const g of grains) if (g.dir >= 0) { if (g.role === AIR) air++; else if (g.role === LINE) line++; }
    for (; line < nl && births >= 1; line++, births--) {   // the dust fall-off grows centre-out: active line grains are slots[0 .. line)
      if (lineAt[line]) { lineAt[line].dir = 1; continue; }
      const u = slots[line];
      lineAt[line] = grain(LINE, {
        oi: line, u,
        sign: Math.abs(u) < 0.02 ? (rnd() < 0.5 ? -1 : 1) : Math.sign(u),
        phi: rnd(),
        rate: 0.28 + 0.34 * rnd(),                         // cycles per second of downward drift (a slow 1.6-3.5 s fall)
        drop: 8 + 11 * rnd(),                              // how far below ruleY the grain drifts before dissolving (8-19 px)
        sway: 1.2 + 2.2 * rnd(),                           // gentle horizontal curl as it falls
        bf: TAU * (0.25 + 0.25 * rnd()),
      });
    }
    for (; air < na && births >= 1; air++, births--) {     // a dimming grain brightens back before a new one is born
      const back = grains.reduce((b, g) => (g.role === AIR && g.dir < 0 && (!b || g.at > b.at) ? g : b), null), h = !back && airHome();
      if (back) back.dir = 1;
      else if (h) { const w1 = TAU * 0.3 * (0.8 + 0.4 * rnd()); grain(AIR, { hx: h[0], hy: h[1], w1, amp: (1.5 + 3 * rnd()) / (1.28 * w1) }); }
      else break;
    }
    for (; (line > nl + 1 || (!nl && line)) && retires >= 1; retires--) lineAt[--line].dir = -1;   // outside-in
    for (; (air > na + 1 || (!na && air)) && retires >= 1; air--, retires--) {
      const dist = (g) => (geo.cx + g.hx - lastX) ** 2 + (geo.cy + g.hy - lastY) ** 2;
      const far = grains.reduce((f, g) => (g.role === AIR && g.dir >= 0 && (!f || dist(g) > dist(f)) ? g : f), null);
      far.dir = -1; far.at = time;
    }
  }

  function tick({ delta }) {
    const t0 = performance.now();
    if (cadence30 && (acc += delta) < 1000 / 30 - 4) return;   // 30 fps tiers: every second refresh
    const dt = Math.min(cadence30 ? acc : delta, 50) / 1000;
    acc = 0; time += dt;
    if (t0 - levelAt >= 1000) refreshLevel(t0);
    const on = run && level > 0;
    // nearness: a critically damped spring (omega 9), the same law both ways, so exits mirror entrances
    const e = n - (on ? Math.max(nP, +hoverOn) : 0), k = Math.exp(-9 * dt), c = nv + 9 * e;
    n += (e + c * dt) * k - e; nv = (nv - 9 * c * dt) * k;
    setPresence(on && hoverOn ? 1 : 0);
    const nn = clamp(n), hl = clamp(presence.get());
    births = Math.min(births + RATE * dt, RATE * dt + 1); retires = Math.min(retires + RATE * dt, RATE * dt + 1);
    const nl = on ? Math.round(slots.length * level * hl) : 0;
    population(on ? Math.round(10 * level * nn ** 1.35) : 0, nl);
    for (let i = grains.length; i--;) {
      const g = grains[i];
      g.p = clamp(g.p + (g.dir * dt) / TB);
      if (g.dir > 0 && g.p > 1 - 1e-9) { g.p = 1; g.dir = 0; }
      else if (g.dir < 0 && g.p < 1e-9) { grains.splice(i, 1); if (g.role === LINE) lineAt[g.oi] = null; }
    }
    let air = 0; for (const g of grains) air += g.role === AIR;
    draw(clamp(air / (10 * level || 1)), hl, dt);
    if (DEBUG) { stats.ticks++; stats.ms.push(performance.now() - t0); if (stats.ms.length > 600) stats.ms.shift(); }
    if (!grains.length && n < 0.005 && hl < 0.005 && !(on && (hoverOn || nP > 0.02))) { n = nv = 0; sleep(); }
  }

  function draw(fill, hl, dt) {
    const { cx, cy, ruleY, halfW, s, left, top, d, safe, keep } = geo, scale = ruleScale.get(), lp = light(), since = time - pressAt;
    const leanK = 1 - Math.exp(-6 * dt), near = 0.7 + 0.3 * fill, wave = (f, a, b) => 0.6 * Math.sin(f * time + a) + 0.4 * Math.sin(1.7 * f * time + b);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, geo.bw, geo.bh);
    ctx.setTransform(s, 0, 0, s, -left * s, -top * s);    // draw in viewport CSS px
    const maxDrop = Math.max(6, safe[3] - ruleY - 1.5);
    for (const g of grains) {
      envelope(g.p, ease, env);
      const envAlpha = Math.min(1.15, env.alpha * 0.75);   // softened birth glint so grains feel like dust, not sparks
      const glint = env.glint * 0.25;
      let x, y, a = BASE[g.role] * g.bead * near * envAlpha;
      if (g.role === AIR) {                                // a smooth wander and a small damped lean, tethered below/around the rule
        const tx = lp ? 0.03 * (lp[0] - cx - g.hx) : 0, ty = lp ? 0.03 * (lp[1] - cy - g.hy) : 0, tm = Math.max(1, Math.hypot(tx, ty) / 3);
        g.lx += (tx / tm - g.lx) * leanK; g.ly += (ty / tm - g.ly) * leanK;
        const wx = g.amp * wave(g.w1, g.ph[0], g.ph[1]) + g.lx, wy = g.amp * wave(g.w1 * 0.93, g.ph[2], g.ph[3]) + g.ly + 1.5, m = Math.max(1, Math.hypot(wx, wy) / 5);
        x = cx + g.hx + wx / m; y = cy + g.hy + wy / m;
        const dy = Math.max(0, y - ruleY);
        a *= Math.exp(-dy / 14);                           // exponential dust fall-off away from the underline
      } else if (g.role === LINE) {                        // dust detaching from the live underline and drifting downward as it fades
        g.phi = (g.phi + g.rate * dt) % 1;
        const fall = g.phi * Math.min(g.drop, maxDrop);
        const fade = Math.sin(g.phi * Math.PI) * (1 - 0.65 * g.phi);   // detaches softly at the rule, fades out as it falls below
        x = cx + g.u * 0.94 * halfW * scale + Math.sin(g.bf * time + g.ph[0] + g.phi * 3.2) * g.sway * g.phi;
        y = ruleY + 1.2 + fall;
        a *= fade;
        if (since < 0.38) a *= 1 + 0.6 * Math.exp(-((Math.abs(x - pressX) - 520 * since) ** 2) / 288) * (1 - since / 0.38);
      } else {
        continue;
      }
      if (g.tw) a *= 0.7 + 0.3 * Math.sin(g.tw[0] * time + g.tw[1]) * Math.sin(1.73 * g.tw[0] * time + g.tw[2]);
      if (lp) a *= 1 + 0.3 * Math.exp(-((x - lp[0]) ** 2 + (y - lp[1]) ** 2) / 2592);
      a = Math.min(a, 0.42);
      for (const b of keep) if (inside(x, y, b)) {         // never over the label's ink or the arrow: pushed to the nearest edge
        const m = Math.min(x - b[0], b[2] - x, y - b[1], b[3] - y);
        if (m === y - b[1]) y = b[1]; else if (m === b[3] - y) y = b[3]; else x = m === x - b[0] ? b[0] : b[2];
      }
      x = clamp(x, safe[0], safe[2]); y = clamp(y, safe[1], safe[3]);
      const size = d * (0.75 + 0.25 * (1 - (g.phi || 0))) * Math.min(1.05, env.size);
      const tone = Math.round(4 * Math.exp(-(((y - ruleY) / 5) ** 2)) * (0.4 + 0.6 * hl));   // warm near the rule, cooling to silver as it falls
      g.x = x; g.y = y; g.a = a; g.size = size; g.tone = tone;
      for (let k = 0, w = 1 - glint; k < 2; k++, w = glint) if (a * w > 0.002) {
        ctx.globalAlpha = a * w; ctx.drawImage(sprites[k ? 6 : tone], x - size / 2, y - size / 2, size, size);
        if (DEBUG) stats.draws++;
      }
    }
  }

  const api = {
    // the pointer, from the scene's own pointer listeners: a few arithmetic operations on the cached rect
    pointer(x, y, type = 'mouse') {
      px = lastX = x; py = lastY = y; keyboard = false;
      if (!run || ((stale || !geo) && !measure())) return;
      const { B } = geo;
      nP = nearness(Math.max(B.left - x, 0, x - B.right), Math.max(B.top - y, 0, y - B.bottom), type === 'touch' ? 95 : 120);
      if (nP > 0.02) wake();
    },
    leave() { px = py = null; nP = 0; },
    // the peak: hover, focus-visible, a press or a finger on the trigger (keyboard: the light sits on the label's centre)
    hover(on, viaKeyboard = false) {
      hoverOn = Boolean(on); keyboard = hoverOn && viaKeyboard;
      if (hoverOn) wake();
      if (awake) { setPresence(run && level > 0 && hoverOn ? 1 : 0); if (keyboard) { lastX = geo.lx; lastY = geo.ly; } }   // in step with the rule's spring
    },
    // highlightContact's own call for the strand's copy of the line: the same target and spring as the DOM rule (no spring = at once)
    rule(target, spring) {
      const control = animate(ruleScale, target, spring || { duration: 0 });
      if (!spring) control.complete();
      return control;
    },
    press(x = null) { if (awake) { pressAt = time; pressX = x ?? geo.lx; } },
    policy({ run: next, instant }) {
      run = Boolean(next);
      if (!run) { nP = 0; px = py = null; stale = true; }  // after a panel, a still or a hidden tab: nothing until the pointer comes near again
      if (instant) {                                       // still and hidden tabs clear at once (still is instant by design)
        grains.length = 0; lineAt.fill(null); ends.fill(null); n = nv = 0; setPresence(0, true); sleep();
      } else if (run && hoverOn) wake();
    },
    measure() { if (awake) measure(); else stale = true; },
  };
  if (DEBUG) {
    api.debug = {
      state() {
        const live = { air: 0, line: 0, ends: 0 }, ms = [...stats.ms].sort((a, b) => a - b);
        for (const g of grains) live[['air', 'line', 'ends'][g.role]]++;
        return { n, nP, hl: presence.get(), ruleScale: ruleScale.get(), level, awake, run, hoverOn, keyboard, live, total: grains.length, glints: grains.filter((g) => g.p < SPARK).length,
          ticks: stats.ticks, draws: stats.draws, ms: { p50: ms[ms.length >> 1] ?? 0, p95: ms[Math.floor(ms.length * 0.95)] ?? 0, max: ms.at(-1) ?? 0, mean: ms.reduce((a, v) => a + v, 0) / (ms.length || 1), n: ms.length },
          canvas: Boolean(canvas), hidden: canvas ? canvas.hidden : true, geo: geo && { ...geo, B: undefined } };
      },
      dump: () => grains.map((g) => ({ role: ['air', 'line', 'end'][g.role], x: g.x, y: g.y, alpha: g.a, bead: g.bead, tw: Boolean(g.tw), d: g.size, warm: g.tone, phase: g.p, dir: g.dir, e: g.e, oi: g.oi, u: g.u })),
      resetStats() { stats.ticks = stats.draws = 0; stats.ms.length = 0; },
      // the draw pass alone, n times in a row on the current grains (main-thread cost per frame, beyond the timer's 0.1 ms grain)
      bench(n = 500) {
        if (!awake) return null;
        const t0 = performance.now();
        for (let i = 0; i < n; i++) draw(0.8, clamp(presence.get()), 0);
        return { msPerDraw: (performance.now() - t0) / n, grains: grains.length };
      },
    };
  }
  return api;
}
