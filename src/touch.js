import { animate, motionValue, frame } from 'motion';

// Touch (TOUCH-SPEC.md, 2026-10-13). A finger that lands on empty space or on the cage is a mouse: sliding is hover, lifting is the
// mouse leaving. A finger that lands on a row word, the conversation line, the verse or the tagline holds it: the selection stays
// lit while the finger slides away and its light leans toward the finger; it snaps back and plays its entrance in reverse when
// the finger goes too far or rests on another selectable; after a lift it lingers a moment, then leaves the way it came in.
// Implicit pointer capture is kept (text-motion and press() pair down and up per element); the element under a sliding finger is
// found with elementFromPoint. Light only: nothing here moves or resizes text.
// The constants (TOUCH-SPEC.md section 6; the release radii live with each kind in main.js):
const TAP_MS = 250, TAP_PX = 8;          // main.js's tap test
const SLIDE_PX = 10, CLICK_MS = 600;     // a gesture that travelled more than 10 px never clicks (within 600 ms of its end)
const TAP_LEAVE_MS = 100, LINGER_MS = 600;
const HANDOFF_MS = 120, HANDOFF_INSET = 3, DEADBAND = 2, OUTSET = 4;
const HYSTERESIS = 16, CAGE_MARGIN = 24;  // release at R + 16; the corridor ends at the cage disc (radius + 24)
const HOLD = [320, 28], SNAP = [700, 22], SETTLE = [220, 26];   // springs: stiffness, damping
const VARS = ['', '-x', '-y', '-side', '-ax', '-k', '-room'].map(suffix => `--pull${suffix}`);
const shortLandscape = matchMedia('(orientation: landscape) and (max-height: 600px)');
const clamp01 = value => Math.min(1, Math.max(0, value));   // the springs may overshoot a little: the light never does
const rectOf = el => el.getBoundingClientRect();
const gap = (r, x, y) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
const within = (r, x, y, inset = 0) => x >= r.left + inset && x <= r.right - inset && y >= r.top + inset && y <= r.bottom - inset;
const sideOf = (r, x) => x < r.left + r.width / 2 ? '0% 50%' : '100% 50%';
const spring = ([stiffness, damping]) => ({ type: 'spring', stiffness, damping, restDelta: .0005, restSpeed: .005 });

