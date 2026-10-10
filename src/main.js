import './style.css';
import { animate, stagger, hover, press, springValue, styleEffect, delay } from 'motion';
import { createSentinel } from './scene/sentinel.js';
import { createTextMotion } from './text-motion.js';
import { uniforms, engage, idle, settled } from './scene-state.js';
import { CLASS, ROW_READING } from './scene/shape.js';

const $ = selector => document.querySelector(selector);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const debug = params.has('debug') ? Number(params.get('debug')) || 0 : -1;
const scene = $('.scene');
const stage = $('.stage');
const anchor = $('.mark-anchor');
const wordmark = $('#company-name');
const words = [...document.querySelectorAll('.name-word')];
const canvas = $('#world');
const instrument = $('.instrument');
const trigger = $('#open-contact');
const dialog = $('#contact-dialog');
const surface = $('.dialog-surface');
const veil = $('.veil');
const motionToggle = $('.motion-toggle');
const form = $('#contact-form');
const fieldset = $('#contact-fields');
const sendButton = $('.send-button');
const status = $('#form-status');
const success = $('#success');
const buttonLabel = $('.button-label');
const endpoint = import.meta.env.VITE_CONTACT_ENDPOINT || 'https://contact.twentynineeleven.net/api/contact';
const ease = [0.22, 1, 0.36, 1];
const entrance = [];
let successAnimations = [];
let modalAnimations = [];
let modalState = 'closed';
let modalSerial = 0;
let paused = false;
let entered = reducedMotion.matches;
let submitting = false;
let requestId = crypto.randomUUID();
let returnFocus = trigger;
let pointerIntent = 0;
let focusIntent = 0;
let pointerElement = null;
let looping = false;
let idleArmed = false;
let idleTimer = 0;
let sentryTimer = 0;
let integrityLive = reducedMotion.matches;
const still = () => reducedMotion.matches || paused || params.has('still');

// Lift the CSS entrance gate without a flash: targets start transparent inline.
const entering = [canvas, instrument, ...words, ...document.querySelectorAll('[data-enter], .services li'), motionToggle];
if (!still()) entering.forEach(element => { element.style.opacity = '0'; });
root.classList.add('entered');

// Sentinel: a geodesic perimeter of light around one warm ember; the visitor's cursor is the probe.
const sentinel = createSentinel(canvas, anchor, uniforms, { debug: Math.max(0, debug), readout: debug >= 0, readouts: $('.readouts'), instrument });
root.dataset.renderer = sentinel.type;
const model = sentinel.model;
const labels = sentinel.labels;
if (debug >= 0) window.__tne = { uniforms, scene: sentinel, model, lose: sentinel.lose };

const textFeedback = createTextMotion(document.querySelectorAll('.service, .verse, .work-type, .contact-trigger > span:first-child, .contact-heading h2, .email-address, .modal-kicker, .field label, .button-label, .success h3, .success p'), {
  canAnimate: () => !still(),
  onActive: rowActive,
});
// The wordmark parallaxes opposite the camera, written from the same orbit cascade so the layers move as one rig.
const nameX = springValue(0, { stiffness: 60, damping: 18, mass: 1.2 });
const nameY = springValue(0, { stiffness: 60, damping: 18, mass: 1.2 });
styleEffect(wordmark, { x: nameX, y: nameY });
const soft = { stiffness: 95, damping: 23 };
const textLightX = springValue('50%', soft);
const textLightY = springValue('45%', soft);
styleEffect(root, { '--visitor-x': textLightX, '--visitor-y': textLightY });
model.state.onFrame = () => {
  nameX.jump(-model.orbitNorm[0] * 6); nameY.jump(-model.orbitNorm[1] * 3);
  if (integrityLive) labels.setIntegrity(model.state.integrity);
};
model.state.onGreet = lon => { if (!still()) { ring(lon); boost('u_boostGreet', .15, .6); } };
model.state.onState = word => labels.setState(word);
model.state.onTier0 = on => { animate(uniforms, { u_tier0: on ? 1 : 0 }, { duration: on ? .5 : .4, ease }); labels.showTier0(on); };
model.state.onFinding = node => labels.setFindings(node);
// When the loop is idle (paused, reduced motion, modal open) engagement still redraws the composed frame.
engage.on('change', () => { if (!looping) sentinel.drawOnce(); });

