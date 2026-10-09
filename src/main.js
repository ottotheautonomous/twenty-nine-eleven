import './style.css';
import { animate, stagger, hover, springValue, styleEffect } from 'motion';
import { cipherMarkup } from './cipher.js';
import { createBackground } from './background.js';

const $ = selector => document.querySelector(selector);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const scene = $('.scene');
$('#cipher').innerHTML = cipherMarkup;
const background = createBackground($('#world'));
background.setReducedMotion(reducedMotion.matches);
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
let successAnimations = [];
let modalAnimations = [];
let modalState = 'closed';
let modalSerial = 0;
let paused = false;
let entered = reducedMotion.matches;
let submitting = false;
let requestId = crypto.randomUUID();
let returnFocus = trigger;
const ease = [0.22, 1, 0.36, 1];

const tiltX = springValue(0, { stiffness: 85, damping: 22 });
const tiltY = springValue(0, { stiffness: 85, damping: 22 });
styleEffect(plane, { rotateX: tiltX, rotateY: tiltY });
// The rune stays mechanically centered; depth belongs to the whole instrument.
function updateWorldPointer() { background.setPointer(tiltY.get() / 4, -tiltX.get() / 4); }
tiltX.on('change', updateWorldPointer);
tiltY.on('change', updateWorldPointer);
function updateWorldOrigin() {
  const rect = $('.cipher-object').getBoundingClientRect();
  background.setOrigin((rect.left + rect.width / 2) / innerWidth, (rect.top + rect.height / 2) / innerHeight);
}
window.addEventListener('resize', updateWorldOrigin, { passive: true });
window.addEventListener('scroll', updateWorldOrigin, { passive: true });
new ResizeObserver(updateWorldOrigin).observe($('.stage'));
document.fonts.ready.then(updateWorldOrigin);
updateWorldOrigin();
function settlePointer(immediate = false) {
  for (const value of [tiltX, tiltY]) immediate ? value.jump(0) : value.set(0);
}

function updateAmbient() {
  const active = entered && !paused && !reducedMotion.matches && !document.hidden && modalState === 'closed';
  ambient.forEach(control => active ? control.play() : control.pause());
  background.setActive(active);
  motionToggle.hidden = reducedMotion.matches;
  motionToggle.setAttribute('aria-pressed', String(paused));
  motionToggle.setAttribute('aria-label', paused ? 'Resume animation' : 'Pause animation');
  motionToggle.title = paused ? 'Resume animation' : 'Pause animation';
  $('#motion-icon').setAttribute('d', paused ? 'm7 5 7 5-7 5Z' : 'M7 5v10M13 5v10');
}
function startAmbient() {
  if (ambient.length || reducedMotion.matches) return;
  ambient.push(
    animate($('.cipher-orbit-outer'), { rotate: [0, 360] }, { duration: 36, ease: 'linear', repeat: Infinity }),
    animate($('.cipher-orbit-inner'), { rotate: [0, -360] }, { duration: 46, ease: 'linear', repeat: Infinity }),
    animate($('.cipher-scan'), { pathLength: .085, pathOffset: [0, 1] }, { duration: 8, ease: 'linear', repeat: Infinity }),
    animate($('.cipher-light'), { opacity: [.55, .9, .55] }, { duration: 8, ease: 'easeInOut', repeat: Infinity }),
  );
  updateAmbient();
}
if (!reducedMotion.matches) {
  const draw = animate($('.cipher-traces').querySelectorAll(':scope > g'), { opacity: [0, 1] }, { duration: 1, ease, delay: stagger(.035) });
  entrance.push(draw,
    animate($('#world'), { opacity: [0, 1] }, { duration: 1.4, ease }),
    animate($('.cipher-orbits'), { opacity: [0, 1] }, { duration: 1.2, ease }),
    animate($('.cipher-core'), { opacity: [0, 1] }, { duration: .9, delay: .25, ease }),
    animate(document.querySelectorAll('.name-line'), { y: ['110%', '0%'], opacity: [0, 1] }, { duration: .95, ease, delay: stagger(.09, { startDelay: .24 }) }),
    animate(document.querySelectorAll('[data-enter]'), { opacity: [0, 1], y: [10, 0] }, { duration: .75, ease, delay: stagger(.08, { startDelay: .5 }) }),
  );
  draw.finished.then(() => { entered = true; startAmbient(); updateAmbient(); });
} else $('.cipher-scan').style.opacity = '.25';
updateAmbient();

