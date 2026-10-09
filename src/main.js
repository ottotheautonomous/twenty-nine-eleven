import './style.css';
import { animate, stagger, hover } from 'motion';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const animations = [];
const words = document.querySelectorAll('.word');
const enters = document.querySelectorAll('[data-enter]');
const sigil = document.querySelector('.sigil');
const sendButton = document.querySelector('.send-button');
const arrow = sendButton.querySelector('svg');
const form = document.querySelector('#contact-form');
const status = document.querySelector('#form-status');
const success = document.querySelector('#success');
const buttonLabel = document.querySelector('.button-label');
const endpoint = import.meta.env.VITE_CONTACT_ENDPOINT || 'https://contact.twentynineeleven.net/api/contact';
let requestId = crypto.randomUUID();
let submitting = false;

if (!reducedMotion.matches) {
  animations.push(animate(words, { transform: ['translateY(105%)', 'translateY(0%)'] }, { duration: 1.15, ease: [0.22, 1, 0.36, 1], delay: stagger(.12, { startDelay: .15 }) }));
  animations.push(animate(enters, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] }, { duration: .85, ease: [0.22, 1, 0.36, 1], delay: stagger(.09, { startDelay: .25 }) }));
  animations.push(animate(sigil, { opacity: [0, 1], transform: ['rotate(-15deg)', 'rotate(0deg)'] }, { duration: 1.8, ease: [0.22, 1, 0.36, 1] }));
}

hover(sendButton, () => {
  if (reducedMotion.matches || submitting) return;
  animations.push(animate(arrow, { transform: 'translateX(4px)' }, { type: 'spring', stiffness: 280, damping: 26 }));
  return () => animations.push(animate(arrow, { transform: 'translateX(0px)' }, { type: 'spring', stiffness: 280, damping: 26 }));
});

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    animations.splice(0).forEach(animation => animation.complete());
    arrow.style.transform = 'none';
  }
});

const fields = ['name', 'email', 'message'].map(name => form.elements.namedItem(name));
function validate(field) {
  const trimmed = field.value.trim();
  let message = '';
  if (!trimmed) message = field.name === 'message' ? 'Please tell us a little about your enquiry.' : `Please enter your ${field.name === 'email' ? 'email address' : 'name'}.`;
  else if (field.name === 'email' && field.validity.typeMismatch) message = 'Please enter a valid email address.';
  else if (field.name === 'message' && trimmed.length < 10) message = 'A little more detail, please — at least 10 characters.';
  document.querySelector(`#${field.name}-error`).textContent = message;
  field.setAttribute('aria-invalid', String(Boolean(message)));
  return !message;
}

fields.forEach(field => {
  field.addEventListener('blur', () => { if (field.value || field.getAttribute('aria-invalid') === 'true') validate(field); });
  field.addEventListener('input', () => { if (field.getAttribute('aria-invalid') === 'true') validate(field); });
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const validity = fields.map(validate);
  const invalidIndex = validity.indexOf(false);
  if (invalidIndex !== -1) { fields[invalidIndex].focus(); return; }
  submitting = true;
  sendButton.disabled = true;
  buttonLabel.textContent = 'Sending…';
  status.textContent = '';
  status.classList.remove('is-error');
  form.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.elements.name.value.trim(),
        email: form.elements.email.value.trim(),
        message: form.elements.message.value.trim(),
        website: form.elements.website.value,
        requestId,
      }),
      signal: AbortSignal.timeout(15000),
      credentials: 'omit',
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) {
      if (response.status === 429) throw new Error('Please wait a minute before sending again. Your message is still here.');
      throw new Error('Your enquiry could not be sent. Please try again shortly. Your message is still here.');
    }
    form.hidden = true;
    success.hidden = false;
    success.focus();
    if (!reducedMotion.matches) animations.push(animate(success, { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] }, { duration: .5, ease: [0.22, 1, 0.36, 1] }));
  } catch (error) {
    status.textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'Delivery is taking longer than expected. Please try again shortly. Your message is still here.'
      : error instanceof TypeError
        ? 'We could not reach the contact service. Please try again shortly. Your message is still here.'
        : error.message;
    status.classList.add('is-error');
  } finally {
    submitting = false;
    sendButton.disabled = false;
    buttonLabel.textContent = 'Send enquiry';
    form.removeAttribute('aria-busy');
  }
});

document.querySelector('#send-another').addEventListener('click', () => {
  requestId = crypto.randomUUID();
  form.reset();
  fields.forEach(field => field.removeAttribute('aria-invalid'));
  document.querySelectorAll('.field-error').forEach(error => error.textContent = '');
  status.textContent = '';
  success.hidden = true;
  form.hidden = false;
  fields[0].focus();
});

// Keep submission disabled if JavaScript cannot initialize.
sendButton.disabled = false;

const serviceList = document.querySelector('.services ul');
function updateServiceScroll() {
  if (serviceList.scrollWidth > serviceList.clientWidth) {
    serviceList.tabIndex = 0;
    serviceList.setAttribute('aria-label', 'Our work — scroll to view all services');
  } else {
    serviceList.removeAttribute('tabindex');
    serviceList.removeAttribute('aria-label');
  }
}
updateServiceScroll();
window.addEventListener('resize', updateServiceScroll);
