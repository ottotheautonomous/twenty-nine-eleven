import './style.css';
import { animate, stagger, hover, springValue, styleEffect } from 'motion';
import { cipherMarkup } from './cipher.js';
import { createBackground } from './background.js';

const $ = selector => document.querySelector(selector);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scene = $('.scene');
$('#cipher').innerHTML = cipherMarkup;
const background = createBackground($('#world'));
const plane = $('.cipher-plane');
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
const ambient = [];
const entrance = [];
const serviceMotion = new Map();
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
const ease = [0.22, 1, 0.36, 1];
const spring = { stiffness: 95, damping: 23 };
const pointerX = springValue(0, spring);
const pointerY = springValue(0, spring);
const tiltX = springValue(0, spring);
const tiltY = springValue(0, spring);
const nameX = springValue(0, spring);
const nameY = springValue(0, spring);
const focusX = springValue(.5, spring);
const focusY = springValue(.4, spring);
const lightX = springValue('50%', spring);
const lightY = springValue('45%', spring);
const engagement = springValue(0, { stiffness: 75, damping: 21 });
styleEffect(plane, { rotateX: tiltX, rotateY: tiltY });
styleEffect($('#company-name'), { x: nameX, y: nameY });
styleEffect(document.documentElement, { '--visitor-x': lightX, '--visitor-y': lightY });

function updateWorldPointer() { background.setPointer(pointerX.get(), pointerY.get()); }
function updateWorldFocus() { background.setFocus(focusX.get(), focusY.get()); }
pointerX.on('change', updateWorldPointer); pointerY.on('change', updateWorldPointer);
focusX.on('change', updateWorldFocus); focusY.on('change', updateWorldFocus);
function updateIntent(value) {
  const spatial = !reducedMotion.matches && !paused;
  $('.shelter-left').style.transform = spatial ? `translateX(${-value * 3}px)` : 'none';
  $('.shelter-right').style.transform = spatial ? `translateX(${value * 3}px)` : 'none';
  $('.way-sun').style.transform = spatial ? `translateY(${-value * 2}px)` : 'none';
  $('.way-path').style.opacity = String(.65 + value * .35);
  $('.way-horizon').style.opacity = String(.7 + value * .3);
  $('.way-atmosphere').style.opacity = String(.55 + value * .45);
  $('.way-guidance').style.opacity = String(.4 + value * .6);
  background.setEngagement(value);
  scene.dataset.engagement = value.toFixed(3);
}
engagement.on('change', updateIntent);
function refreshIntent() {
  const value = clamp(Math.max(pointerIntent, focusIntent));
  if (reducedMotion.matches || paused) engagement.jump(value); else engagement.set(value);
}
function updateWorldOrigin() {
  const rect = $('.cipher-object').getBoundingClientRect();
  background.setOrigin((rect.left + rect.width / 2) / innerWidth, (rect.top + rect.height / 2) / innerHeight);
}
window.addEventListener('resize', updateWorldOrigin, { passive: true });
window.addEventListener('scroll', updateWorldOrigin, { passive: true });
new ResizeObserver(updateWorldOrigin).observe($('.stage'));
document.fonts.ready.then(updateWorldOrigin);
updateWorldOrigin();
updateIntent(0);