scene.addEventListener('pointermove', event => {
  if (!finePointer.matches || reducedMotion.matches || paused || modalState !== 'closed') return;
  const x = Math.max(-1, Math.min(1, (event.clientX - innerWidth / 2) / (innerWidth / 2)));
  const y = Math.max(-1, Math.min(1, (event.clientY - innerHeight / 2) / (innerHeight / 2)));
  tiltX.set(-y * 4); tiltY.set(x * 4);
}, { passive: true });
scene.addEventListener('pointerleave', () => settlePointer());
motionToggle.addEventListener('click', () => { paused = !paused; settlePointer(); updateAmbient(); });
document.addEventListener('visibilitychange', updateAmbient);

let contactHover = [];
function highlightContact(active) {
  contactHover.forEach(control => control.stop()); contactHover = [];
  if (reducedMotion.matches) return;
  contactHover.push(
    animate($('.contact-rule'), { scaleX: active ? 1 : .26 }, { type: 'spring', stiffness: 220, damping: 27 }),
    animate($('.contact-arrow'), { x: active ? 4 : 0 }, { type: 'spring', stiffness: 220, damping: 27 }),
    animate($('.cipher-traces'), { rotate: active ? 7 : 0 }, { type: 'spring', stiffness: 55, damping: 18 }),
  );
}
hover(trigger, () => { highlightContact(true); return () => highlightContact(false); });
trigger.addEventListener('focus', () => highlightContact(true));
trigger.addEventListener('blur', () => highlightContact(false));

function stopModalAnimations() { modalAnimations.forEach(control => control.stop()); modalAnimations = []; }
function collapsedTransform() {
  const from = trigger.getBoundingClientRect(); const to = dialog.getBoundingClientRect();
  return `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}
function focusContact() {
  if (!success.hidden) success.focus({ preventScroll: true });
  else if (submitting) $('#close-contact').focus({ preventScroll: true });
  else $('#name').focus({ preventScroll: true });
}
function openContact() {
  if (modalState === 'open' || modalState === 'opening') return;
  const wasClosed = !dialog.open; const serial = ++modalSerial;
  stopModalAnimations();
  if (wasClosed) { returnFocus = trigger; dialog.showModal(); }
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
trigger.addEventListener('click', openContact);
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
  background.setReducedMotion(reducedMotion.matches);
  if (reducedMotion.matches) {
    entrance.forEach(control => control.complete()); successAnimations.forEach(control => control.complete()); contactHover.forEach(control => control.stop()); settlePointer(true);
    ambient.splice(0).forEach(control => control.stop()); $('.cipher-scan').style.opacity = '.25';
    $('.contact-rule').style.transform = 'scaleX(.26)'; $('.contact-arrow').style.transform = 'none'; $('.cipher-traces').style.transform = 'none';
    const state = modalState; const serial = ++modalSerial; stopModalAnimations();
    if (state === 'closing') finishClose(serial);
    else if (dialog.open) {
      surface.style.transform = 'none'; surface.style.opacity = '1';
      document.querySelectorAll('.dialog-item').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
      scene.style.transform = 'none'; scene.style.opacity = '.3'; veil.style.opacity = '1'; modalState = 'open';
    }
    entered = true;
  } else { $('.cipher-scan').style.opacity = '.86'; startAmbient(); }
  updateAmbient();
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