// One continuous light across the words: each word's background is the h1 box. Offsets are measured through
// the offsetParent chain because the parallax transform can make the h1 itself the words' offsetParent.
function offsetWithin(element, ancestor) {
  let x = 0, y = 0, node = element;
  while (node && node !== ancestor) {
    x += node.offsetLeft; y += node.offsetTop; node = node.offsetParent;
    if (node && node === ancestor.offsetParent) { x -= ancestor.offsetLeft; y -= ancestor.offsetTop; break; }
  }
  return [x, y];
}
function measureName() {
  wordmark.style.setProperty('--name-w', `${wordmark.offsetWidth}px`);
  wordmark.style.setProperty('--name-h', `${wordmark.offsetHeight}px`);
  for (const word of words) {
    const [x, y] = offsetWithin(word, wordmark);
    word.style.setProperty('--word-x', x);
    word.style.setProperty('--word-y', y);
  }
}
function measure() { sentinel.measure(); measureName(); }
window.addEventListener('resize', () => { sentinel.resize(); measureName(); textFeedback.refresh(); }, { passive: true });
window.addEventListener('scroll', () => sentinel.measure(), { passive: true });
new ResizeObserver(measure).observe(stage);
document.fonts.ready.then(measure);
measureName();

function refreshIntent() {
  const value = clamp(Math.max(pointerIntent, focusIntent));
  if (still()) engage.jump(value); else engage.set(value);
}
function updateAmbient() {
  looping = !still() && !document.hidden && modalState !== 'open';
  model.state.still = still();
  model.state.modal = modalState !== 'closed';
  sentinel.allowSimulation(!still() && modalState === 'closed');
  sentinel.setActive(looping);
  motionToggle.hidden = reducedMotion.matches || sentinel.type === 'static';
  motionToggle.setAttribute('aria-pressed', String(paused));
  motionToggle.setAttribute('aria-label', paused ? 'Resume motion' : 'Pause motion');
  motionToggle.title = paused ? 'Resume motion' : 'Pause motion';
  $('#motion-icon').setAttribute('d', paused ? 'm7 5 7 5-7 5Z' : 'M7 5v10M13 5v10');
}
function applyMotionPolicy() {
  uniforms.u_motion.value = still() ? 0 : 1;
  if (still()) { labels.hideAll(); stopSentry(); }
  updateAmbient(); refreshIntent(); resetServiceMotion(); sentinel.drawOnce();
}

// Idle: after four quiet seconds the camera drifts on a slow Lissajous, the lattice breathes in a travelling
// wave and a sentry band crosses the cage every ~9 s. Any input hands control back in one frame.
function noteActivity() {
  if (!idleArmed) return;
  if (idle.get() !== 0) idle.set(0);
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!still() && modalState === 'closed') idle.set(1); }, 4000);
}
function armIdle() { idleArmed = true; noteActivity(); }
function sentryPass() { animate(uniforms, { u_sentry: [0.001, 1] }, { duration: 2.5, ease: 'linear' }).then(() => { uniforms.u_sentry.value = 0; }); }
function stopSentry() { clearInterval(sentryTimer); sentryTimer = 0; }
idle.on('change', value => {
  if (value > 0.999 && !sentryTimer && !still() && modalState === 'closed') { sentryPass(); sentryTimer = setInterval(sentryPass, 9000); }
  else if (value < 0.999 && sentryTimer) stopSentry();
});
document.addEventListener('keydown', noteActivity);