function settlePointer(immediate = false) {
  for (const value of [pointerX, pointerY, tiltX, tiltY, nameX, nameY]) immediate ? value.jump(0) : value.set(0);
}
function updateAmbient() {
  const active = entered && !paused && !reducedMotion.matches && !document.hidden && modalState === 'closed';
  ambient.forEach(control => active ? control.play() : control.pause());
  background.setReducedMotion(reducedMotion.matches || paused);
  background.setActive(active);
  motionToggle.hidden = reducedMotion.matches;
  motionToggle.setAttribute('aria-pressed', String(paused));
  motionToggle.setAttribute('aria-label', paused ? 'Resume animation' : 'Pause animation');
  motionToggle.title = paused ? 'Resume animation' : 'Pause animation';
  $('#motion-icon').setAttribute('d', paused ? 'm7 5 7 5-7 5Z' : 'M7 5v10M13 5v10');
}
function startAmbient() {
  if (ambient.length || reducedMotion.matches) return;
  // A grounded, open shelter: light breathes, architecture does not spin.
  ambient.push(animate($('.cipher-light'), { opacity: [.55, .85, .55] }, { duration: 9, ease: 'easeInOut', repeat: Infinity }));
  updateAmbient();
}
if (!reducedMotion.matches) {
  const reveal = animate($('.cipher-traces').querySelectorAll(':scope > g'), { opacity: [0, 1] }, { duration: 1, ease, delay: stagger(.09) });
  entrance.push(reveal,
    animate($('#world'), { opacity: [0, 1] }, { duration: 1.4, ease }),
    animate($('.cipher-orbits'), { opacity: [0, 1] }, { duration: 1.2, ease }),
    animate($('.cipher-core'), { opacity: [0, 1] }, { duration: .9, delay: .25, ease }),
    animate(document.querySelectorAll('.name-line'), { y: ['110%', '0%'], opacity: [0, 1] }, { duration: .95, ease, delay: stagger(.09, { startDelay: .24 }) }),
    animate(document.querySelectorAll('[data-enter]'), { opacity: [0, 1], y: [10, 0] }, { duration: .75, ease, delay: stagger(.06, { startDelay: .5 }) }),
  );
  reveal.finished.then(() => { entered = true; startAmbient(); updateAmbient(); });
}
updateAmbient();

const intentLevels = { shelter: .7, identity: .45, purpose: .65, work: .45, service: .85, contact: 1 };
function targetIntent(element) { return intentLevels[element?.dataset.react] || .25; }
function setPointerElement(element) {
  if (element === pointerElement) return;
  pointerElement?.classList.remove('is-engaged');
  pointerElement = element;
  pointerElement?.classList.add('is-engaged');
}
function visitPoint(clientX, clientY, input = 'mouse', target = null) {
  const fx = clamp(clientX / Math.max(1, innerWidth));
  const fy = clamp(clientY / Math.max(1, innerHeight));
  const x = fx * 2 - 1; const y = fy * 2 - 1;
  const instant = reducedMotion.matches || paused;
  const set = (value, next) => instant ? value.jump(next) : value.set(next);
  set(focusX, fx); set(focusY, fy);
  const lightingRect = (modalState === 'closed' ? $('#company-name') : dialog).getBoundingClientRect();
  set(lightX, `${clamp((clientX - lightingRect.left) / Math.max(1, lightingRect.width)) * 100}%`);
  set(lightY, `${clamp((clientY - lightingRect.top) / Math.max(1, lightingRect.height)) * 100}%`);
  if (!instant && modalState === 'closed') {
    pointerX.set(x); pointerY.set(y);
    tiltX.set(-y * 5); tiltY.set(x * 6);
    nameX.set(x * 4); nameY.set(y * 2.5);
  }
  const art = $('.cipher-object').getBoundingClientRect();
  const distance = Math.hypot(clientX - art.left - art.width / 2, clientY - art.top - art.height / 2);
  const proximity = clamp(1 - distance / (art.width * .95)) * .8;
  if (input !== 'keyboard') pointerIntent = Math.max(proximity, target ? targetIntent(target) : .1);
  refreshIntent();
  scene.dataset.input = input;
  scene.dataset.focus = `${fx.toFixed(3)},${fy.toFixed(3)}`;
}