// kinds: [{ match, steal, radius: [phone, short landscape, tablet], enter(el, how, origin, x, y), leave(el, how), track?(el, x, y),
//          pull?(el, P) }] in hit-test order. how: 'down' | 'hover' | 'handoff' on enter; 'snap' | 'normal' on leave.
// hand: { point(event, engaged, holding, feed), leave(), reassert(el), release() }: the scene side (main.js).
export function createTouchSelect({ scene, cage, kinds, still, hand }) {
  let mode = 'idle';            // 'idle' | 'free' | 'held' | 'multi' (a second finger: everything ignored until every touch is up)
  let g = null;                 // the gesture: { id, x0, y0, t0, travel, slid, start, x, y, t }
  let held = null, hover = null, cand = null, linger = null, last = null;
  const pointers = new Set(), taps = new Map(), channels = new Map();
  let handoffs = 0, releases = 0;   // read by test builds (state)

  const radius = kind => kind.radius[shortLandscape.matches ? 1 : innerWidth < 600 ? 0 : 2] / Math.max(1, visualViewport?.scale || 1);
  function selectableAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !scene.contains(hit)) return { engaged: null };
    for (const kind of kinds) { const el = hit.closest(kind.match); if (el) return { el, kind, engaged: hit.closest('[data-react]') }; }
    return { engaged: hit.closest('[data-react]') };
  }
  function measure(h) {
    h.box = rectOf(h.el); h.R = radius(h.kind);
    const c = rectOf(cage);
    h.cx = c.left + c.width / 2; h.cy = c.top + c.height / 2; h.cageR = c.height / 2 + CAGE_MARGIN;
    if (h.ch) h.ch.box = h.box;
  }

  // Pull: P (0 at the box .. 1 at R), the direction from the box centre to the finger and the strain before a release, each on a
  // spring, written to the held element as CSS variables (style.css draws the light) and to the scene through kind.pull.
  function channel(h) {
    let ch = channels.get(h.el);
    if (!ch) {
      if (still()) return null;   // still: no pull at all (the hold logic runs; the light answers instantly through text-motion)
      ch = { el: h.el, kind: h.kind, box: h.box, gen: 0, uniform: true, P: motionValue(0), dx: motionValue(0), dy: motionValue(0), k: motionValue(0) };
      const write = () => {
        const x = ch.dx.get(), side = x < 0 ? -1 : 1, room = side > 0 ? innerWidth - ch.box.right - 2 : ch.box.left - 2;   // a tail never reaches past the screen
        [clamp01(ch.P.get()), x, ch.dy.get(), side, Math.max(.35, Math.abs(x)), clamp01(ch.k.get()), `${Math.max(0, room)}px`]
          .forEach((value, i) => ch.el.style.setProperty(VARS[i], typeof value === 'number' ? value.toFixed(4) : value));
      };
      ch.off = [ch.P, ch.dx, ch.dy, ch.k].map(value => value.on('change', () => frame.render(write)));
      ch.off.push(ch.P.on('change', p => { if (ch.uniform) ch.kind.pull?.(ch.el, clamp01(p)); }));
      h.el.dataset.held = '';
      channels.set(h.el, ch);
    }
    ch.box = h.box; ch.uniform = true; ch.gen++;
    return ch;
  }
  function steer(ch, targets, options) {
    for (const [key, value] of Object.entries(targets)) {
      if (ch[key].get() !== value || ch[key].isAnimating()) animate(ch[key], value, spring(options));
    }
  }
  function drop(ch) {
    if (channels.get(ch.el) !== ch) return;
    channels.delete(ch.el);
    [ch.P, ch.dx, ch.dy, ch.k].forEach(value => value.stop());
    ch.off.forEach(off => off());
    VARS.forEach(name => ch.el.style.removeProperty(name));
    delete ch.el.dataset.held;
  }
  // The pull settles to 0 (a snap: quick, with a small recoil; otherwise set down), then the element's variables go.
  function settle(ch, options, then = null) {
    const gen = ++ch.gen;
    animate(ch.k, 0, spring(options));
    if (ch.P.get() === 0 && !ch.P.isAnimating()) { if (then) then(); return; }
    animate(ch.P, 0, spring(options)).then(() => { if (ch.gen === gen && then) then(); });
  }
  function pullToward(h, x, y, strained) {
    if (!h.ch) return;
    const d = gap(h.box, x, y), u = Math.min(d, h.R) / h.R;
    const vx = x - (h.box.left + h.box.width / 2), vy = y - (h.box.top + h.box.height / 2), l = Math.hypot(vx, vy);
    steer(h.ch, { P: 1 - (1 - u) * (1 - u), k: strained ? clamp01((d - h.R) / HYSTERESIS) : 0, ...(l > .5 ? { dx: vx / l, dy: vy / l } : {}) }, HOLD);
  }

  function enter(s, how, origin, x, y) { s.kind.enter(s.el, how, origin, x, y); }
  function grab(s, how, origin) {
    held = { el: s.el, kind: s.kind };
    measure(held);
    enter(s, how, origin, g.x, g.y);
    held.ch = channel(held);
    mode = 'held';
  }
  // how: 'snap' (a release or a hand-off: the entrance reversed, quicker) | 'normal' (a mouse leaving)
  function letGo(h, how) {
    if (h.ch) { h.ch.uniform = false; const ch = h.ch; settle(ch, how === 'snap' ? SNAP : SETTLE, () => drop(ch)); }
    h.kind.leave(h.el, how);
  }
  function clearCand() { if (cand) { clearTimeout(cand.timer); cand = null; } }
  function handoff() {
    const next = cand; clearCand();
    letGo(held, 'snap'); held = null;
    grab(next, 'handoff', sideOf(rectOf(next.el), next.x0));   // the new word lights from the side the finger came in
    g.slid = true; handoffs++;
  }
  function release(s) {
    letGo(held, 'snap'); held = null; mode = 'free'; g.slid = true; releases++;
    if (s.el) hoverOn(s);
  }
  function hoverOn(s) { hover = s; enter(s, 'hover', sideOf(rectOf(s.el), g.x), g.x, g.y); }
  function hoverOff() { const h = hover; hover = null; h.kind.leave(h.el, 'normal'); }
  function endLinger() {
    const l = linger; linger = null; clearTimeout(l.timer);
    letGo(l, 'normal'); hand.release();
  }
  function flushTaps() { taps.forEach(({ h, timer }) => { clearTimeout(timer); letGo(h, 'normal'); }); taps.clear(); }
  // The hold region: the box grown by R + 16, the cage disc, and a corridor between them (R wide at the box, the disc's width at
  // the cage), so a finger heading for the cage, or on it, never lets go.
  function towardCage(h, x, y) {
    if (Math.hypot(x - h.cx, y - h.cy) <= h.cageR) return true;
    const bx = h.box.left + h.box.width / 2, by = h.box.top + h.box.height / 2, ax = h.cx - bx, ay = h.cy - by, aa = ax * ax + ay * ay;
    const t = aa > 0 ? ((x - bx) * ax + (y - by) * ay) / aa : -1;
    return t >= 0 && t <= 1 && Math.abs((x - bx) * ay - (y - by) * ax) / Math.sqrt(aa) <= h.R + (h.cageR - h.R) * t;
  }
  function refeed() {   // a hand-off on the timer (a resting finger sends no moves): the scene's engagement follows at once
    if (g?.event) hand.point(g.event, held.el.closest('[data-react]'), { el: held.el, P: 0 }, false);
  }

  function down(event) {
    if (event.isPrimary && mode === 'multi') { pointers.clear(); mode = 'idle'; }   // a primary touch: every earlier touch has ended
    pointers.add(event.pointerId);
    if (!event.isPrimary || mode === 'multi') {   // a second finger (a pinch): the hold leaves as normal and the hand leaves
      clearCand();
      if (held) { letGo(held, 'normal'); held = null; }
      if (hover) hoverOff();
      if (mode === 'held' || mode === 'free') hand.leave();
      mode = 'multi'; g = null; last = null;
      return false;
    }
    last = null;   // a new gesture: the last one's click suppression is spent
    clearCand();
    if (held) { letGo(held, 'normal'); held = null; }   // a gesture whose lift never arrived: it leaves as normal
    if (hover) hoverOff();
    const x = event.clientX, y = event.clientY;
    g = { id: event.pointerId, x0: x, y0: y, t0: event.timeStamp, travel: 0, slid: false, start: null, x, y, t: event.timeStamp };
    const s = selectableAt(x, y);
    g.start = s.el ?? null;
    const resume = s.el && (linger?.el === s.el ? linger : taps.get(s.el)?.h);
    if (resume) {   // the same element, still lit: the hold continues with no exit, no re-entrance and no second ring
      if (linger?.el === s.el) { clearTimeout(linger.timer); linger = null; } else { clearTimeout(taps.get(s.el).timer); taps.delete(s.el); }
      held = resume; measure(held); held.ch = channel(held); mode = 'held';
      hand.reassert(held.el);
      return true;
    }
    if (linger) endLinger();
    if (s.el) grab(s, 'down'); else { mode = 'free'; hover = null; }
    return true;
  }

  function move(event) {
    if (mode === 'multi' || !event.isPrimary) return;
    const x = event.clientX, y = event.clientY, t = event.timeStamp;
    if (mode === 'idle') {   // a finger already down when its gesture was cancelled (a dialog closed under it, pause): a mouse from here
      if (linger) endLinger();
      g = { id: event.pointerId, x0: x, y0: y, t0: t, travel: 0, slid: true, start: null, x, y, t }; mode = 'free'; hover = null;
    }
    if (event.pointerId !== g.id) return;
    g.x = x; g.y = y; g.t = t; g.event = { clientX: x, clientY: y, timeStamp: t, pointerType: 'touch' };
    g.travel = Math.max(g.travel, Math.hypot(x - g.x0, y - g.y0));
    if (g.travel > SLIDE_PX) g.slid = true;
    const s = selectableAt(x, y);
    if (mode === 'held') heldMove(s, x, y, t); else freeMove(s, x, y);
    hand.point(event, mode === 'held' ? held.el.closest('[data-react]') : s.engaged, held && { el: held.el, P: held.ch ? clamp01(held.ch.P.get()) : 0 }, true);
  }
  function heldMove(s, x, y, t) {
    const steal = s.el && s.kind.steal && s.el !== held.el && within(rectOf(s.el), x, y, HANDOFF_INSET);
    if (!steal) clearCand();
    else if (cand?.el !== s.el) {
      clearCand();
      cand = { ...s, since: t, x0: x, timer: setTimeout(() => { if (mode === 'held' && cand?.el === s.el) { handoff(); refeed(); } }, HANDOFF_MS) };
    } else if (t - cand.since >= HANDOFF_MS) { handoff(); pullToward(held, x, y, false); return; }
    const d = gap(held.box, x, y);
    if (d > held.R + HYSTERESIS && !towardCage(held, x, y)) { clearCand(); release(s); return; }
    pullToward(held, x, y, d > held.R && !towardCage(held, x, y));   // taut in R..R + 16 (a release is next), never toward the cage
  }
  function freeMove(s, x, y) {
    if (hover) {
      const r = rectOf(hover.el);
      if (s.el && s.el !== hover.el && within(rectOf(s.el), x, y, DEADBAND)) { hoverOff(); hoverOn(s); }
      else if (s.el !== hover.el && gap(r, x, y) > OUTSET) { hoverOff(); if (s.el) hoverOn(s); }
    } else if (s.el) hoverOn(s);
    if (hover) hover.kind.track?.(hover.el, x, y);
  }

  function up(event) {
    pointers.delete(event.pointerId);
    if (mode === 'multi') { if (!pointers.size) { mode = 'idle'; last = { t: event.timeStamp, slid: true }; } return; }
    if (!g || event.pointerId !== g.id) return;
    clearCand();
    const tap = event.timeStamp - g.t0 < TAP_MS && Math.hypot(event.clientX - g.x0, event.clientY - g.y0) < TAP_PX;   // main.js's test
    const slid = g.slid, h = held, free = hover;
    last = { t: event.timeStamp, slid };
    mode = 'idle'; g = null; held = null;
    hand.leave();   // the hand leaves at once, as a mouse leaving the page (tilt may take the lean)
    if (h) {
      if (tap && !slid) taps.set(h.el, { h, timer: setTimeout(() => { taps.delete(h.el); letGo(h, 'normal'); }, TAP_LEAVE_MS) });   // today's tap
      else {   // lingers, its tether retracting now the finger is gone, then leaves with the normal hover exit
        linger = { ...h, timer: setTimeout(endLinger, LINGER_MS) };
        hand.reassert(h.el);
        if (h.ch) settle(h.ch, SETTLE);
      }
    } else if (free) hoverOff();
  }

  // pointercancel, a dialog opening, still or pause turning on, a hidden tab, a rotation: everything leaves as normal (instantly under
  // still). A tap's own 100 ms exit keeps today's timing through the dialog its click opens.
  function cancel(reason, event = null) {
    if (event) pointers.delete(event.pointerId);
    clearCand();
    if (reason !== 'modal' && reason !== 'cancel') flushTaps();
    if (linger) endLinger();
    if (mode === 'multi') { if (!pointers.size && reason === 'cancel') { mode = 'idle'; last = { t: event?.timeStamp ?? performance.now(), slid: true }; } return; }
    if (mode === 'idle') return;
    if (held) { letGo(held, 'normal'); held = null; }
    if (hover) hoverOff();
    hand.leave();
    last = { t: event?.timeStamp ?? performance.now(), slid: true };
    mode = 'idle'; g = null;
  }

  // A slide never activates a control: a click within 600 ms of a slid gesture's end is swallowed (keyboard clicks have detail 0).
  function suppressClick(event) {
    if (event.detail === 0) return false;
    if (mode === 'multi') return true;
    if (!last?.slid || event.timeStamp - last.t > CLICK_MS) return false;
    last = null; return true;
  }
  document.addEventListener('pointerdown', event => { if (event.pointerType !== 'touch' || !scene.contains(event.target)) last = null; }, { capture: true, passive: true });
  document.addEventListener('click', event => { if (suppressClick(event)) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  const remeasure = () => { if (held) measure(held); };
  addEventListener('resize', remeasure, { passive: true });
  visualViewport?.addEventListener('resize', remeasure, { passive: true });
  visualViewport?.addEventListener('scroll', remeasure, { passive: true });
  shortLandscape.addEventListener('change', () => cancel('rotate'));
  addEventListener('orientationchange', () => cancel('rotate'));
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel('hidden'); });

  const api = {
    down, move, up, cancel,
    holds: el => held?.el === el || linger?.el === el || taps.has(el),
    pressing: el => mode !== 'idle' && mode !== 'multi' && g?.start === el,   // the finger that started on el is still down (press() owns the arrow)
    repull(el) { const ch = channels.get(el); if (ch?.uniform) ch.kind.pull?.(el, clamp01(ch.P.get())); },
  };
  // development and test builds only (like ?debug's window.__tne): compiled out of production
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1') Object.defineProperty(api, 'state', { get: () => ({
    mode, held: held?.el ?? null, hover: hover?.el ?? null, linger: linger?.el ?? null, cand: cand?.el ?? null, taps: [...taps.keys()],
    slid: g?.slid ?? null, travel: g?.travel ?? 0, R: held?.R ?? null, P: held?.ch ? held.ch.P.get() : null, last, handoffs, releases,
    channels: [...channels.values()].map(ch => ({ el: ch.el, P: ch.P.get(), dx: ch.dx.get(), dy: ch.dy.get(), k: ch.k.get(), uniform: ch.uniform })),
  }) });
  return api;
}