// Entrance: the ember ignites alone in the dark, the perimeter builds inward around it behind a noise-perturbed
// front, then the name rises from the centre. The corner instrument decodes last and integrity counts in.
if (still()) {
  for (const [key, value] of Object.entries(settled)) uniforms[key].value = value;
  labels.setIntegrity(.998, true);
} else {
  const sceneIn = () => entrance.push(
    animate(canvas, { opacity: [0, 1] }, { duration: .5, delay: .15 }),
    animate(uniforms, { u_ember: [0, 1] }, { duration: .7, ease: [0.2, 0.8, 0.2, 1], delay: .3 }),
    animate(uniforms, { u_build: [0, 1] }, { duration: 1.5, ease, delay: .4 }),
    animate(uniforms, { u_entry: [.25, 0] }, { duration: 2.2, ease: [0.2, 0.8, 0.2, 1], delay: .4 }),
    animate(uniforms, { u_ca: [.6, 0] }, { duration: 1.6, delay: .4 }),
  );
  sentinel.whenReady(sceneIn);
  entrance.push(
    animate(words, { y: ['105%', '0%'], opacity: [0, 1] }, { duration: .9, ease, delay: stagger(.09, { from: 'center', startDelay: 1.25 }) }),
    animate('.work-type', { opacity: [0, 1], y: [8, 0] }, { duration: .7, ease, delay: 1.55 }),
    animate('.services-primary li', { opacity: [0, 1], y: [6, 0] }, { duration: .6, ease, delay: stagger(.04, { from: 'center', startDelay: 1.7 }) }),
    animate('.services-secondary li', { opacity: [0, 1], y: [6, 0] }, { duration: .6, ease, delay: stagger(.035, { from: 'center', startDelay: 1.82 }) }),
    animate('.contact-trigger-shell', { opacity: [0, 1], y: [6, 0] }, { duration: .6, ease, delay: 1.95 }),
    animate('.verse', { opacity: [0, 1] }, { duration: .8, delay: 2.1 }),
    animate(motionToggle, { opacity: [0, .6] }, { duration: .6, delay: 2.3 }),
  );
  delay(() => {
    if (still()) return;
    labels.decodeInstrument();
    labels.countIn(.998).then(() => { integrityLive = true; });
  }, 2.3);
  Promise.all(entrance.map(control => control.finished)).then(() => { entered = true; armIdle(); });
}
sentinel.enableSimulationAt(1.9);
uniforms.u_motion.value = still() ? 0 : 1;
updateAmbient();

const intentLevels = { purpose: .65, work: .45, contact: 1 };
function targetIntent(element) { return intentLevels[element?.dataset.react] || .25; }
function setPointerElement(element) {
  if (element === pointerElement) return;
  pointerElement?.classList.remove('is-engaged');
  pointerElement = element;
  pointerElement?.classList.add('is-engaged');
}
const toNdc = (x, y) => [clamp(x / innerWidth) * 2 - 1, 1 - clamp(y / innerHeight) * 2];
function visitPoint(clientX, clientY, input = 'mouse', target = null) {
  const instant = still();
  const set = (value, next) => instant ? value.jump(next) : value.set(next);
  const lighting = (modalState === 'closed' ? wordmark : dialog).getBoundingClientRect();
  set(textLightX, `${clamp((clientX - lighting.left) / Math.max(1, lighting.width)) * 100}%`);
  set(textLightY, `${clamp((clientY - lighting.top) / Math.max(1, lighting.height)) * 100}%`);
  const shell = anchor.getBoundingClientRect();
  const distance = Math.hypot(clientX - shell.left - shell.width / 2, clientY - shell.top - shell.height / 2);
  const proximity = clamp(1 - distance / (shell.height * 1.1)) * .6;
  if (input !== 'keyboard') pointerIntent = Math.max(proximity, target ? targetIntent(target) : 0);
  refreshIntent();
  noteActivity();
  scene.dataset.input = input;
}

