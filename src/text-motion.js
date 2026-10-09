import { animate, stagger, hover } from 'motion';

// Keep hit areas and row geometry stationary; only the ink and light move.
export function createTextMotion(elements, { canAnimate, compact = () => innerWidth <= 600 } = {}) {
  const records = new Map();
  const separators = new Map();
  const cleanups = [];
  const spring = { type: 'spring', stiffness: 330, damping: 28 };

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
        span.textContent = character === ' ' ? '\u00a0' : character;
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
    if (!record.element.matches('.service-control')) {
      const accessible = document.createElement('span'); accessible.className = 'motion-accessible'; accessible.textContent = record.canonical;
      record.element.appendChild(accessible);
    }
    record.labels = [...record.element.querySelectorAll('.motion-label')];
    record.colors = new Map(record.labels.map(label => [label, getComputedStyle(label).color]));
    record.chars = record.labels.flatMap(label => [...label.querySelectorAll('.motion-char')]);
  }
  function updateSeparator(separator, owner, active, immediateOnly = false) {
    if (!separator) return;
    let state = separators.get(separator);
    if (!state) {
      state = { owners: new Set(), controls: [], color: getComputedStyle(separator).color };
      separators.set(separator, state);
    }
    active ? state.owners.add(owner) : state.owners.delete(owner);
    state.controls.forEach(control => control.stop());
    const lit = state.owners.size > 0;
    const values = { scale: canAnimate() ? (lit ? 1.35 : 1) : 1, color: lit ? '#fff0c8' : state.color, opacity: lit ? 1 : .65 };
    state.controls = [immediateOnly || !canAnimate() ? immediate(separator, values) : animate(separator, values, { duration: .2, ease: 'easeOut' })];
  }
  function visibleLabels(record) { return record.labels.filter(label => label.getClientRects().length); }
  function render(record, immediateOnly = false) {
    stop(record);
    const active = record.hover || record.focus || record.touch;
    const spatial = canAnimate() && !immediateOnly;
    record.element.dataset.textActive = String(active);
    const labels = visibleLabels(record);
    const chars = labels.flatMap(label => [...label.querySelectorAll('.motion-char')]);
    const scale = active && spatial ? (compact() ? 1.025 : 1.04) : 1;
    const lift = active && spatial ? (compact() ? -2.2 : -3.6) : 0;
    const labelValues = { scale };
    if (spatial) {
      for (const hidden of record.labels.filter(label => !labels.includes(label))) {
        record.controls.push(immediate(hidden, { scale: 1 }));
        hidden.querySelectorAll('.motion-char').forEach(char => record.controls.push(immediate(char, { y: 0, color: record.colors.get(hidden) })));
      }
      record.controls.push(animate(labels, labelValues, spring));
      for (const label of labels) {
        const letters = [...label.querySelectorAll('.motion-char')];
        record.controls.push(animate(letters, { y: lift, color: active ? '#fff1cb' : record.colors.get(label) }, {
          ...spring,
          delay: active ? stagger(Math.min(.012, .1 / Math.max(1, chars.length - 1))) : 0,
          color: { duration: active ? .24 : .2, ease: 'easeOut' },
        }));
      }
    } else {
      // Reset hidden responsive variants as well, so switching widths is clean.
      record.labels.forEach(label => record.controls.push(immediate(label, { scale: 1 })));
      for (const label of record.labels) label.querySelectorAll('.motion-char').forEach(char => record.controls.push(immediate(char, { y: 0, color: active ? '#fff1cb' : record.colors.get(label) })));
    }
    if (record.line) {
      record.line.style.transformOrigin = record.origin;
      const values = { scaleX: active ? 1 : 0, opacity: active ? .9 : 0 };
      record.controls.push(spatial ? animate(record.line, values, { duration: active ? .24 : .18, ease: [0.22, 1, 0.36, 1] }) : immediate(record.line, values));
    }
    record.dots.forEach(dot => updateSeparator(dot, record.element, active, !spatial));
    record.active = active;
  }
  function set(record, key, value) {
    if (record[key] === value) return;
    record[key] = value;
    const active = record.hover || record.focus || record.touch;
    if (active !== record.active) render(record);
  }

  for (const element of elements) {
    const color = getComputedStyle(element).color;
    const canonical = element.matches('.service-control') ? element.dataset.service : canonicalText(element);
    if (element.matches('label[for]')) {
      const input = document.getElementById(element.htmlFor);
      if (input && !input.hasAttribute('aria-label') && !input.hasAttribute('aria-labelledby')) input.setAttribute('aria-label', canonical);
    }
    if (element.matches('.service-control')) {
      element.setAttribute('aria-label', element.dataset.service);
      const li = element.closest('li');
      if (li.nextElementSibling && !li.querySelector('.service-separator')) {
        const dot = document.createElement('span'); dot.className = 'service-separator'; dot.textContent = '·'; dot.setAttribute('aria-hidden', 'true'); li.appendChild(dot);
      }
    }
    const line = element.matches('.service-control') ? document.createElement('span') : null;
    const record = { element, color, canonical, labels: [], colors: new Map(), chars: [], line, dots: [], origin: '50% 50%', controls: [], hover: false, focus: false, touch: false, active: false, timer: 0 };
    makeInk(record);
    if (line) { line.className = 'service-light'; line.setAttribute('aria-hidden', 'true'); element.appendChild(line); }
    records.set(element, record);
  }
  for (const record of records.values()) {
    if (record.element.matches('.service-control')) {
      const li = record.element.closest('li');
      record.dots = [li.previousElementSibling?.querySelector('.service-separator'), li.querySelector('.service-separator')].filter(Boolean);
    }
    cleanups.push(hover(record.element, (_, event) => {
      const rect = record.element.getBoundingClientRect();
      record.origin = event.clientX < rect.left + rect.width / 2 ? '0% 50%' : '100% 50%';
      set(record, 'hover', true);
      return () => set(record, 'hover', false);
    }));
    const focusTarget = record.element.matches('label[for]') ? document.getElementById(record.element.htmlFor) : record.element.closest('button') || record.element;
    const focus = () => { record.origin = '50% 50%'; set(record, 'focus', true); };
    const blur = () => set(record, 'focus', false);
    const down = event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') { clearTimeout(record.timer); set(record, 'touch', true); } };
    const up = event => { if (event.pointerType === 'touch' || event.pointerType === 'pen') record.timer = setTimeout(() => set(record, 'touch', false), 100); };
    const cancel = () => { clearTimeout(record.timer); set(record, 'touch', false); };
    focusTarget?.addEventListener('focus', focus); focusTarget?.addEventListener('blur', blur);
    record.element.addEventListener('pointerdown', down, { passive: true });
    record.element.addEventListener('pointerup', up, { passive: true });
    record.element.addEventListener('pointercancel', cancel, { passive: true });
    cleanups.push(() => { focusTarget?.removeEventListener('focus', focus); focusTarget?.removeEventListener('blur', blur); record.element.removeEventListener('pointerdown', down); record.element.removeEventListener('pointerup', up); record.element.removeEventListener('pointercancel', cancel); clearTimeout(record.timer); });
  }
  return {
    setText(element, text) {
      const record = records.get(element);
      if (!record) { element.textContent = text; return; }
      stop(record); record.canonical = text; element.replaceChildren(document.createTextNode(text)); makeInk(record);
      if (record.line) element.appendChild(record.line);
      render(record, true);
    },
    reset() { records.forEach(record => render(record, true)); },
    refresh() { records.forEach(record => render(record, !canAnimate())); },
    destroy() { cleanups.forEach(cleanup => cleanup()); records.forEach(stop); separators.forEach(state => state.controls.forEach(control => control.stop())); },
  };
}
