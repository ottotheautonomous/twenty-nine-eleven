import { animate } from 'motion';
import { decode, stopDecode } from './decode.js';
import { projectPx } from './camera.js';
import { TIER0 } from './shape.js';

// DOM readouts, the corner instrument, the tier-0 label and the finding dot. Positions are plain transforms
// written in frame.render; every opacity change and scramble is a Motion animation (decode.js).
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function decodeText(el, text, opts) {
  stopDecode(el, { complete: false });
  el.__decode = null;
  el.textContent = text;
  return decode(el, opts);
}

export function createLabels(root, instrument, shape) {
  const make = (cls) => { const el = document.createElement('p'); el.className = cls; root?.append(el); return el; };
  const pool = Array.from({ length: 5 }, () => make('readout'));
  const tier0 = make('readout tier0');
  const dot = document.createElement('span'); dot.className = 'readout-dot';
  const q = (sel) => instrument?.querySelector(sel);
  const valueEl = q('.instrument-value'), stateEl = q('.instrument-state'), findingsEl = q('.instrument-findings');
  const bound = new Map();
  const tmp = [0, 0, 0];
  let lastIntegrity = 0, findingNode = -1, stateWord = 'STANDBY';
  for (const el of instrument?.querySelectorAll('.instrument-key, .instrument-label') ?? []) el.dataset.text ??= el.textContent;
  tier0.__on = false;

  function cssPoint(cam, p, out) {
    projectPx(cam.viewProj, p, cam.width, cam.height, tmp);
    out.x = tmp[0] / cam.scaleX; out.y = (cam.height - tmp[1]) / cam.scaleY;
    return out;
  }
  const pt = { x: 0, y: 0 };
  const nodePoint = (cam, i) => cssPoint(cam, [shape.nodes[i * 3], shape.nodes[i * 3 + 1], shape.nodes[i * 3 + 2]], pt);

  function bind(el, l) {
    el.__node = l.node; el.__text = Array.isArray(l.text) ? l.text.join('\n') : l.text; el.__used = true;
    bound.set(l.node, el);
    el.__fade?.stop();
    el.classList.toggle('is-finding', Boolean(l.finding));
    el.replaceChildren();
    const lines = Array.isArray(l.text) ? l.text : [l.text];
    const spans = lines.map((line) => { const s = document.createElement('span'); el.append(s); return [s, line]; });
    el.__fade = animate(el, { opacity: [0, 1] }, { duration: reduced() ? 0 : 0.25 });
    spans.forEach(([s, line], i) => decodeText(s, line, { duration: 0.4, alphaDuration: 0.25, fraction: 0.6, delay: i * 0.08 }));
  }
  function unbind(el) {
    if (el.__node === undefined || el.__node === null) return;
    bound.delete(el.__node);
    el.__node = null; el.__text = null; el.__sortY = undefined;
    el.__fade?.stop();
    el.__fade = animate(el, { opacity: 0 }, { duration: reduced() ? 0 : 0.06 });
  }

  // labels: model.state.labels; cam: model.cam with scaleX/scaleY (backing px per CSS px).
  // Layout: anchors are pushed out of the ember's halo, then stacked in one column per side of the ember
  // (18 px pitch, 32 for the two-line finding). On phones a single reading sits centred under the cage.
  const items = [];
  function position(labels, cam) {
    if (!cam.ready) return;
    const phone = cam.cssWidth < 600;
    if (phone && labels.length > 1) labels = labels.slice(0, 1);
    const R = cam.shellPx.r / cam.scaleY, ex = cam.emberPx[0] / cam.scaleX, ey = (cam.height - cam.emberPx[1]) / cam.scaleY;
    for (const el of pool) el.__used = false;
    items.length = 0;
    for (const l of labels) {
      let el = bound.get(l.node);
      const text = Array.isArray(l.text) ? l.text.join('\n') : l.text;
      if (el && el.__text !== text) { unbind(el); el = null; }
      if (!el) { el = pool.find((e) => e.__node === null || e.__node === undefined); if (!el) continue; bind(el, l); }
      el.__used = true;
      const p = nodePoint(cam, l.node);
      items.push({ el, x: p.x, y: p.y, pitch: l.finding ? 32 : 18 });
    }
    if (phone) {
      for (const it of items) { it.x = cam.shellPx.x / cam.scaleX; it.y = (cam.height - cam.shellPx.y) / cam.scaleY + R + 10; }
    } else {
      for (const it of items) {
        const dx = it.x - ex, dy = it.y - ey, d = Math.hypot(dx, dy) || 1, min = 0.5 * R;
        if (d < min) { it.x = ex + dx / d * min; it.y = ey + dy / d * min; }
      }
      // Stable order: a label keeps its slot unless its anchor moves more than 6 px (the cage drifts every frame).
      for (const it of items) { if (it.el.__sortY === undefined || Math.abs(it.y - it.el.__sortY) > 6) it.el.__sortY = it.y; }
      for (const side of [items.filter((i) => i.x < ex), items.filter((i) => i.x >= ex)]) {
        side.sort((a, b) => a.el.__sortY - b.el.__sortY);
        for (let i = 1; i < side.length; i++) side[i].y = Math.max(side[i].y, side[i - 1].y + side[i - 1].pitch);
      }
    }
    for (const it of items) {
      const flip = !phone && (it.x < ex ? it.x > 170 : it.x > cam.cssWidth - 160);
      it.el.classList.toggle('is-centred', phone);
      it.el.classList.toggle('is-left', flip);
      const ox = phone ? 0 : flip ? -14 : 14;
      it.el.style.transform = `translate3d(${Math.round(it.x + ox)}px, ${Math.round(it.y + (phone ? 0 : -8))}px, 0)`;
    }
    for (const el of pool) if (!el.__used) unbind(el);
    if (findingNode >= 0 && dot.isConnected) { const p = nodePoint(cam, findingNode); dot.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`; }
    if (tier0.__on) tier0.style.transform = `translate3d(${Math.round(ex)}px, ${Math.round(items.length ? ey - 34 : ey + 28)}px, 0)`;
  }

  function setIntegrity(v, force = false) {
    if (!valueEl) return;
    const now = performance.now();
    if (!force && now - lastIntegrity < 100) return;
    lastIntegrity = now;
    const text = v.toFixed(3);
    if (valueEl.textContent !== text) valueEl.textContent = text;
  }
  function setState(word) { stateWord = word; if (stateEl) decodeText(stateEl, word, { duration: 0.4, alphaDuration: 0.2, fraction: 0.6 }); }
  function setFindings(node) {
    findingNode = node;
    instrument?.classList.add('has-finding');
    if (findingsEl) decodeText(findingsEl, 'FINDINGS 01', { duration: 0.4, alphaDuration: 0.2, fraction: 0.6 });
    root?.append(dot);
  }
  function showTier0(on) {
    if (on === tier0.__on) return;
    tier0.__on = on;
    tier0.__fade?.stop();
    if (on) { tier0.__fade = animate(tier0, { opacity: [0, 1] }, { duration: 0.25 }); decodeText(tier0, TIER0, { duration: 0.4, alphaDuration: 0.25, fraction: 0.6 }); }
    else tier0.__fade = animate(tier0, { opacity: 0 }, { duration: 0.06 });
  }
  function hideAll() { pool.forEach(unbind); showTier0(false); }
  function decodeInstrument() {
    if (!instrument) return;
    for (const el of instrument.querySelectorAll('.instrument-key, .instrument-label')) decodeText(el, el.dataset.text, { duration: 0.75, alphaDuration: 0.4, fraction: 0.6 });
    if (stateEl) decodeText(stateEl, stateWord, { duration: 0.75, alphaDuration: 0.4, fraction: 0.6 });
  }
  function countIn(to = 0.998) { return animate(0, to, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setIntegrity(v, true) }); }
  function blinkIntegrity(from = 0.9, to = 0.998) {
    return animate(0, 5, { duration: 0.5, ease: 'linear', onUpdate: (v) => setIntegrity(from + (to - from) * Math.floor(v) / 5, true), onComplete: () => setIntegrity(to, true) });
  }
  return { position, setIntegrity, setState, setFindings, showTier0, hideAll, decodeInstrument, countIn, blinkIntegrity };
}
