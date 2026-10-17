import { animate, springValue, styleEffect } from 'motion';

// The rails (.review/rails/lead/RAILS-SPEC.md): two silver hairlines frame the rows, one above row 1 and one below row 2, in the
// wordmark's metal with the underline's soft ends. They are pseudo-elements of the two lists drawn in the rows' existing gaps
// (style.css), so no text box moves. This module sizes them to the layout, draws them out from the centre as the rows arrive,
// and lets them catch the visitor's light: a faint warm glint where the pointer (or a sliding finger) is, full between the rails.
// The tagline's second line (.work-plate, the owner's pick 2026-10-16: "Private commissions, by appointment") is in the markup and arrives
// with the rails. Test builds only (like ?debug): ?rails=a|b|c|0 picks the variant; ?tag=0 hides the second line, ?tag=1|3 swaps its words.
const testBuild = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
const NEAR = 96;   // px: the glint is full anywhere between the rails and fades out this far beyond them
// The widest line of a set of boxes, in px. Lines are keyed by layout top: an item's li (or the word itself), whose offsetTop the
// entrance's rise never changes; the extents are the boxes' x, which the rise (y only) and the rows' hover never touch.
const widest = elements => {
  const lines = new Map();
  for (const e of elements) {
    if (!e.offsetWidth) continue;
    const r = e.getBoundingClientRect(), k = (e.closest('li') ?? e).offsetTop, l = lines.get(k);
    lines.set(k, l ? [Math.min(l[0], r.left), Math.max(l[1], r.right)] : [r.left, r.right]);
  }
  return Math.max(0, ...[...lines.values()].map(([a, b]) => b - a));
};
export function createRails({ rows, words, workType, params, ease, spring }) {
  const pick = testBuild ? params.get('rails') : null;
  const variant = /^[abc0]$/.test(pick ?? '') ? pick : 'b';
  document.documentElement.dataset.rails = variant;
  let plate = workType.parentElement.querySelector('.work-plate');
  if (testBuild && plate && params.has('tag')) {
    const tag = { 1: 'For private clients, estates and institutions', 3: 'From first sketch to final fitting' }[params.get('tag')];
    if (params.get('tag') === '0') { plate.remove(); plate = null; } else if (tag) plate.textContent = tag;
  }
  const platePart = () => plate ? [animate(plate, { opacity: [0, 1] }, { duration: .8, delay: 1.62 })] : [];
  if (variant === '0') return { variant, measure() {}, hide() {}, enter: platePart, point() {}, leave() {} };   // no rails: no springs, no draw

  const x = springValue('0px', spring), glow = springValue(0, spring);
  rows.forEach(row => styleEffect(row, { '--rail-x': x, '--rail-glow': glow }));
  let half = 0, aim = 0;
  return {
    variant,
    measure() {
      const rowsW = Math.max(...rows.map(row => widest(row.querySelectorAll('.service'))));
      const w = variant === 'a' ? widest(words) : variant === 'c' ? Math.min(340, Math.max(140, rowsW * .36)) : rowsW * 1.12;
      rows.forEach(row => row.style.setProperty('--rail-w', `${w.toFixed(1)}px`));
      half = (parseFloat(getComputedStyle(rows[0], '::before').width) || w) / 2;   // as drawn (CSS clamps it to the screen or column)
    },
    hide() { rows.forEach(row => row.style.setProperty('--rail', '0')); },
    // upper 2060 -> 2900 ms, lower 2100 -> 2900 ms: out from the centre as the rows settle, done with the verse (entered is not delayed)
    enter() { return [...rows.map((row, i) => animate(row, { '--rail': [0, 1] }, { duration: .84 - .04 * i, ease, delay: 2.06 + .04 * i })), ...platePart()]; },
    point(clientX, clientY, instant) {
      const a = rows[0].getBoundingClientRect(), b = rows[1].getBoundingClientRect(), mid = a.left + a.width / 2;
      const dx = Math.max(Math.abs(clientX - mid) - half, 0), dy = Math.max(a.top - clientY, 0, clientY - b.bottom);
      const t = Math.max(0, 1 - Math.hypot(dx, dy) / NEAR), near = t * t * (3 - 2 * t);
      const dark = glow.get() < .004;
      if (!near && !aim && dark) return;   // far off and unlit: nothing to restyle
      aim = near;
      const along = `${Math.max(-half, Math.min(half, clientX - mid)).toFixed(1)}px`;
      if (instant || dark) x.jump(along); else x.set(along);   // a glint lights where the hand is; it never slides in from where it last left
      if (instant) glow.jump(near); else glow.set(near);
    },
    leave(instant) { aim = 0; if (instant) glow.jump(0); else glow.set(0); },   // the glint goes as it came, on the same spring, in place
  };
}