scene.addEventListener('pointermove', event => {
  if (modalState !== 'closed') return;
  const target = event.target.closest('[data-react]');
  setPointerElement(target);
  visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse', target);
  if (still()) return;
  const [nx, ny] = toNdc(event.clientX, event.clientY);
  model.state.keyboard = false;
  model.pointer(nx, ny, event.timeStamp);
  if (model.simulate) sentinel.fluidPointer(event.clientX / innerWidth, 1 - event.clientY / innerHeight, event.timeStamp);
}, { passive: true });
let down = null;
scene.addEventListener('pointerdown', event => {
  if (modalState !== 'closed') return;
  const target = event.target.closest('[data-react]');
  setPointerElement(target);
  visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse', target);
  if (still() || !entered || event.target.closest('button, a, input, textarea')) return;
  const [nx, ny] = toNdc(event.clientX, event.clientY);
  down = { x: event.clientX, y: event.clientY, t: event.timeStamp, touch: event.pointerType === 'touch' };
  model.pointer(nx, ny, event.timeStamp);
  model.press(nx, ny);
  // A press: the whole perimeter flinches outward for one beat and the ember flares.
  uniforms.u_flinch.value = 1; animate(uniforms, { u_flinch: 0 }, { type: 'spring', stiffness: 400, damping: 24 });
  boost('u_boostPress', .4, .6);
}, { passive: true });
scene.addEventListener('pointerup', event => {
  if (down && down.touch && !still() && event.timeStamp - down.t < 250 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 8) {
    // Tap: a wave from the finger across the cage and the three nearest readings for 1.5 s.
    const [nx, ny] = toNdc(event.clientX, event.clientY);
    const p = model.tap(nx, ny);
    uniforms.u_tapX.value = p[0]; uniforms.u_tapY.value = p[1]; uniforms.u_tapZ.value = p[2];
    animate(uniforms, { u_tapT: [0, 1] }, { duration: .9, ease: [0.16, 1, 0.3, 1] });
  }
  down = null;
  if (event.pointerType === 'touch') leaveScene();
}, { passive: true });
function leaveScene() { pointerIntent = 0; setPointerElement(null); refreshIntent(); model.leave(); }
scene.addEventListener('pointerleave', leaveScene);
scene.addEventListener('pointercancel', leaveScene);
dialog.addEventListener('pointermove', event => {
  if (dialog.open) visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse');
}, { passive: true });
function boost(key, peak, seconds) { uniforms[key].value = peak; animate(uniforms, { [key]: 0 }, { duration: seconds, ease: [0.2, 0.8, 0.2, 1] }); }
function ring(lon) {
  uniforms.u_ringLon.value = lon;
  animate(uniforms, { u_ringAmp: 1 }, { duration: .15 });
  animate(uniforms, { u_ringPhase: [0, 1] }, { duration: .6, ease: [0.16, 1, 0.3, 1] }).then(() => animate(uniforms, { u_ringAmp: 0 }, { duration: .4 }));
}

// The rows are plain text, but their hover is felt in the scene: a dotted packet runs the meridian above the
// word; a row-1 word lights its asset class and prints its own reading; a row-2 word tightens the lattice.
function rowActive(element, active) {
  if (!element.matches('.service') || still() || !entered) return;
  const rect = element.getBoundingClientRect(), shell = anchor.getBoundingClientRect();
  const theta = clamp((rect.left + rect.width / 2 - (shell.left + shell.width / 2)) / Math.max(1, shell.width / 2), -1, 1);
  const lon = Math.asin(theta);
  if (active) ring(lon);
  if (element.dataset.row === '1') {
    const c = CLASS[element.dataset.class];
    if (active) { uniforms.u_classSel.value = c; animate(uniforms, { u_classAmp: 1 }, { duration: .2 }); model.rowHover(c, lon, ROW_READING[c]); engage.set(.5); }
    else { animate(uniforms, { u_classAmp: 0 }, { duration: .4 }); model.rowHover(-1); engage.set(0); }
  } else {
    animate(uniforms, { u_tight: active ? 1 : 0, u_warm: active ? 1 : 0 }, { duration: active ? .3 : .8, ease });
  }
}

