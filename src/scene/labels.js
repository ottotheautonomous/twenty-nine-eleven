import { animate, easeOut } from 'motion';
import { decode, stopDecode, prepareClockedDecode } from './decode.js';
import { projectPx } from './camera.js';
import { TIER0 } from './shape.js';

// DOM readouts, the corner instrument, the tier-0 label and the finding dot. Positions are plain transforms
// written in frame.render; every opacity change and scramble is a Motion animation (decode.js).
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// The short-landscape layout (style.css, the same query): the cage sits in a left column, so the readings take the phone's
// caption mode (one reading, centred above the cage) instead of the desktop columns beside it, which would run into the copy.
const shortLandscape = matchMedia('(orientation: landscape) and (max-height: 600px)');
// A reading too wide for the cage's column (short landscape under ~640 px wide: the longest readings) is set as two lines,
// split at the separator that leaves the longer line shortest (mono: characters are width).
function splitReading(line) {
  const parts = line.split(' \u00b7 '), join = (a, b) => parts.slice(a, b).join(' \u00b7 ');
  let best = [line], longest = Infinity;
  for (let k = 1; k < parts.length; k++) { const l = Math.max(join(0, k).length, join(k).length); if (l < longest) { longest = l; best = [join(0, k), join(k)]; } }
  return best;
}
// A caption's visible box: its widest line (the spans carry the backdrop), whatever the side classes do to the paragraph.
const boxWidth = (el) => Math.max(0, ...Array.from(el.children, (s) => s.getBoundingClientRect().width));

function decodeText(el, text, opts) {
  stopDecode(el, { complete: false });
  el.__decode = null;
  el.textContent = text;
  return decode(el, opts);
}

// A readout (and the tier-0 line) is a pure function of one clock t, seconds along its entrance: the plate fades in
// with easeOut over FADE s, and each line decodes (LINE) after a STAGGER per line. Leaving runs the same clock back to
// 0, so the exit is the entrance played backwards frame for frame, the same code letters included (the seeds are
// kept). Per element: __state 'idle' | 'in' | 'shown' | 'out', __t the clock, __clock its Motion animation.
const FADE = 0.25, STAGGER = 0.08, LINE = { duration: 0.4, alphaDuration: 0.25, fraction: 0.6 };
const RATE_HIDE = 2;   // hideAll (modal, pause, still): the same reverse, twice as brisk
const POOL = 12;      // 3 live + 9 leaving, from load: three full swaps inside one exit before a leaver is ever snapped
const joined = (text) => (Array.isArray(text) ? text.join('\n') : text);

