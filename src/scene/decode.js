// SPDX-License-Identifier: 0BSD
// DOM text decode / scramble reveal driven by motion.dev v14 (animate +
// frame.render). Kit original, Twenty Nine Eleven (2026), written from the
// igloo.inc MSDF reveal documented in research-igloo-techniques.md T8:
//   per glyph i of n, w = i / n
//   alpha = clamp((pA * 1.1 - w) / 0.1, 0, 1)            pA: 0->1 linear, 0.4 s
//   local = clamp(pS * 2 - w, 0, 1)                        pS: 0->1 sine.out, 0.75 s
//   glyph = local >= 1 ? final : GLYPHS[(seed_i + floor((1 - local) * 5.75)) % len]
// Under prefers-reduced-motion the final glyphs are shown immediately, fully
// opaque, with no frame loop. Screen readers always get the real text (the
// animated glyph spans are aria-hidden; an sr-only copy carries the content).
//
// Motion v14 note: motion.dev's own ScrambleText is a paid Motion+ component;
// this is a small free equivalent on the public API (animate, frame, cancelFrame).
import { animate, frame, cancelFrame } from 'motion';

export const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_:.';
const SINE_OUT = [0.61, 1, 0.88, 1];   // easeOutSine as cubic-bezier (easings.net)

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Splits el's text into aria-hidden per-glyph spans once; idempotent.
// lockWidth: fix each span's width to its final glyph so proportional fonts do
// not reflow while scrambling (unneeded for IBM Plex Mono).
export function prepareDecode(el, { lockWidth = false } = {}) {
  if (el.__decode) return el.__decode;
  const text = el.textContent;
  el.textContent = '';
  const sr = document.createElement('span');
  sr.textContent = text;
  sr.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
  const ink = document.createElement('span');
  ink.setAttribute('aria-hidden', 'true');
  const chars = [];
  // Words are nowrap inline-blocks so lines only break at real spaces
  // (adjacent atomic inlines are otherwise break opportunities mid-word).
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { ink.appendChild(document.createTextNode(part)); continue; }
    const word = document.createElement('span');
    word.style.cssText = 'display:inline-block;white-space:nowrap;';
    for (const ch of Array.from(part)) {
      const s = document.createElement('span');
      s.textContent = ch;
      s.style.display = 'inline-block';
      word.appendChild(s);
      chars.push({ el: s, final: ch, shown: ch, seed: (Math.random() * 997) | 0, space: false, roll: Math.random() });
    }
    ink.appendChild(word);
  }
  el.append(sr, ink);
  if (lockWidth) for (const c of chars) c.el.style.width = `${c.el.getBoundingClientRect().width}px`;
  return (el.__decode = { el, chars, controls: [], render: null, gen: 0 });
}

export function decode(el, {
  duration = 0.75, alphaDuration = 0.4, delay = 0, ease = SINE_OUT,
  steps = 5.75, glyphs = GLYPHS, lockWidth = false, reduced = reducedMotion(), fraction = 1,
} = {}) {
  const st = prepareDecode(el, { lockWidth });
  stopDecode(el);
  const gen = ++st.gen;                  // stale completions from an earlier call are ignored
  const n = st.chars.length;
  const p = { a: 0, s: 0 };
  let dirty = true;

  const paint = () => {
    if (!dirty) return;
    dirty = false;
    for (let i = 0; i < n; i++) {
      const c = st.chars[i];
      const w = n > 1 ? i / n : 0;
      const alpha = Math.min(Math.max((p.a * 1.1 - w) / 0.1, 0), 1);
      const local = Math.min(Math.max(p.s * 2 - w, 0), 1);
      const g = c.space || local >= 1 || c.roll >= fraction ? c.final : glyphs[(c.seed + Math.floor((1 - local) * steps)) % glyphs.length];
      if (g !== c.shown) { c.el.textContent = g; c.shown = g; }
      const op = String(alpha);
      if (c.el.style.opacity !== op) c.el.style.opacity = op;
    }
  };

  if (reduced) {                         // composed still: final text, no motion
    p.a = p.s = 1; paint();
    return Promise.resolve();
  }
  paint();                               // first frame: all transparent, no flash of final text
  st.render = paint;
  frame.render(paint, true);             // keepAlive: runs every frame until cancelled
  const mark = () => { dirty = true; };
  st.controls = [
    animate(0, 1, { duration: alphaDuration, delay, ease: 'linear', onUpdate: (v) => { p.a = v; mark(); } }),
    animate(0, 1, { duration, delay, ease, onUpdate: (v) => { p.s = v; mark(); } }),
  ];
  return Promise.all(st.controls).then(() => {
    if (gen !== st.gen) return;
    p.a = p.s = 1; dirty = true; paint();
    if (st.render === paint) { cancelFrame(paint); st.render = null; }
  });
}

export function stopDecode(el, { complete = true } = {}) {
  const st = el.__decode;
  if (!st) return;
  st.controls.forEach((c) => (complete ? c.complete() : c.stop()));
  st.controls = [];
  if (st.render) { cancelFrame(st.render); st.render = null; }
}

// Lines: stagger 0.15-0.2 s, e.g.
//   document.querySelectorAll('[data-decode]').forEach((el, i) => decode(el, { delay: 0.3 + i * 0.18 }));