document.addEventListener('focusin', event => {
  if (!scene.contains(event.target) && !dialog.contains(event.target)) return;
  const target = event.target.closest('[data-react]');
  focusIntent = dialog.contains(event.target) ? .9 : targetIntent(target);
  const rect = event.target.getBoundingClientRect();
  visitPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 'keyboard', target);
  if (!dialog.contains(event.target) && !still()) {
    const [nx, ny] = toNdc(rect.left + rect.width / 2, rect.top + rect.height / 2);
    model.state.keyboard = true; model.pointer(nx, ny, performance.now() - 1000);
  }
  refreshIntent();
});
document.addEventListener('focusout', () => queueMicrotask(() => {
  const active = document.activeElement;
  if (!scene.contains(active) && !dialog.contains(active)) { focusIntent = 0; refreshIntent(); if (model.state.keyboard) { model.state.keyboard = false; model.leave(); } }
}));
form.addEventListener('input', () => {
  focusIntent = .7 + clamp(form.elements.message.value.length / 240) * .3;
  refreshIntent();
});
motionToggle.addEventListener('click', () => {
  paused = !paused;
  if (paused) {
    entrance.forEach(control => control.complete());
    idle.jump(0); clearTimeout(idleTimer); stopSentry();
    integrityLive = true;
  } else noteActivity();
  resetContactFeedback();
  applyMotionPolicy();
});
document.addEventListener('visibilitychange', updateAmbient);

let contactHover = [];
function setImmediateMotion(element, values) {
  const control = animate(element, values, { duration: 0 });
  control.complete();
  return control;
}
function resetContactFeedback() {
  contactHover.forEach(control => control.stop());
  contactHover = [
    setImmediateMotion($('.contact-arrow'), { x: 0 }),
    setImmediateMotion($('.contact-rule'), { scaleX: document.activeElement === trigger ? 1 : .3 }),
  ];
}
function highlightContact(active) {
  contactHover.forEach(control => control.stop()); contactHover = [];
  if (still()) {
    contactHover.push(setImmediateMotion($('.contact-rule'), { scaleX: active ? 1 : .3 }));
    return;
  }
  contactHover.push(
    animate($('.contact-rule'), { scaleX: active ? 1 : .3 }, { type: 'spring', stiffness: 220, damping: 27 }),
    animate($('.contact-arrow'), { x: active ? 4 : 0 }, { type: 'spring', stiffness: 220, damping: 27 }),
  );
}
hover(trigger, () => { highlightContact(true); return () => highlightContact(false); });
trigger.addEventListener('focus', () => highlightContact(true));
trigger.addEventListener('blur', () => highlightContact(false));
// Tactile press on every control.
const pressSpring = { type: 'spring', stiffness: 400, damping: 30 };
press('#open-contact, .send-button', element => {
  if (still()) return;
  animate(element, { scale: .97 }, pressSpring);
  return () => animate(element, { scale: 1 }, pressSpring);
});

function resetServiceMotion() {
  if (still()) textFeedback.reset(); else textFeedback.refresh();
}

