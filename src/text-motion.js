import { animate, stagger, hover } from 'motion';

// Keep hit areas and row geometry stationary; only the ink and light move.
// ownsTouch(element): src/touch.js drives these elements' touch response (slide); their native touch flag is left to pens.
export function createTextMotion(elements, { canAnimate, onActive = null, ownsTouch = null } = {}) {
  const records = new Map();
  const separators = new Map();
  const cleanups = [];

  function stop(record) { record.controls.forEach(control => control.stop()); record.controls = []; }
  function immediate(element, values) {
    const control = animate(element, values, { duration: 0 }); control.complete(); return control;
  }
  function wrapText(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const label = document.createElement('span'); label.className = 'motion-label'; label.setAttribute('aria-hidden', 'true');
      for (const character of Array.from(node.textContent)) {
        const span = document.createElement('span');
        span.className = character === ' ' ? 'motion-space' : 'motion-char';
        span.textContent = character;
        label.appendChild(span);
      }
      node.replaceWith(label);
    }
  }
  function canonicalText(element) {
    return [...element.childNodes].map(node => node.nodeType === Node.TEXT_NODE ? node.textContent : node.nodeName === 'BR' ? ' ' : canonicalText(node)).join(' ').replace(/\s+/g, ' ').trim();
  }
  function makeInk(record) {
    wrapText(record.element);
    const accessible = document.createElement('span'); accessible.className = 'motion-accessible'; accessible.textContent = record.canonical;
    record.element.appendChild(accessible);
    record.labels = [...record.element.querySelectorAll('.motion-label')];
    record.colors = new Map(record.labels.map(label => [label, getComputedStyle(label).color]));
    record.chars = record.labels.flatMap(label => [...label.querySelectorAll('.motion-char')]);
  }
  function updateSeparator(separator, owner, active, immediateOnly = false, snap = false) {
    if (!separator) return;
    let state = separators.get(separator);
    if (!state) {
      state = { owners: new Set(), controls: [], color: getComputedStyle(separator).color };
      separators.set(separator, state);
    }
    active ? state.owners.add(owner) : state.owners.delete(owner);
    state.controls.forEach(control => control.stop());
    const lit = state.owners.size > 0;
    const values = { scale: 1, color: lit ? '#ffe3b0' : state.color, opacity: lit ? 1 : .65 };   // the dots brighten; nothing changes size
    state.controls = [immediateOnly || !canAnimate() ? immediate(separator, values) : animate(separator, values, snap ? { duration: .12, ease: 'easeIn' } : { duration: .2, ease: 'easeOut' })];
  }
  function visibleLabels(record) { return record.labels.filter(label => label.getClientRects().length); }
  function render(record, immediateOnly = false) {
    stop(record);
    const active = record.hover || record.focus || record.touch || record.slide;
    const spatial = canAnimate() && !immediateOnly;
    const snap = !active && record.pace === 'snap';   // a touch letting go: the entrance reversed, quicker (0.625x, mirrored curves)
    const soft = record.soft;   // a soft flash: slow in, hold, slower out, the letters unwinding in reverse (exits mirror entrances)
    record.element.dataset.textActive = String(active);
    const labels = visibleLabels(record);
    const chars = labels.flatMap(label => [...label.querySelectorAll('.motion-char')]);
    // The text never moves or changes size: the response is light alone. A warm wave runs letter by letter, then the underline.
    if (spatial) {
      for (const hidden of record.labels.filter(label => !labels.includes(label))) {
        record.controls.push(immediate(hidden, { scale: 1 }));
        hidden.querySelectorAll('.motion-char').forEach(char => record.controls.push(immediate(char, { y: 0, color: record.colors.get(hidden) })));
      }
      for (const label of labels) {
        const letters = [...label.querySelectorAll('.motion-char')];
        record.controls.push(animate(letters, { color: active ? '#ffe9c4' : record.colors.get(label) }, soft ? {
          duration: active ? soft.in : soft.out, ease: [0.37, 0, 0.63, 1],
          delay: stagger(soft.spread / Math.max(1, chars.length - 1), { from: active ? 'first' : 'last' }),
        } : snap ? {
          duration: .15, ease: 'easeIn', delay: stagger(.6 * Math.min(.012, .1 / Math.max(1, chars.length - 1)), { from: 'last' }),
        } : {
          duration: active ? .24 : .2, ease: 'easeOut',
          delay: active ? stagger(Math.min(.012, .1 / Math.max(1, chars.length - 1))) : 0,
        }));
      }
    } else {
      // Reset hidden responsive variants as well, so switching widths is clean.
      record.labels.forEach(label => record.controls.push(immediate(label, { scale: 1 })));
      for (const label of record.labels) label.querySelectorAll('.motion-char').forEach(char => record.controls.push(immediate(char, { y: 0, color: active ? '#ffe9c4' : record.colors.get(label) })));
    }
    if (record.line) {
      const lineOn = active || record.pinned;   // a pinned underline (the verse citation) is drawn once and the pointer never changes it
      record.line.style.transformOrigin = record.origin;
      const values = record.pinned ? { scaleX: 1, opacity: .75 } : { scaleX: active ? 1 : 0, opacity: active ? .9 : 0 };
      const lineTiming = soft ? { duration: lineOn ? soft.in + soft.spread : soft.out + soft.spread, ease: [0.37, 0, 0.63, 1] } : { duration: lineOn ? .24 : .18, ease: [0.22, 1, 0.36, 1] };
      record.controls.push(spatial ? animate(record.line, values, lineTiming) : immediate(record.line, values));
    }
    if (snap && spatial && record.line && !record.pinned) record.controls.push(animate(record.line, { scaleX: 0, opacity: 0 }, { duration: .15, ease: [0.64, 0, 0.78, 0] }));   // toward its entrance origin
    record.dots.forEach(dot => updateSeparator(dot, record.element, active, !spatial, snap && spatial));
    record.active = active;
  }
  function set(record, key, value, event = null) {
    if (record[key] === value) return;
    record[key] = value;
    const active = record.hover || record.focus || record.touch || record.slide;
    if (active !== record.active) { render(record); onActive?.(record.element, active, event, record.pace); }
  }

  for (const element of elements) {
    const color = getComputedStyle(element).color;
    const canonical = element.matches('.service') ? element.dataset.service : canonicalText(element);
    if (element.matches('label[for]')) {
      const input = document.getElementById(element.htmlFor);
      if (input && !input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) input.setAttribute('aria-label', canonical);
    }
    if (element.matches('.service')) {
      const li = element.closest('li');
      if (li.nextElementSibling && !li.querySelector('.service-separator')) {
        const dot = document.createElement('span'); dot.className = 'service-separator'; dot.textContent = '·'; dot.setAttribute('aria-hidden', 'true'); li.appendChild(dot);
      }
    }
    const line = element.matches('.service, [data-motion-line]') ? document.createElement('span') : null;   // the bullets' underline
    const record = { element, color, canonical, labels: [], colors: new Map(), chars: [], line, dots: [], origin: '50% 50%', controls: [], hover: false, focus: false, touch: false, slide: false, active: false, pinned: false, pace: null, timer: 0 };
    makeInk(record);
    if (line) { line.className = 'service-light'; line.setAttribute('aria-hidden', 'true'); element.appendChild(line); }
    records.set(element, record);
  }
  for (const record of records.values()) {
    if (record.element.matches('.service')) {
      const li = record.element.closest('li');
      let prev = li.previousElementSibling; while (prev?.matches('.services-break')) prev = prev.previousElementSibling;   // a row's line break holds no dot: the word after it shares the dot before it
      record.dots = [prev?.querySelector('.service-separator'), li.querySelector('.service-separator')].filter(Boolean);
    }
    cleanups.push(hover(record.element, (_, event) => {
      const rect = record.element.getBoundingClientRect();
      record.origin = event.clientX < rect.left + rect.width / 2 ? '0% 50%' : '100% 50%';
      set(record, 'hover', true, event);
      return () => set(record, 'hover', false, null);
    }));
    const focusTarget = record.element.matches('label[for]') ? document.getElementById(record.element.htmlFor) : record.element.closest('button') || record.element;
    const focus = () => { record.origin = '50% 50%'; set(record, 'focus', true); };
    const blur = () => set(record, 'focus', false);
    const owned = ownsTouch?.(record.element);
    const native = event => event.pointerType === 'pen' || (event.pointerType === 'touch' && !owned);
    const down = event => { if (native(event)) { clearTimeout(record.timer); set(record, 'touch', true); } };
    const up = event => { if (native(event)) record.timer = setTimeout(() => set(record, 'touch', false), 100); };
    const cancel = event => { if (event.pointerType !== 'touch' || !owned) { clearTimeout(record.timer); set(record, 'touch', false); } };
    focusTarget?.addEventListener('focus', focus); focusTarget?.addEventListener('blur', blur);
    record.element.addEventListener('pointerdown', down, { passive: true });
    record.element.addEventListener('pointerup', up, { passive: true });
    record.element.addEventListener('pointercancel', cancel, { passive: true });
    cleanups.push(() => { focusTarget?.removeEventListener('focus', focus); focusTarget?.removeEventListener('blur', blur); record.element.removeEventListener('pointerdown', down); record.element.removeEventListener('pointerup', up); record.element.removeEventListener('pointercancel', cancel); clearTimeout(record.timer); });
  }
  return {
    // a touch's hover (src/touch.js): on while a finger holds or passes over the element. origin: the underline's growth side (a
    // touchdown keeps the last one, as the native flag did); pace 'snap': a letting go plays the entrance reversed, quicker.
    slide(element, on, { origin = null, pace = null } = {}) {
      const record = records.get(element);
      if (!record) return;
      if (origin) record.origin = origin;
      record.pace = pace; set(record, 'slide', on); record.pace = null;
    },
    setText(element, text) {
      const record = records.get(element);
      if (!record) { element.textContent = text; return; }
      stop(record); record.canonical = text; element.replaceChildren(document.createTextNode(text)); makeInk(record);
      if (record.line) element.appendChild(record.line);
      render(record, true);
    },
    // the hover response played once (light wave, underline), e.g. as an element is revealed; nothing moves
    // soft: { in, out, spread } seconds: a slow swell and a slower release instead of the hover's quick snap
    // keepLine: the underline draws out from the centre with the flash and stays once the letters release (unpin with pin(el, false))
    flash(element, ms = 900, { soft = null, keepLine = false } = {}) {
      const record = records.get(element);
      if (!record || !canAnimate()) return;
      clearTimeout(record.flashTimer); clearTimeout(record.softTimer);
      if (keepLine) { record.pinned = true; record.origin = '50% 50%'; }
      record.soft = soft; set(record, 'touch', true);
      record.flashTimer = setTimeout(() => {
        set(record, 'touch', false);
        record.softTimer = setTimeout(() => { record.soft = null; }, soft ? (soft.out + soft.spread) * 1000 : 0);   // hovers afterwards answer at their usual pace
      }, ms);
    },
    // the underline alone, at once (no motion): shown under still / reduced motion, cleared while its panel is hidden
    pin(element, on) {
      const record = records.get(element);
      if (!record || record.pinned === on) return;
      record.pinned = on; record.origin = '50% 50%'; render(record, true);
    },
    reset() { records.forEach(record => render(record, true)); },
    refresh() { records.forEach(record => render(record, !canAnimate())); },
    destroy() { cleanups.forEach(cleanup => cleanup()); records.forEach(stop); separators.forEach(state => state.controls.forEach(control => control.stop())); },
  };
}