scene.addEventListener('pointermove', event => {
  if (modalState !== 'closed') return;
  const target = event.target.closest('[data-react]');
  setPointerElement(target);
  visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse', target);
}, { passive: true });
scene.addEventListener('pointerdown', event => {
  if (modalState !== 'closed') return;
  const target = event.target.closest('[data-react]');
  setPointerElement(target);
  visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse', target);
  // An impulse starts at the real press, rather than the lagging spring focus.
  focusX.jump(clamp(event.clientX / Math.max(1, innerWidth)));
  focusY.jump(clamp(event.clientY / Math.max(1, innerHeight)));
  if (!reducedMotion.matches && !paused) background.setImpulse(event.pointerType === 'touch' ? .75 : .45);
}, { passive: true });
function leaveScene() { pointerIntent = 0; setPointerElement(null); settlePointer(); refreshIntent(); }
scene.addEventListener('pointerleave', leaveScene);
scene.addEventListener('pointercancel', leaveScene);
scene.addEventListener('pointerup', event => { if (event.pointerType === 'touch') leaveScene(); }, { passive: true });
dialog.addEventListener('pointermove', event => {
  if (dialog.open) visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse');
}, { passive: true });

document.addEventListener('focusin', event => {
  if (!scene.contains(event.target) && !dialog.contains(event.target)) return;
  const target = event.target.closest('[data-react]');
  focusIntent = dialog.contains(event.target) ? .9 : targetIntent(target);
  const rect = event.target.getBoundingClientRect();
  visitPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 'keyboard', target);
  refreshIntent();
});
document.addEventListener('focusout', () => queueMicrotask(() => {
  const active = document.activeElement;
  if (!scene.contains(active) && !dialog.contains(active)) { focusIntent = 0; refreshIntent(); }
}));
form.addEventListener('input', () => {
  focusIntent = .7 + clamp(form.elements.message.value.length / 240) * .3;
  refreshIntent();
});
motionToggle.addEventListener('click', () => {
  paused = !paused; settlePointer(true); background.setImpulse(0);
  resetServiceMotion(); resetContactFeedback();
  updateAmbient(); refreshIntent(); updateIntent(engagement.get());
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
    setImmediateMotion($('.contact-rule'), { scaleX: document.activeElement === trigger ? 1 : .26 }),
  ];
}
function highlightContact(active) {
  contactHover.forEach(control => control.stop()); contactHover = [];
  if (reducedMotion.matches || paused) {
    contactHover.push(setImmediateMotion($('.contact-rule'), { scaleX: active ? 1 : .26 }));
    return;
  }
  contactHover.push(
    animate($('.contact-rule'), { scaleX: active ? 1 : .26 }, { type: 'spring', stiffness: 220, damping: 27 }),
    animate($('.contact-arrow'), { x: active ? 4 : 0 }, { type: 'spring', stiffness: 220, damping: 27 }),
  );
}
hover(trigger, () => { highlightContact(true); return () => highlightContact(false); });
trigger.addEventListener('focus', () => highlightContact(true));
trigger.addEventListener('blur', () => highlightContact(false));

function resetServiceMotion() {
  serviceMotion.forEach(control => control.stop()); serviceMotion.clear();
  document.querySelectorAll('.service-control').forEach(button => { serviceMotion.set(button, setImmediateMotion(button, { y: 0 })); });
}
for (const button of document.querySelectorAll('.service-control')) {
  hover(button, () => {
    if (reducedMotion.matches || paused) return;
    serviceMotion.get(button)?.stop();
    serviceMotion.set(button, animate(button, { y: -1.5 }, { type: 'spring', stiffness: 240, damping: 25 }));
    return () => {
      serviceMotion.get(button)?.stop();
      if (reducedMotion.matches || paused) { serviceMotion.set(button, setImmediateMotion(button, { y: 0 })); return; }
      serviceMotion.set(button, animate(button, { y: 0 }, { type: 'spring', stiffness: 240, damping: 25 }));
    };
  });
  button.addEventListener('click', () => {
    if (!submitting && !form.elements.message.value.trim() && success.hidden) {
      form.elements.message.value = `I'm interested in ${button.dataset.service}.\n\n`;
    }
    openContact(button);
  });
}