// "Authorize": the perimeter takes a breath, the ember rises, the lattice dims and the camera draws back; the
// panel springs from the ember's screen position. No slot, seam or gate opens.
function stopModalAnimations() { modalAnimations.forEach(control => control.stop()); modalAnimations = []; }
function coreTransform() {
  const from = anchor.getBoundingClientRect(); const to = dialog.getBoundingClientRect();
  return `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px) scale(.5)`;
}
function setScenery(value) {
  uniforms.u_dolly.value = value; uniforms.u_dim.value = value; uniforms.u_open.value = value; sentinel.drawOnce();
}
function focusContact() {
  if (!success.hidden) success.focus({ preventScroll: true });
  else if (submitting) $('#close-contact').focus({ preventScroll: true });
  else $('#name').focus({ preventScroll: true });
}
function openContact(origin = trigger) {
  if (modalState === 'open' || modalState === 'opening') return;
  const wasClosed = !dialog.open; const serial = ++modalSerial;
  stopModalAnimations();
  if (wasClosed) { returnFocus = origin; dialog.showModal(); }
  modalState = 'opening'; idle.jump(0); clearTimeout(idleTimer); stopSentry(); labels.hideAll();
  surface.scrollTop = 0; focusContact(); updateAmbient();
  if (reducedMotion.matches) {
    surface.style.transform = 'none'; surface.style.opacity = '1';
    document.querySelectorAll('.dialog-item').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
    scene.style.opacity = '.22'; veil.style.opacity = '.5'; setScenery(1);
    modalState = 'open'; updateAmbient(); return;
  }
  const scenery = paused ? (setScenery(1), []) : [
    animate(uniforms, { u_open: 1 }, { duration: .5, ease }),
    animate(uniforms, { u_dolly: 1 }, { duration: .7, ease }),
    animate(uniforms, { u_dim: 1 }, { duration: .5, ease }),
    animate(uniforms, { u_ca: [.4, 0] }, { duration: .7 }),
  ];
  const panel = animate(surface, { transform: wasClosed ? [coreTransform(), 'translate(0px, 0px) scale(1)'] : 'translate(0px, 0px) scale(1)' }, { type: 'spring', visualDuration: .6, bounce: .05 });
  modalAnimations.push(panel, ...scenery,
    animate(surface, { opacity: wasClosed ? [0, 1] : 1 }, { duration: .3, ease }),
    animate(veil, { opacity: .5 }, { duration: .35 }),
    animate(scene, { opacity: .22 }, { duration: .35, ease }),
    animate(document.querySelectorAll('.dialog-item'), { opacity: [0, 1], y: [9, 0] }, { duration: .36, ease, delay: stagger(.035, { startDelay: .18 }) }),
  );
  Promise.all([panel, ...scenery].map(control => control.finished)).then(() => {
    if (serial !== modalSerial) return;
    modalState = 'open'; updateAmbient();
  });
}
function finishClose(serial) {
  if (serial !== modalSerial) return;
  dialog.close(); modalState = 'closed';
  scene.style.opacity = '1'; veil.style.opacity = '0';
  if (still()) setScenery(0);
  updateAmbient(); noteActivity(); (returnFocus?.isConnected ? returnFocus : trigger).focus({ preventScroll: true });
  if (!still()) { integrityLive = false; labels.blinkIntegrity(.9, .998).then(() => { integrityLive = true; }); }
}
function closeContact() {
  if (!dialog.open || modalState === 'closing') return;
  const serial = ++modalSerial; stopModalAnimations(); modalState = 'closing'; updateAmbient();
  if (reducedMotion.matches) { finishClose(serial); return; }
  const panel = animate(surface, { transform: coreTransform(), opacity: 0 }, { duration: .28, ease: [0.4, 0, 0.2, 1] });
  modalAnimations.push(panel,
    animate(document.querySelectorAll('.dialog-item'), { opacity: 0 }, { duration: .12 }),
    animate(veil, { opacity: 0 }, { duration: .28 }),
    animate(scene, { opacity: 1 }, { duration: .28, ease }),
  );
  if (!paused) modalAnimations.push(animate(uniforms, { u_open: 0, u_dolly: 0, u_dim: 0 }, { duration: .6, ease }));
  panel.finished.then(() => finishClose(serial));
}
trigger.addEventListener('click', () => openContact(trigger));
$('#close-contact').addEventListener('click', closeContact);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeContact(); });
dialog.addEventListener('keydown', event => {
  if (event.key !== 'Tab' || !dialog.open) return;
  const controls = [...dialog.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')]
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && !el.closest('[inert]'));
  const first = controls[0]; const last = controls.at(-1);
  if (!first) return;
  if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
    event.preventDefault(); first.focus();
  }
});
let backdropDown = false;
function outsidePanel(event) { const rect = dialog.getBoundingClientRect(); return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; }
dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outsidePanel(event); });
dialog.addEventListener('pointerup', event => { if (backdropDown && event.target === dialog && outsidePanel(event)) closeContact(); backdropDown = false; });

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    entrance.forEach(control => control.complete()); successAnimations.forEach(control => control.complete());
    contactHover.forEach(control => control.stop()); idle.jump(0); clearTimeout(idleTimer); stopSentry();
    resetContactFeedback(); integrityLive = true;
    const state = modalState; const serial = ++modalSerial; stopModalAnimations();
    if (state === 'closing') finishClose(serial);
    else if (dialog.open) {
      surface.style.transform = 'none'; surface.style.opacity = '1';
      document.querySelectorAll('.dialog-item').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
      scene.style.opacity = '.22'; veil.style.opacity = '.5'; setScenery(1); modalState = 'open';
    }
    entered = true;
  } else armIdle();
  applyMotionPolicy();
});