export function createLabels(root, instrument, shape) {
  const make = (cls) => {
    const el = document.createElement('p'); el.className = cls; root?.append(el);
    Object.assign(el, { __state: 'idle', __node: null, __text: null, __lines: null, __T: 0, __t: 0, __clock: null, __gen: 0, __rate: 1, __finding: false,
      __side: null, __dy: 0, __ox: 0, __flip: false, __ax: 0, __ay: 0, __w: undefined, __lift: 0 });
    return el;
  };
  const pool = Array.from({ length: POOL }, () => make('readout'));   // before tier0: the layer's DOM order is the pool, tier0, (the dot)
  const tier0 = make('readout tier0');
  const dot = document.createElement('span'); dot.className = 'readout-dot';
  const q = (sel) => instrument?.querySelector(sel);
  const valueEl = q('.instrument-value'), stateEl = q('.instrument-state'), findingsEl = q('.instrument-findings');
  const bound = new Map();   // node -> its live ('in' | 'shown') element; a leaving element keeps __node to track it
  const stats = { binds: 0, releases: 0, turnarounds: 0, snaps: 0, waits: 0, get bound() { return bound.size; } };
  const tmp = [0, 0, 0];
  let lastIntegrity = 0, findingNode = -1, stateWord = 'STANDBY', rolling = false, drawnLast = 0;
  for (const el of instrument?.querySelectorAll('.instrument-key, .instrument-label') ?? []) el.dataset.text ??= el.textContent;
  tier0.__on = false; tier0.__above = false;   // the tier-0 line sits above the ember while readouts are drawn, below otherwise

  function cssPoint(cam, p, out) {
    projectPx(cam.viewProj, p, cam.width, cam.height, tmp);
    out.x = tmp[0] / cam.scaleX; out.y = (cam.height - tmp[1]) / cam.scaleY;
    return out;
  }
  const pt = { x: 0, y: 0 };
  const nodePoint = (cam, i) => cssPoint(cam, [shape.nodes[i * 3], shape.nodes[i * 3 + 1], shape.nodes[i * 3 + 2]], pt);

  // The whole look at clock t: the plate (element opacity), then every line's glyphs.
  function paintLabel(el, t) {
    const op = String(easeOut(Math.min(Math.max(t / FADE, 0), 1)));
    if (el.__op !== op) { el.__op = op; el.style.opacity = op; }   // the exact value for t (the CSSOM rounds to 6 digits)
    for (const line of el.__lines) line.paint(t);
  }
  // One linear clock from the current t to `to` at `rate` s/s. It is the only thing that settles or releases an element;
  // __gen makes a superseded clock's completion (or the catch-up tick a stop() may run) a no-op.
  function runClock(el, to, rate) {
    const gen = ++el.__gen;
    el.__clock?.stop(); el.__clock = null;
    el.__state = to === 0 ? 'out' : 'in'; el.__rate = rate;
    const from = el.__t;
    const settle = () => {
      if (gen !== el.__gen) return;
      el.__clock = null; el.__t = to; paintLabel(el, to);
      if (to === 0) release(el); else el.__state = 'shown';
    };
    if (from === to || reduced()) { settle(); return; }   // reduced motion: arrive and leave at once, no clock
    el.__clock = animate(from, to, {
      duration: Math.abs(to - from) / rate, ease: 'linear',
      onUpdate: (t) => { if (gen !== el.__gen) return; el.__t = t; paintLabel(el, t); },
      onComplete: settle,
    });
  }
  // idle -> in: fresh glyph spans (fresh seeds), the first frame painted now (no flash of final text), the clock runs to T.
  function start(el, lines) {
    el.replaceChildren(); el.__decode = null;
    if (el === tier0) { el.textContent = lines[0]; el.__lines = [prepareClockedDecode(el, LINE)]; }
    else el.__lines = lines.map((line, i) => { const s = document.createElement('span'); s.textContent = line; el.append(s); return prepareClockedDecode(s, { ...LINE, delay: i * STAGGER }); });
    el.__T = Math.max(...el.__lines.map((d) => d.T));
    el.__t = 0;
    if (el === tier0) el.__above = drawnLast > 0;
    if (!reduced()) paintLabel(el, 0);
    stats.binds++;
    runClock(el, el.__T, 1);
  }
  function bind(el, l, lines = Array.isArray(l.text) ? l.text : [l.text]) {
    el.__node = l.node; el.__text = joined(l.text); el.__finding = Boolean(l.finding);
    el.__w = undefined; el.__lift = 0;
    bound.set(l.node, el);
    el.classList.toggle('is-finding', el.__finding);
    start(el, lines);
  }
  // in | shown -> out: the clock runs back to 0 from wherever it is. An element already leaving is only re-timed.
  function beginExit(el, rate = 1) {
    if (el.__state === 'idle' || (el.__state === 'out' && el.__rate === rate)) return;
    if (el.__node !== null && bound.get(el.__node) === el) bound.delete(el.__node);
    runClock(el, 0, rate);
  }
  // out -> in: the same node and text came back mid-exit; the clock turns around (no restart, no reseed, no rebuild).
  function turnaround(el) {
    if (el.__node !== null) bound.set(el.__node, el);
    stats.turnarounds++;
    runClock(el, el.__T, 1);
  }
  // out -> idle, from the clock's completion (or a snap). The element gives up its node and its place.
  function release(el) {
    if (el.__node !== null && bound.get(el.__node) === el) bound.delete(el.__node);
    el.__node = null; el.__text = null; el.__lines = null; el.__clock = null; el.__t = 0; el.__state = 'idle'; el.__side = null;
    el.__w = undefined; el.__lift = 0;
    el.replaceChildren(); el.__decode = null; el.__op = '0'; el.style.opacity = '0';
    stats.releases++;
  }
  function snap(el) { el.__gen++; el.__clock?.stop(); release(el); stats.snaps++; }   // pressure only: the most-faded leaver
  // An idle element, else the most-faded leaver is snapped (all twelve busy: pressure only).
  function acquire() {
    const idle = pool.find((e) => e.__state === 'idle');
    if (idle) return idle;
    let victim = null;
    for (const e of pool) if (e.__state === 'out' && (!victim || e.__t < victim.__t)) victim = e;
    if (victim) snap(victim);
    return victim;
  }

  // Where a reading's row starts if nothing else is there: the node pushed out of the ember's halo, or on a phone / short
  // landscape screen the caption point above the sphere, clear of the wordmark. The only part of a readout's position that ever moves.
  function anchorOf(cam, node, phone, g, out, el = null) {
    if (phone) {
      const cx = cam.shellPx.x / cam.scaleX, top = (cam.height - cam.shellPx.y) / cam.scaleY - g.R;
      const right = shortLandscape.matches ? cx + g.R + 20 : cam.cssWidth - 8;
      const half = (el?.__w || 0) / 2;
      out.x = half > 0 ? Math.max(Math.ceil(8 + half), Math.min(cx, Math.floor(right - half))) : cx;
      out.y = top - 26 - (el?.__lift || 0);
      return out;
    }
    const p = nodePoint(cam, node); out.x = p.x; out.y = p.y;
    const dx = out.x - g.ex, dy = out.y - g.ey, d = Math.hypot(dx, dy) || 1, min = 0.5 * g.R;
    if (d < min) { out.x = g.ex + dx / d * min; out.y = g.ey + dy / d * min; }
    return out;
  }
  // A readout's row is [ay + dy, ay + dy + pitch): its anchor now plus the offset fixed when it bound. Rows that touch do
  // not overlap. Unrounded CSS px; only the transform is rounded.
  const pitchOf = (e) => (e.__finding ? 32 : 18);
  const rowTop = (e) => e.__ay + e.__dy;
  const overlaps = (y, pitch, e) => rowTop(e) < y + pitch && y < rowTop(e) + pitchOf(e);
  // How deep two rows overlap (px). A leaver's row that overlaps the new reading's by no more than SLACK does not hold
  // it: the plates (15.75 px of the 18 px pitch) stay clear of each other to 2.25 px, and S-F already accepts this much
  // overlap from drift. Without it a sub-pixel overlap (Access control -> Cameras at 904x976) waits a full exit.
  const SLACK = 6;
  const depth = (y, pitch, e) => Math.min(y + pitch, rowTop(e) + pitchOf(e)) - Math.max(y, rowTop(e));
  // The row for a new reading: the free row nearest its anchor among the readouts that stay in its column (its own
  // anchor, or directly below or above one of them; the lower row on a tie). null while a leaving readout still occupies
  // that row by more than SLACK: the reading waits for it, and nobody is ever placed under a leaver or an emptied slot.
  function freeRow(side, ay, pitch) {
    let best = null;
    const consider = (y) => {
      for (const e of pool) if (e.__side === side && (e.__state === 'in' || e.__state === 'shown') && overlaps(y, pitch, e)) return;
      const d = Math.abs(y - ay), db = best === null ? Infinity : Math.abs(best - ay);
      if (d < db - 1e-6 || (Math.abs(d - db) <= 1e-6 && y > best)) best = y;
    };
    consider(ay);
    for (const e of pool) if (e.__side === side && (e.__state === 'in' || e.__state === 'shown')) { consider(rowTop(e) + pitchOf(e)); consider(rowTop(e) - pitch); }
    for (const e of pool) if (e.__side === side && e.__state === 'out' && depth(best, pitch, e) > SLACK) return null;
    return best;
  }

  // labels: model.state.labels; cam: model.cam with scaleX/scaleY (backing px per CSS px).
  // A readout's place is decided once, on the frame it binds, and kept until it is released: every frame, live or
  // leaving, it sits at its anchor plus that constant (the row offset, and the text on the outward side). Nothing is ever
  // re-sorted, pushed, relaxed or flipped; the only motion is the node's own. A new reading takes the free row nearest its
  // node among the readings staying in its column; a row a leaver still holds is given to no one until it is gone.
  // On phones and short landscape screens a single caption sits centred above the sphere.
  const pending = [], at = { x: 0, y: 0 }, g = { R: 0, ex: 0, ey: 0 };
  shortLandscape.addEventListener('change', () => { for (const el of pool) if (el.__state !== 'idle') beginExit(el, RATE_HIDE); });
  function position(labels, cam) {
    if (!cam.ready) return;
    const phone = cam.cssWidth < 600 || shortLandscape.matches;
    if (phone && labels.length > 1) labels = labels.slice(0, 1);
    g.R = cam.shellPx.r / cam.scaleY; g.ex = cam.emberPx[0] / cam.scaleX; g.ey = (cam.height - cam.emberPx[1]) / cam.scaleY;
    // 1. reconcile: a live element whose node and text are still listed stays; every other live element leaves.
    for (const el of pool) el.__used = false;
    for (const l of labels) { const el = bound.get(l.node); if (el && el.__text === joined(l.text)) el.__used = true; else pending.push(l); }
    for (const el of pool) if (!el.__used && (el.__state === 'in' || el.__state === 'shown')) beginExit(el, 1);
    // 2. every readout on screen tracks its anchor (in the mode it bound in: a caption stays a caption).
    for (const el of pool) if (el.__state !== 'idle') { anchorOf(cam, el.__node, el.__side === 'C', g, at, el); el.__ax = at.x; el.__ay = at.y; }
    // 3. each new reading turns its own leaver around, or waits for its node's leaver (the caption's on a phone: a changed
    //    text leaves first, then the new one decodes in), or waits for a leaver in its row, or binds in its free row.
    for (const l of pending) {
      const text = joined(l.text);
      let el = pool.find((e) => e.__state === 'out' && e.__node === l.node && e.__text === text);
      if (el) { turnaround(el); continue; }
      if (pool.some((e) => e.__state === 'out' && (phone || e.__node === l.node))) { stats.waits++; continue; }
      anchorOf(cam, l.node, phone, g, at);
      const side = phone ? 'C' : at.x < g.ex ? 'L' : 'R';
      const row = phone ? at.y : freeRow(side, at.y, l.finding ? 32 : 18);
      if (row === null) { stats.waits++; continue; }
      el = acquire(); if (!el) continue;
      const flip = !phone && (side === 'L' ? at.x > 170 : at.x > cam.cssWidth - 160);
      el.__side = side; el.__dy = row - at.y; el.__ox = phone ? 0 : flip ? -14 : 14; el.__flip = flip;
      el.classList.toggle('is-centred', phone);
      el.classList.toggle('is-left', flip);
      bind(el, l);
      if (phone) {
        const cx = cam.shellPx.x / cam.scaleX, right = shortLandscape.matches ? cx + g.R + 20 : cam.cssWidth - 8, room = right - 8;
        const spans = [...el.children], rawLines = Array.isArray(l.text) ? l.text : [l.text];
        const lines = rawLines.flatMap((line, i) => (spans[i]?.getBoundingClientRect().width > room ? splitReading(line) : [line]));
        if (lines.length > spans.length) {
          const h = el.offsetHeight;
          stats.binds--;   // re-binding as two lines on the same frame
          bind(el, l, lines);
          el.__lift = el.offsetHeight - h;
        }
        el.__w = boxWidth(el);
        anchorOf(cam, l.node, true, g, at, el);
      }
      el.__ax = at.x; el.__ay = at.y;
    }
    pending.length = 0;
    // 4. write: the anchor now plus the fixed offset, live and leaving alike.
    let drawn = 0;
    for (const el of pool) {
      if (el.__state === 'idle') continue;
      drawn++;
      el.style.transform = `translate3d(${Math.round(el.__ax + el.__ox)}px, ${Math.round(el.__ay + el.__dy + (el.__side === 'C' ? 0 : -8))}px, 0)`;
    }
    if (findingNode >= 0 && dot.isConnected) { const p = nodePoint(cam, findingNode); dot.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`; }
    // The tier-0 line follows the ember; its side (above or below) follows the readouts only while it is arriving or
    // shown: once it leaves, the side is held, so it never jumps mid-exit.
    drawnLast = drawn;
    if (tier0.__state === 'in' || tier0.__state === 'shown') tier0.__above = drawnLast > 0;
    if (tier0.__state !== 'idle') tier0.style.transform = `translate3d(${Math.round(g.ex)}px, ${Math.round(tier0.__above ? g.ey - 34 : g.ey + 28)}px, 0)`;
  }

  // force: write every frame (while the ledger is open); otherwise 10 Hz. Writes only when the 3-digit text changes.
  function setIntegrity(v, force = false) {
    if (!valueEl || rolling) return;
    const now = performance.now();
    if (!force && now - lastIntegrity < 100) return;
    lastIntegrity = now;
    const text = v.toFixed(3);
    if (valueEl.textContent !== text) valueEl.textContent = text;
  }
  // The release: the reading counts up in place from the held value to the released one (a numeric odometer, monotone,
  // eased): verify, then report. It never passes through 0.000 or 0.999, and it lands exactly on the model's value.
  let rollAnim = null;
  function rollIntegrity(v) {
    if (!valueEl) return;
    const from = parseFloat(valueEl.textContent) || v;
    rollAnim?.stop(); rolling = true;
    const anim = rollAnim = animate(from, v, { duration: 0.3, ease: [0.22, 1, 0.36, 1], onUpdate: (x) => { valueEl.textContent = x.toFixed(3); } });
    anim.then(() => { if (rollAnim !== anim) return; valueEl.textContent = v.toFixed(3); rolling = false; rollAnim = null; });
  }
  function cancelRoll() { rollAnim?.stop(); rollAnim = null; rolling = false; }   // a stopped Motion animation never resolves: release the guard here
  function setState(word) { stateWord = word; if (stateEl) decodeText(stateEl, word, { duration: 0.4, alphaDuration: 0.2, fraction: 0.6 }); }
  function setFindings(node) {
    findingNode = node;
    instrument?.classList.add('has-finding');
    if (findingsEl) decodeText(findingsEl, 'FINDINGS 01', { duration: 0.4, alphaDuration: 0.2, fraction: 0.6 });
    root?.append(dot);
  }
  // The tier-0 line runs the same clock: a quick re-dwell turns a leaving line around.
  function showTier0(on) {
    if (on === tier0.__on) return;
    tier0.__on = on;
    if (!on) beginExit(tier0, 1);
    else if (tier0.__state === 'out') turnaround(tier0);
    else if (tier0.__state === 'idle') start(tier0, [TIER0]);
  }
  function hideAll() { tier0.__on = false; for (const el of [...pool, tier0]) beginExit(el, RATE_HIDE); }
  function decodeInstrument() {
    if (!instrument) return;
    for (const el of instrument.querySelectorAll('.instrument-key, .instrument-label')) decodeText(el, el.dataset.text, { duration: 0.75, alphaDuration: 0.4, fraction: 0.6 });
    if (stateEl) decodeText(stateEl, stateWord, { duration: 0.75, alphaDuration: 0.4, fraction: 0.6 });
  }
  function countIn(to = 0.998) { return animate(0, to, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setIntegrity(v, true) }); }
  function blinkIntegrity(from = 0.9, to = 0.998) {
    return animate(0, 5, { duration: 0.5, ease: 'linear', onUpdate: (v) => setIntegrity(from + (to - from) * Math.floor(v) / 5, true), onComplete: () => setIntegrity(to, true) });
  }
  return { position, setIntegrity, rollIntegrity, cancelRoll, setState, setFindings, showTier0, hideAll, decodeInstrument, countIn, blinkIntegrity, stats };
}