function stopModalAnimations() { modalAnimations.forEach(control => control.stop()); modalAnimations = []; }
function collapsedTransform() {
  const from = (returnFocus?.isConnected ? returnFocus : trigger).getBoundingClientRect(); const to = dialog.getBoundingClientRect();
  return `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px) scale(${from.width / to.width}, ${from.height / to.height})`;
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
  modalState = 'opening'; settlePointer(); updateAmbient(); surface.scrollTop = 0; focusContact();
  if (reducedMotion.matches) {
    surface.style.transform = 'none'; surface.style.opacity = '1';
    document.querySelectorAll('.dialog-item').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
    scene.style.opacity = '.3'; veil.style.opacity = '1'; modalState = 'open'; return;
  }
  const transform = wasClosed ? [collapsedTransform(), 'translate(0px, 0px) scale(1, 1)'] : 'translate(0px, 0px) scale(1, 1)';
  const frame = animate(surface, { transform, opacity: 1 }, { duration: .55, ease });
  modalAnimations.push(frame,
    animate(scene, { scale: .985, opacity: .3 }, { duration: .35, ease }),
    animate(veil, { opacity: 1 }, { duration: .35 }),
    animate(document.querySelectorAll('.dialog-item'), { opacity: [0, 1], y: [9, 0] }, { duration: .36, ease, delay: stagger(.035, { startDelay: .19 }) }),
  );
  frame.finished.then(() => { if (serial === modalSerial) modalState = 'open'; });
}
function finishClose(serial) {
  if (serial !== modalSerial) return;
  dialog.close(); modalState = 'closed';
  scene.style.transform = 'none'; scene.style.opacity = '1'; veil.style.opacity = '0';
  updateAmbient(); (returnFocus?.isConnected ? returnFocus : trigger).focus({ preventScroll: true });
}
function closeContact() {
  if (!dialog.open || modalState === 'closing') return;
  const serial = ++modalSerial; stopModalAnimations(); modalState = 'closing';
  if (reducedMotion.matches) { finishClose(serial); return; }
  const frame = animate(surface, { transform: collapsedTransform(), opacity: 0 }, { duration: .27, ease: [0.4, 0, 0.2, 1] });
  modalAnimations.push(frame,
    animate(document.querySelectorAll('.dialog-item'), { opacity: 0 }, { duration: .12 }),
    animate(scene, { scale: 1, opacity: 1 }, { duration: .27, ease }),
    animate(veil, { opacity: 0 }, { duration: .27 }),
  );
  frame.finished.then(() => finishClose(serial));
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
  background.setReducedMotion(reducedMotion.matches || paused);
  if (reducedMotion.matches) {
    entrance.forEach(control => control.complete()); successAnimations.forEach(control => control.complete()); contactHover.forEach(control => control.stop()); resetServiceMotion(); settlePointer(true);
    ambient.splice(0).forEach(control => control.stop());
    resetContactFeedback(); $('.cipher-traces').style.transform = 'none';
    const state = modalState; const serial = ++modalSerial; stopModalAnimations();
    if (state === 'closing') finishClose(serial);
    else if (dialog.open) {
      surface.style.transform = 'none'; surface.style.opacity = '1';
      document.querySelectorAll('.dialog-item').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
      scene.style.transform = 'none'; scene.style.opacity = '.3'; veil.style.opacity = '1'; modalState = 'open';
    }
    entered = true;
  } else { startAmbient(); }
  updateAmbient(); refreshIntent(); updateIntent(engagement.get());
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
  submitting = true; fieldset.disabled = true; buttonLabel.textContent = 'Sending…'; status.textContent = ''; status.classList.remove('is-error'); form.setAttribute('aria-busy', 'true');
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
  } finally { submitting = false; fieldset.disabled = false; buttonLabel.textContent = 'Send message'; form.removeAttribute('aria-busy'); }
});
$('#send-another').addEventListener('click', () => {
  requestId = crypto.randomUUID(); form.reset(); fields.forEach(field => field.removeAttribute('aria-invalid'));
  document.querySelectorAll('.field-error').forEach(error => error.textContent = '');
  status.textContent = ''; status.classList.remove('is-error'); success.hidden = true; form.hidden = false; fields[0].focus({ preventScroll: true });
});
sendButton.disabled = false; trigger.disabled = false;
document.querySelectorAll('.service-control').forEach(button => { button.disabled = false; });