const fields = ['name', 'email', 'message'].map(name => form.elements.namedItem(name));
function validate(field) {
  const value = field.value.trim(); let message = '';
  if (!value) message = field.name === 'message' ? 'Please tell us a little about your enquiry.' : `Please enter your ${field.name === 'email' ? 'email address' : 'name'}.`;
  else if (field.name === 'email' && (field.validity.typeMismatch || !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value))) message = 'Please enter a valid email address.';
  else if (field.name === 'message' && value.length < 10) message = 'A little more detail, please — at least 10 characters.';
  $(`#${field.name}-error`).textContent = message; field.setAttribute('aria-invalid', String(Boolean(message))); return !message;
}
fields.forEach(field => {
  field.addEventListener('blur', () => { if (field.value || field.getAttribute('aria-invalid') === 'true') validate(field); });
  field.addEventListener('input', () => { if (field.getAttribute('aria-invalid') === 'true') validate(field); });
});
form.addEventListener('submit', async event => {
  event.preventDefault(); if (submitting) return;
  const validity = fields.map(validate); const invalid = validity.indexOf(false);
  if (invalid !== -1) { fields[invalid].focus(); return; }
  const payload = { name: fields[0].value.trim(), email: fields[1].value.trim(), message: fields[2].value.trim(), website: form.elements.website.value, requestId };
  submitting = true; fieldset.disabled = true; textFeedback.setText(buttonLabel, 'Sending…'); status.textContent = ''; status.classList.remove('is-error'); form.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), credentials: 'omit' });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      if (response.status === 429) throw new Error('Please wait a minute before sending again. Your message is still here.');
      throw new Error('Your enquiry could not be sent. Please try again shortly. Your message is still here.');
    }
    form.hidden = true; success.hidden = false;
    if (dialog.open && modalState !== 'closing') success.focus({ preventScroll: true });
    if (!reducedMotion.matches && dialog.open && modalState !== 'closing') {
      successAnimations.forEach(control => control.stop());
      successAnimations = [
        animate(success, { opacity: [0, 1], y: [8, 0] }, { duration: .4, ease }),
        animate($('.success-check'), { pathLength: [0, 1] }, { duration: .55, ease, delay: .15 }),
      ];
    }
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'Delivery is taking longer than expected. Please try again shortly. Your message is still here.'
      : error instanceof TypeError ? 'We could not reach the contact service. Please try again shortly. Your message is still here.' : error.message;
    status.classList.add('is-error');
  } finally { submitting = false; fieldset.disabled = false; textFeedback.setText(buttonLabel, 'Send message'); form.removeAttribute('aria-busy'); }
});
$('#send-another').addEventListener('click', () => {
  requestId = crypto.randomUUID(); form.reset(); fields.forEach(field => field.removeAttribute('aria-invalid'));
  document.querySelectorAll('.field-error').forEach(error => error.textContent = '');
  status.textContent = ''; status.classList.remove('is-error'); success.hidden = true; form.hidden = false; fields[0].focus({ preventScroll: true });
});
sendButton.disabled = false; trigger.disabled = false;
