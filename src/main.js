import './style.css';
import { animate, stagger, hover, press, springValue, styleEffect, delay, frame, cancelFrame, motionValue, cubicBezier } from 'motion';
import { createSentinel } from './scene/sentinel.js';
import { createTextMotion } from './text-motion.js';
import { uniforms, engage, idle, settled } from './scene-state.js';
import { CLASS, ROW_READING } from './scene/shape.js';
import { RESET } from './scene/constants.js';
import { wrapWords } from './verse-light.js';
import { turnstileEnabled, prepareTurnstile, turnstileToken } from './turnstile.js';
import { createTilt } from './tilt.js';
import { createTouchSelect } from './touch.js';
import { createSparkle } from './sparkle.js';
import { createLiving, parseLiving } from './living.js';

// Never run inside someone else's frame (clickjacking): a meta CSP cannot set frame-ancestors on GitHub Pages.
if (window.top !== window.self) document.documentElement.style.display = 'none';
const $ = selector => document.querySelector(selector);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
// ?debug (fps readout, window.__tne) exists only in development and in test builds made with VITE_DEBUG_HOOKS=1.
const debugHooks = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
const debug = debugHooks && params.has('debug') ? Number(params.get('debug')) || 0 : -1;
const scene = $('.scene');
const stage = $('.stage');
const anchor = $('.mark-anchor');
const wordmark = $('#company-name');
const words = [...document.querySelectorAll('.name-word')];
const canvas = $('#world');
const instrument = $('.instrument');
const trigger = $('#open-contact');
const dialog = $('#contact-dialog');
const surface = $('#contact-dialog .dialog-surface');
const verseButton = $('#open-verse');
const verseDialog = $('#verse-dialog');
const verseSurface = $('#verse-dialog .dialog-surface');
const verseText = $('.verse-text');
const veil = $('.veil');
const motionToggle = $('.motion-toggle');
const form = $('#contact-form');
const fieldset = $('#contact-fields');
const sendButton = $('.send-button');
const status = $('#form-status');
const success = $('#success');
const buttonLabel = $('.button-label');
const endpoint = import.meta.env.VITE_CONTACT_ENDPOINT || 'https://twenty-nine-eleven-contact.twentynineeleven.workers.dev/api/contact';
const ease = [0.22, 1, 0.36, 1];
const easeBack = [0.64, 0, 0.78, 0];   // ease mirrored: a touch's snap exit plays its entrance in reverse
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
let rowIntent = 0;
let lastDrawnEngage = 0;
let current = null;            // the open dialog's descriptor (one modal at a time)
let verseActive = false;
let restoring = false;         // the instrument reads RESTORING from the reset's start until it seals or aborts
const contactSources = { hover: false, focus: false, press: false, slide: false };   // what holds the trigger's peak (arrow drawn, strand formed)
let hoverHeld = false;         // a panel opened under a hovering pointer: that hover counts again once the pointer moves
const still = () => reducedMotion.matches || paused || params.has('still');

// Living layer & row-2 cage signatures (LIVING-SPEC): active by default (all,verbs); configurable via ?living=<flags> or ?living=0.
const livingRaw = params.get('living') ?? 'all,verbs';
const livingTokens = new Set(livingRaw.split(/[,\s]+/).filter(Boolean));
const verbsOn = !livingTokens.has('0') && livingTokens.has('verbs');
let lastPointerType = 'mouse';
document.addEventListener('pointerdown', event => { lastPointerType = event.pointerType || 'mouse'; }, { capture: true, passive: true });
document.addEventListener('pointermove', event => { lastPointerType = event.pointerType || 'mouse'; }, { capture: true, passive: true });

// Lift the CSS entrance gate without a flash: targets start transparent inline.
const entering = [canvas, instrument, ...words, ...document.querySelectorAll('[data-enter], .services li'), motionToggle];
if (!still()) entering.forEach(element => { element.style.opacity = '0'; });
root.classList.add('entered');

// Sentinel: a geodesic perimeter of light around one warm ember; the visitor's cursor is the probe.
const sentinel = createSentinel(canvas, anchor, uniforms, { debug: Math.max(0, debug), readout: debug >= 0, readouts: $('.readouts'), instrument, verbs: { on: verbsOn, spill: livingTokens.has('spill') } });
root.dataset.renderer = sentinel.type;
const model = sentinel.model;
model.state.entered = entered;
const labels = sentinel.labels;
// Device tilt leans the ember on phones and tablets (src/tilt.js); never on the static still. ?tiltsim (test builds only, like
// ?debug) treats a desktop as a touch device and fakes its sensor with a pad (src/tiltsim.js).
const tiltSim = debugHooks && params.has('tiltsim');
const tilt = createTilt(tiltSim ? { matches: true } : undefined);
if (sentinel.type !== 'static') model.state.tilt = tilt;
if (tiltSim) import('./tiltsim.js').then(sim => { window.__tiltsim = sim.mountTiltSim(); });
// The trigger catches the dust: grains condense around "Start a conversation" as the pointer comes near (src/sparkle.js).
const sparkle = createSparkle({ shell: $('.contact-trigger-shell'), trigger, label: $('.contact-trigger > span:first-child'), anchor, rows: $('.services-secondary'),
  verse: verseText, sentinel, frame, cancelFrame, animate, motionValue, cubicBezier });
// The living layer: presence lamp, tap drop, click blink, underline swell, light exits (src/living.js).
const livingFlags = parseLiving(livingRaw);
const living = livingFlags ? createLiving({ flags: livingFlags, scene, anchor, sentinel, gainK: debugHooks ? Number(params.get('livinggain')) || 1 : 1 }) : null;
if (living) root.dataset.living = [...livingFlags].join(' ');
if (debug >= 0 || (debugHooks && (living || verbsOn))) window.__tne = { uniforms, scene: sentinel, model, lose: sentinel.lose, tilt, sparkle: sparkle.debug, living };

const textFeedback = createTextMotion(document.querySelectorAll('.service, .verse-ref, .work-type, .contact-trigger > span:first-child, .contact-heading h2, .email-address, .field label, .success h3, .success p'), {
  canAnimate: () => !still(),
  onActive: (element, active, event, pace) => { rowActive(element, active, event, pace); living?.lineActive(element, active); },
  ownsTouch: element => scene.contains(element),   // src/touch.js drives the scene's touch responses
});
// The wordmark parallaxes opposite the camera, written from the same orbit cascade so the layers move as one rig.
// The visitor light is scoped to the wordmark and the dialog: on :root it forced a document-wide style recalc per frame.
const soft = { stiffness: 95, damping: 23 };
const textLightX = springValue('50%', soft);
const textLightY = springValue('45%', soft);
const nameX = springValue(0, { stiffness: 60, damping: 18, mass: 1.2 });
const nameY = springValue(0, { stiffness: 60, damping: 18, mass: 1.2 });
styleEffect(wordmark, { x: nameX, y: nameY, '--visitor-x': textLightX, '--visitor-y': textLightY });
styleEffect(surface, { '--visitor-x': textLightX, '--visitor-y': textLightY });
styleEffect(verseSurface, { '--visitor-x': textLightX, '--visitor-y': textLightY });
// The verse citation's underline, once drawn, glows where the pointer is along it, brighter the nearer it comes (light only).
const citeGlowX = springValue('52px', soft);   // px along the citation (its glow box reaches 30 px past each end)
const citeGlow = springValue(0, soft);
const verseLightX = springValue('0px', soft), verseLightY = springValue('0px', soft), verseGlow = springValue(0, { stiffness: 110, damping: 24 });
styleEffect(verseText, { '--verse-x': verseLightX, '--verse-y': verseLightY, '--verse-glow': verseGlow });
model.state.onFrame = () => {
  if (still()) { nameX.jump(-model.orbitNorm[0] * 6); nameY.jump(-model.orbitNorm[1] * 3); }
  else { nameX.set(-model.orbitNorm[0] * 6); nameY.set(-model.orbitNorm[1] * 3); }   // the springs smooth the lean (a jump per frame stepped it)
  if (integrityLive) labels.setIntegrity(model.state.integrity, model.state.deficit > 0 || uniforms.u_motion.value === 0);   // every frame while the ledger is open; at once when it is cleared for a still
};
model.state.onGreet = lon => { if (!still()) { ring(lon); boost('u_boostGreet', .15, .6); } };
model.state.onState = word => { if (current?.name !== 'verse' && !restoring) labels.setState(word); };   // the verse holds PURPOSE; a reset holds RESTORING
// The reset, a second after the hand stops (model.js step 5): the ember pulses as the resync front leaves it and the
// instrument declares RESTORING; when the front clears the shell the digits roll once to the released value; at the seal
// the word returns and the ember exhales. Trivial damage (amp 0) is silent. Text changes in place; nothing moves.
model.state.onReset = (phase, value, amp) => {
  if ((phase === 'sealed' || phase === 'abort') && restoring) {
    restoring = false;
    if (!still() && current?.name !== 'verse') labels.setState(model.state.state);
  }
  if (still() || !integrityLive || modalState !== 'closed') return;
  if (phase === 'start' && amp > 0) { restoring = true; labels.setState('RESTORING'); boost('u_boostPress', RESET.ember * amp, .6); }   // the click's own flare
  else if (phase === 'release' && amp > 0) labels.rollIntegrity(value);
  else if (phase === 'sealed' && amp > 0) boost('u_boostGreet', .15, .6);
};
model.state.onTier0 = on => { animate(uniforms, { u_tier0: on ? 1 : 0 }, { duration: on ? .5 : .4, ease }); labels.showTier0(on); };
model.state.onFinding = node => labels.setFindings(node);
// When the loop is idle (paused, reduced motion, modal open) engagement still redraws the composed frame.
engage.on('change', () => {
  if (looping) return;
  if (modalState === 'closed' || Math.abs(engage.get() - lastDrawnEngage) > 0.02) { lastDrawnEngage = engage.get(); sentinel.drawOnce(); }
});

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
function measure() { sentinel.measure(); measureName(); sparkle.measure(); living?.measure(); }
let resizeTimer = 0;
window.addEventListener('resize', () => { measureName(); sentinel.measure(); sparkle.measure(); living?.measure(); textFeedback.refresh(); clearTimeout(resizeTimer); resizeTimer = setTimeout(() => sentinel.resize(), 120); }, { passive: true });
window.addEventListener('scroll', () => sentinel.measure(), { passive: true });
new ResizeObserver(measure).observe(stage);
document.fonts.ready.then(measure);
measureName();

function refreshIntent() {
  const value = clamp(Math.max(pointerIntent, focusIntent, rowIntent));
  if (still()) engage.jump(value); else engage.set(value);
}
function updateAmbient() {
  looping = !still() && !document.hidden && modalState !== 'open';
  model.state.still = still();
  model.state.modal = modalState !== 'closed';
  sentinel.allowSimulation(!still() && modalState === 'closed');
  sentinel.setActive(looping);
  livingPolicy();
  tilt.enable(!still() && !document.hidden && sentinel.type !== 'static');   // off: pause, reduced motion, ?still, hidden tab
  motionToggle.hidden = reducedMotion.matches || sentinel.type === 'static';
  motionToggle.setAttribute('aria-pressed', String(paused));
  $('#motion-icon').setAttribute('d', paused ? 'm7 5 7 5-7 5Z' : 'M7 5v10M13 5v10');
  syncSparkle();
}
function livingPolicy() {
  living?.policy({ run: entered && !still() && !document.hidden && modalState === 'closed' && sentinel.type !== 'static', lines: !still() && !document.hidden, instant: still() || document.hidden });
}
// The dust runs only on the settled, moving, visible page with no panel open (and never on the static still); a still, the pause
// toggle and a hidden tab clear it at once, a panel retires it as its arrival reversed. A panel also holds a hovering pointer's peak.
function syncSparkle() {
  const open = modalState !== 'closed';
  if (open && !hoverHeld) { hoverHeld = true; contactSources.press = contactSources.slide = false; setContactHover(contactSources.hover, 'hover'); }
  sparkle.policy({ run: entered && !still() && !document.hidden && !open && sentinel.type !== 'static', instant: still() || document.hidden });
}
function applyMotionPolicy() {
  uniforms.u_motion.value = still() ? 0 : 1;
  if (still()) {
    labels.hideAll(); stopSentry();
    labels.cancelRoll();
    if (restoring) { restoring = false; if (current?.name !== 'verse') labels.setState(model.state.state); }   // still: the ledger is cleared, so is the word (the verse keeps PURPOSE)
    const t0 = model.state.tier0; if (t0.on) { t0.on = false; t0.since = -1; }
    animate(uniforms, current?.name === 'verse' ? { u_tier0: 0, u_classAmp: 0 } : { u_tier0: 0, u_classAmp: 0, u_tight: 0, u_warm: 0 }, { duration: 0 }).complete();   // the open verse owns warm/tight
    model.rowHover(-1); rowIntent = 0; touch.cancel('still');
    model.verbs?.clear(); verbGates.forEach(clearTimeout); verbGates.clear(); verbLinger.forEach(clearTimeout); verbLinger.clear();
  }
  updateAmbient(); refreshIntent(); resetServiceMotion(); sentinel.drawOnce();
}

// Idle: after four quiet seconds the camera drifts on a slow Lissajous, the lattice breathes in a travelling
// wave and a sentry band crosses the cage every ~9 s. Any input hands control back in one frame.
let idleHeading = 0;   // the idle tween's last target: re-sending it on every input would restart the tween and hold the drift on
function noteActivity() {
  if (!idleArmed) return;
  if (idleHeading !== 0) { idleHeading = 0; idle.set(0); }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!still() && modalState === 'closed') { idleHeading = 1; idle.set(1); } }, 4000);
}
function armIdle() { idleArmed = true; noteActivity(); }
function sentryPass() { animate(uniforms, { u_sentry: [0.001, 1] }, { duration: 2.5, ease: 'linear' }).then(() => animate(uniforms, { u_sentry: 0 }, { duration: 0 })); }
function stopSentry() { clearInterval(sentryTimer); sentryTimer = 0; }
idle.on('change', value => {
  if (value > 0.999 && !sentryTimer && !still() && modalState === 'closed') { sentryPass(); sentryTimer = setInterval(sentryPass, 9000); }
  else if (value < 0.999 && sentryTimer) stopSentry();
});
document.addEventListener('keydown', () => { noteActivity(); living?.activity(); });

// Entrance: the ember ignites alone in the dark, the perimeter builds inward around it behind a noise-perturbed
// front, then the name rises from the centre. The corner instrument decodes last and integrity counts in.
if (still()) {
  for (const [key, value] of Object.entries(settled)) uniforms[key].value = value;
  labels.setIntegrity(.998, true);
} else {
  const sceneIn = () => still() ? (Object.entries(settled).forEach(([k, v]) => { uniforms[k].value = v; }), canvas.style.opacity = '1') : entrance.push(
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
    animate(instrument, { opacity: [0, 1] }, { duration: .3, delay: 2.3 }),
  );
  delay(() => {
    if (still()) return;
    labels.decodeInstrument();
    labels.countIn(.998).then(() => { integrityLive = true; });
  }, 2.3);
  Promise.all(entrance.map(control => control.finished)).then(() => { entered = true; model.state.entered = true; if (model.state.inScene) model.enter(); armIdle(); livingPolicy(); syncSparkle(); });
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
  const lighting = (current?.dialog ?? wordmark).getBoundingClientRect();
  set(textLightX, `${clamp((clientX - lighting.left) / Math.max(1, lighting.width)) * 100}%`);
  set(textLightY, `${clamp((clientY - lighting.top) / Math.max(1, lighting.height)) * 100}%`);
  if (input !== 'keyboard') lightVerse(clientX, clientY, verseNearness(clientX, clientY));
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
  sparkle.pointer(event.clientX, event.clientY, event.pointerType || 'mouse');
  if (hoverHeld) { hoverHeld = false; setContactHover(contactSources.hover, 'hover'); }   // a hover held under a panel counts again once the pointer moves
  living?.pointer(event.clientX, event.clientY, event.pointerType || 'mouse');
  if (event.pointerType === 'touch') { touch.move(event); return; }   // a sliding finger: src/touch.js, then touchPoint (the same feed)
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
  if (event.pointerType) sparkle.pointer(event.clientX, event.clientY, event.pointerType);   // not Motion's keyboard press (a synthetic event at 0, 0)
  living?.down(event.clientX, event.clientY, event.pointerType || 'mouse', event.target, event.pointerId);
  if (event.pointerType === 'touch' && !touch.down(event)) { down = null; return; }   // a second finger: a pinch, never a tap
  const target = event.target.closest('[data-react]');
  setPointerElement(target);
  visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse', target);
  if (still() || !entered || event.target.closest('button, a, input, textarea')) return;
  const [nx, ny] = toNdc(event.clientX, event.clientY);
  down = { x: event.clientX, y: event.clientY, t: event.timeStamp, touch: event.pointerType === 'touch' };   // a click has no animation of its own (owner's call); a touch tap still reads
  model.pointer(nx, ny, event.timeStamp);
}, { passive: true });
scene.addEventListener('pointerup', event => {
  if (event.pointerType === 'touch' && !event.isPrimary) {
    living?.up(event.clientX, event.clientY, 'touch', { tap: false, target: event.target, id: event.pointerId });
    touch.up(event); return;
  }
  const tap = Boolean(down && down.touch && !still() && event.timeStamp - down.t < 250 && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 8);
  const rowTap = tap && (living?.flags.has('drop') || verbsOn) && event.target.closest('.service');
  living?.up(event.clientX, event.clientY, event.pointerType || 'mouse', { tap, target: event.target, id: event.pointerId });
  if (tap && !rowTap) {
    // Tap: a wave from the finger across the cage and the three nearest readings for 1.5 s.
    const [nx, ny] = toNdc(event.clientX, event.clientY);
    const p = model.tap(nx, ny);
    uniforms.u_tapX.value = p[0]; uniforms.u_tapY.value = p[1]; uniforms.u_tapZ.value = p[2];
    animate(uniforms, { u_tapT: [0, 1] }, { duration: .9, ease: [0.16, 1, 0.3, 1] });
  }
  down = null;
  if (event.pointerType === 'touch') { sparkle.leave(); touch.up(event); }   // the hand leaves; a held selection lingers (src/touch.js)
}, { passive: true });
function leaveHand() {
  pointerIntent = 0; setPointerElement(null); refreshIntent(); model.leave();
  if (living?.flags.has('exits')) {   // L0: the promise's blue light and the wordmark light leave with the pointer (their own springs)
    if (still()) { verseGlow.jump(0); textLightX.jump('50%'); textLightY.jump('45%'); } else { verseGlow.set(0); textLightX.set('50%'); textLightY.set('45%'); }
  }
}
function leaveScene(event) {
  if (event?.pointerType === 'touch') {
    if (event.type === 'pointercancel') { sparkle.leave(); living?.cancel(event.pointerId); touch.cancel('cancel', event); }
    return;
  }
  sparkle.leave();
  living?.leave(event?.pointerType || 'mouse');
  leaveHand();
}
scene.addEventListener('pointerleave', leaveScene);
scene.addEventListener('pointercancel', leaveScene);
// iOS asks for the device's orientation once per page load, at the end of the first touch that starts on the cage (tilt.ask
// checks the rest). touchend is the gesture WebKit accepts for requestPermission; nothing is awaited before the call.
let cageTouch = false;
scene.addEventListener('touchstart', event => { cageTouch = event.touches.length === 1 && Boolean(event.target.closest('.mark-anchor')); }, { passive: true });
scene.addEventListener('touchend', event => {
  if (cageTouch && event.touches.length === 0 && entered && !still() && modalState === 'closed' && !event.target.closest('button, a, input, textarea, select, label')) tilt.ask();
  cageTouch = false;
}, { passive: true });
scene.addEventListener('touchcancel', () => { cageTouch = false; }, { passive: true });
// Motion keeps one value per animated uniform; a direct write to .value would be invisible to it, so every
// gesture starts from explicit keyframes (a bare target would animate from Motion's last value, not the peak).
function boost(key, peak, seconds) { animate(uniforms, { [key]: [peak, 0] }, { duration: seconds, ease: [0.2, 0.8, 0.2, 1] }); }
function ring(lon) {
  uniforms.u_ringLon.value = lon;
  animate(uniforms, { u_ringAmp: 1 }, { duration: .15 });
  animate(uniforms, { u_ringPhase: [0, 1] }, { duration: .6, ease: [0.16, 1, 0.3, 1] }).then(() => animate(uniforms, { u_ringAmp: 0 }, { duration: .4 }));
}

// The rows are plain text, but their hover is felt in the scene: a dotted packet runs the meridian above the
// word; a row-1 word lights its asset class and prints its own reading; a row-2 word answers with its cage verb signature.
// The verse is a control, but it answers in light alone: its hairline warms and the ember warms behind it,
// a preview of where the verse panel will come from.
// The promise's blue visitor light: where the pointer is (px in the phrase) and how near it is (0 far .. 1 on the words).
function lightVerse(clientX, clientY, near) {
  const rect = verseText.getBoundingClientRect();
  const instant = still();
  const set = (value, next) => instant ? value.jump(next) : value.set(next);
  set(verseLightX, `${(clientX - rect.left).toFixed(1)}px`); set(verseLightY, `${(clientY - rect.top).toFixed(1)}px`);
  set(verseGlow, near);
}
function verseNearness(clientX, clientY) {
  if (current) return 0;   // a panel is open over it
  const rect = verseText.getBoundingClientRect();
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right), dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
  const t = clamp(1 - Math.hypot(dx, dy) / 70);
  return t * t * (3 - 2 * t);   // smoothstep: it brightens as the pointer approaches, fully on the words
}
function resetVerseFeedback() { if (!verseActive) verseGlow.jump(0); }
function verseHoverChanged(active, pace) {
  verseActive = active;
  if (!still() && entered && (active ? modalState === 'closed' : current?.name !== 'verse')) {
    const control = animate(uniforms, { u_warm: active ? .4 : 0 }, !active && pace === 'snap' ? { duration: .31, ease: easeBack } : { duration: active ? .5 : .8, ease });
    if (active) verseWarmIn = control;
  }
}
let classAmpIn = null, verseWarmIn = null;   // the row-1 and verse entrances: a touch's pull waits for them (src/touch.js)
function rowTheta(element) {
  const rect = element.getBoundingClientRect(), row = element.closest('.services').getBoundingClientRect();
  return clamp((rect.left + rect.width / 2 - (row.left + row.width / 2)) / Math.max(1, row.width / 2), -1, 1);
}
function rowLon(element) { return rowTheta(element) * 1.15; }
// Living verbs: a row-2 word's signature starts after 250 ms continuously on it (a sweep shows packets only); a touch
// starts it at once. Leaving plays the entrance backwards; moving straight to another word snaps the old one (x1.6).
const verbGates = new Map(), verbLinger = new Map(), verbBorn = new Map();
function rowTwo(element, active, theta, pace) {
  const verbs = model.verbs, name = element.dataset.verb;
  if (!verbs || !name) return;
  const isTouch = lastPointerType === 'touch' || lastPointerType === 'pen';
  if (active) {
    rowIntent = .5; refreshIntent();
    verbs.snapExiting();
    clearTimeout(verbLinger.get(name)); verbLinger.delete(name);
    const go = () => { verbGates.delete(name); if (livingTokens.has('g0')) return; const s = verbs.enter(name, { theta, forward: model.cam.forward, legs: livingTokens.has('tp3') ? 3 : 2 }); verbBorn.set(name, performance.now() - (s?.tau || 0)); };
    clearTimeout(verbGates.get(name));
    if (isTouch) go(); else verbGates.set(name, setTimeout(go, 250));
  } else {
    rowIntent = 0; refreshIntent();
    if (verbGates.has(name)) { clearTimeout(verbGates.get(name)); verbGates.delete(name); return; }
    verbs.exit(name, pace === 'snap' ? 1.6 : 1);
  }
}
function rowActive(element, active, event, pace) {
  if (!element.matches('.service')) return;
  if (verbsOn && element.dataset.row === '2' && !active && still()) { model.verbs?.clear(); rowIntent = 0; refreshIntent(); sentinel.drawOnce(); return; }
  if (!active && still()) {   // always tear down; while still, set now and redraw instead of tweening
    animate(uniforms, element.dataset.row === '1' ? { u_classAmp: 0 } : { u_tight: 0, u_warm: 0 }, { duration: 0 }).complete();
    if (element.dataset.row === '1') { model.rowHover(-1); rowIntent = 0; refreshIntent(); }
    sentinel.drawOnce(); return;
  }
  if (still() || !entered) return;
  // Map the word's position across its row to ±66° of longitude: outer words run the limb meridians, inner words the front.
  const theta = rowTheta(element), lon = theta * 1.15;
  const snap = !active && pace === 'snap';           // a touch letting go: the entrance reversed, 0.625x as long
  if (active) ring(lon);
  if (element.dataset.row === '1') {
    const c = CLASS[element.dataset.class];
    if (active) { uniforms.u_classSel.value = c; classAmpIn = animate(uniforms, { u_classAmp: 1 }, { duration: .2 }); model.rowHover(c, lon, ROW_READING[c]); rowIntent = .5; }
    else { animate(uniforms, { u_classAmp: 0 }, { duration: snap ? .125 : .4 }); model.rowHover(-1); rowIntent = 0; }
    refreshIntent();
  } else if (verbsOn) {
    rowTwo(element, active, theta, pace);
  } else if (current?.name !== 'verse') {             // the open verse owns u_warm/u_tight; its closeScenery returns them to 0
    animate(uniforms, { u_tight: active ? 1 : 0, u_warm: active ? 1 : 0 }, snap ? { duration: .19, ease: easeBack } : { duration: active ? .3 : .8, ease });
  }
}

const inDialog = element => [dialog, verseDialog].some(d => d.contains(element));
document.addEventListener('focusin', event => {
  if (!scene.contains(event.target) && !inDialog(event.target)) return;
  const target = event.target.closest('[data-react]');
  focusIntent = inDialog(event.target) ? .9 : targetIntent(target);
  const rect = event.target.getBoundingClientRect();
  visitPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 'keyboard', target);
  if (!inDialog(event.target)) living?.focus(rect, event.target.matches(':focus-visible'));
  if (!inDialog(event.target) && !still()) {
    const [nx, ny] = toNdc(rect.left + rect.width / 2, rect.top + rect.height / 2);
    model.state.keyboard = true; model.pointer(nx, ny, performance.now() - 1000);
  }
  refreshIntent();
});
document.addEventListener('focusout', () => queueMicrotask(() => {
  const active = document.activeElement;
  if (!scene.contains(active) || inDialog(active)) living?.blur();
  if (!scene.contains(active) && !inDialog(active)) { focusIntent = 0; refreshIntent(); if (model.state.keyboard) { model.state.keyboard = false; model.leave(); } }
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
  resetContactFeedback(); resetVerseFeedback();
  applyMotionPolicy();
});
document.addEventListener('visibilitychange', updateAmbient);

let contactHover = [];
function setImmediateMotion(element, values) {
  const control = animate(element, values, { duration: 0 });
  control.complete();
  return control;
}
// One arrow drawer for both buttons (the send button's pattern, now also the trigger's): on hover or focus-visible the arrow draws itself
// in beside the centred label with a short glide; leaving retracts it the way it came (the stroke first, then the glide back); still:
// at once. The arrow is absolute and hangs off the label's right edge, so the label never moves.
function arrowDrawer(svg) {
  const path = svg.querySelector('path');
  let on = false, anims = [];
  function set(next, instant) {
    anims.forEach(control => control.stop());
    if (instant) { anims = [setImmediateMotion(svg, { opacity: next ? 1 : 0, x: 0 }), setImmediateMotion(path, { pathLength: next ? 1 : 0 })]; return; }
    const draw = [0.22, 1, 0.36, 1], undraw = [0.64, 0, 0.78, 0];
    anims = next ? [
      animate(svg, { opacity: 1 }, { duration: .16, ease: 'easeOut' }),
      animate(svg, { x: [-8, 0] }, { type: 'spring', stiffness: 260, damping: 24 }),
      animate(path, { pathLength: [0, 1] }, { duration: .42, ease: draw }),
    ] : [
      animate(path, { pathLength: 0 }, { duration: .28, ease: undraw }),
      animate(svg, { x: -8 }, { duration: .3, ease: undraw }),
      animate(svg, { opacity: 0 }, { duration: .18, delay: .14, ease: 'easeIn' }),
    ];
  }
  setImmediateMotion(path, { pathLength: 0 });   // hidden at load (CSS opacity 0)
  return {
    show(next) { if (next === on) return; on = next; set(next, still()); },
    reset() { set(on, true); },                  // pause / reduced motion: the current state, at once
  };
}
const contactArrowSvg = $('.contact-arrow');
const contactArrow = arrowDrawer(contactArrowSvg);
// The trigger's peak: mouse/pen hover, focus-visible, a press (touch included) or a finger sliding onto it (source 'slide'). It drives
// the arrow and the strand; the underline keeps its own drivers below, exactly as before.
function setContactHover(on, source = 'slide') {
  contactSources[source] = Boolean(on);
  const s = contactSources, pointer = (s.hover && !hoverHeld) || s.press || s.slide, active = pointer || s.focus;
  contactArrow.show(active);
  sparkle.hover(active, active && !pointer);
}
function resetContactFeedback() {
  contactHover.forEach(control => control.stop());
  const scale = document.activeElement === trigger ? 1 : .3;
  contactHover = [setImmediateMotion($('.contact-rule'), { scaleX: scale }), sparkle.rule(scale)];
  contactArrow.reset();
}
const ruleSpring = { type: 'spring', stiffness: 220, damping: 27 };
const snapSpring = { type: 'spring', stiffness: 380, damping: 30 };
function highlightContact(active, { pace = null } = {}) {
  contactHover.forEach(control => control.stop()); contactHover = [];
  if (still()) {
    contactHover.push(setImmediateMotion($('.contact-rule'), { scaleX: active ? 1 : .3 }), sparkle.rule(active ? 1 : .3));
    return;
  }
  const spring = pace === 'snap' ? snapSpring : ruleSpring;
  contactHover.push(
    animate($('.contact-rule'), { scaleX: active ? 1 : .3 }, spring),
    sparkle.rule(active ? 1 : .3, spring),   // the strand's copy of the line: the same call and spring, so its end sparks ride the live ends
  );
}
hover(trigger, () => { highlightContact(true); setContactHover(true, 'hover'); return () => { highlightContact(false); setContactHover(false, 'hover'); }; });
trigger.addEventListener('focus', () => { highlightContact(true); setContactHover(trigger.matches(':focus-visible'), 'focus'); });
trigger.addEventListener('blur', () => { highlightContact(false); contactSources.press = false; setContactHover(false, 'focus'); });
trigger.addEventListener('keydown', event => { if (event.key === ' ' && !event.repeat) sparkle.press(null); });   // Enter arrives through press() below
// Form messages arrive and leave as light, never as a jump: each field's error slot is reserved (CSS), a new message
// fades and sharpens in, a cleared or replaced one fades out in place over its slot. The form code writes the text;
// these observers only animate it.
function softenMessages(element) {
  let shown = element.textContent;
  new MutationObserver(() => {
    const text = element.textContent;
    if (text === shown) return;
    const previous = shown; shown = text;
    if (previous && !still()) {   // the leaving message, as a ghost over the same slot
      const ghost = document.createElement(element.tagName === 'P' ? 'p' : 'span');   // a fresh node (no copied attributes)
      ghost.className = `${element.className} error-ghost`; ghost.setAttribute('aria-hidden', 'true'); ghost.textContent = previous;
      ghost.style.left = `${element.offsetLeft}px`; ghost.style.top = `${element.offsetTop}px`; ghost.style.width = `${element.offsetWidth}px`;
      element.after(ghost);
      animate(ghost, { opacity: [1, 0], filter: ['blur(0px)', 'blur(2px)'] }, { duration: .4, ease: [0.4, 0, 1, 1] }).then(() => ghost.remove());
    }
    if (!text) return;
    if (still()) { setImmediateMotion(element, { opacity: 1, filter: 'blur(0px)' }); return; }
    animate(element, { opacity: [0, 1], filter: ['blur(3px)', 'blur(0px)'] }, { duration: .5, delay: previous ? .12 : 0, ease: [0.22, 1, 0.36, 1] });
  }).observe(element, { childList: true, characterData: true, subtree: true });
}
document.querySelectorAll('.field-error, #form-status').forEach(softenMessages);
// Tactile press without moving text: the arrows answer, the labels stay put.
const pressSpring = { type: 'spring', stiffness: 400, damping: 30 };
// The trigger's press is the send button's (the arrow drawn and pushed forward) plus a light along the strand from the press
// (keyboard: from the label's centre). A press that ends off the button gives the peak back; a click opens the panel (blur clears it).
press(trigger, (element, event) => {
  setContactHover(true, 'press');
  sparkle.press(event.pointerType ? event.clientX : null);
  if (!still()) animate(contactArrowSvg, { x: 6 }, pressSpring);
  return (end, info) => {
    if (!info?.success) setContactHover(false, 'press');
    if (!still()) animate(contactArrowSvg, { x: 0 }, pressSpring);
  };
});
// The send button rests as a centred label. On hover or focus its arrow draws itself in beside the label with a short
// glide; a press pushes it forward; leaving retracts it the way it came (the stroke first, then the glide back).
const sendArrow = $('.send-arrow');
const sendArrowDrawer = arrowDrawer(sendArrow);
hover(sendButton, () => { sendArrowDrawer.show(true); return () => { if (document.activeElement !== sendButton || !sendButton.matches(':focus-visible')) sendArrowDrawer.show(false); }; });
sendButton.addEventListener('focus', () => { if (sendButton.matches(':focus-visible')) sendArrowDrawer.show(true); });
sendButton.addEventListener('blur', () => sendArrowDrawer.show(false));
press(sendButton, () => {
  sendArrowDrawer.show(true);
  if (still()) return;
  animate(sendArrow, { x: 6 }, pressSpring);
  return () => animate(sendArrow, { x: 0 }, pressSpring);
});
hover(verseButton, () => { verseHoverChanged(true); return () => verseHoverChanged(false); });   // the ember warms behind it, as before
verseButton.addEventListener('focus', () => { const r = verseText.getBoundingClientRect(); lightVerse(r.left + r.width / 2, r.top + r.height / 2, 1); });
verseButton.addEventListener('blur', () => { if (!verseActive) verseGlow.set(0); });

// Touch (src/touch.js): a sliding finger hovers as a mouse does, and a finger that lands on a row word, the conversation line, the
// verse or the tagline holds it. motion's hover() ignores touch, so the module calls the same responses a mouse hover gets.
const contactLabel = trigger.querySelector('span');
let contactLabelLit = false;
function lightContactLabel(on, pace = null, origin = null) {
  if (on === contactLabelLit) return;
  contactLabelLit = on; textFeedback.slide(contactLabel, on, { origin, pace });
}
const pullTokens = new WeakMap();   // a pull is written to the scene only once its element's entrance tween has finished
function awaitEntrance(el, before, control) {
  const token = {}; pullTokens.set(el, token);
  if (control && control !== before) { token.waiting = true; control.then(() => { if (pullTokens.get(el) === token) { token.waiting = false; touch.repull(el); } }); }
}
const pullReady = el => !still() && entered && pullTokens.get(el)?.waiting === false;
const textKind = (match, steal, extra = {}) => ({
  match, steal, radius: [72, 56, 96],
  enter(el, how, origin) { textFeedback.slide(el, true, { origin }); },
  leave(el, how) { textFeedback.slide(el, false, { pace: how }); },
  ...extra,
});
const touch = createTouchSelect({
  scene, cage: anchor, still,
  kinds: [
    textKind('.service', true, {
      enter(el, how, origin) { const before = classAmpIn; textFeedback.slide(el, true, { origin }); awaitEntrance(el, before, el.dataset.row === '1' ? classAmpIn : null); },
      pull(el, P) { if (el.dataset.row === '1' && pullReady(el)) setImmediateMotion(uniforms, { u_classAmp: 1 + .35 * P }); },   // its class brightens under tension
    }),
    { match: '#open-contact', steal: true, radius: [80, 64, 104],
      enter(el, how, origin, x, y) {
        highlightContact(true); setContactHover(true, 'slide');
        if (how === 'hover') this.track(el, x, y); else lightContactLabel(true, null, origin);
      },
      track(el, x, y) { const r = contactLabel.getBoundingClientRect(); lightContactLabel(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom, null, x < r.left + r.width / 2 ? '0% 50%' : '100% 50%'); },   // the label's own box, as a mouse
      leave(el, how) { highlightContact(false, { pace: how }); setContactHover(false, 'slide'); lightContactLabel(false, how); },
    },
    { match: '#open-verse', steal: true, radius: [72, 56, 96],
      enter(el) { const before = verseWarmIn; verseHoverChanged(true); awaitEntrance(el, before, verseWarmIn); },
      leave(el, how) { verseHoverChanged(false, how); },
      pull(el, P) { if (pullReady(el) && modalState === 'closed') setImmediateMotion(uniforms, { u_warm: .4 + .15 * P }); },   // the ember reaches
    },
    textKind('.work-type', false),   // the tagline can be held but never takes a hold: it lies between the rows and the cage
  ],
  hand: {
    point: touchPoint,
    leave: leaveHand,
    reassert(el) {   // after a held lift: model.leave() cleared the row's reading; the selection keeps it while it lingers
      if (el.matches('.service[data-row="1"]') && !still() && entered) { const c = CLASS[el.dataset.class]; model.rowHover(c, rowLon(el), ROW_READING[c]); }
      const engaged = el.closest('[data-react]');
      setPointerElement(engaged); pointerIntent = engaged ? targetIntent(engaged) : 0; refreshIntent();
    },
    release() { setPointerElement(null); pointerIntent = 0; refreshIntent(); },
  },
});
if (window.__tne) window.__tne.touch = touch;
// A touch move feeds the scene exactly as the mouse path does; a held verse leans its blue light toward the finger instead.
function touchPoint(event, engaged, holding, feed) {
  setPointerElement(engaged);
  visitPoint(event.clientX, event.clientY, 'touch', engaged);
  if (holding?.el === verseButton && !current) {
    const r = verseText.getBoundingClientRect(), nx = clamp(event.clientX, r.left, r.right), ny = clamp(event.clientY, r.top, r.bottom);
    const dx = event.clientX - nx, dy = event.clientY - ny, l = Math.hypot(dx, dy), lean = l > 0 ? 22 * holding.P / l : 0;
    lightVerse(nx + dx * lean, ny + dy * lean, 1);
  }
  if (!feed || still()) return;
  const [nx, ny] = toNdc(event.clientX, event.clientY);
  model.state.keyboard = false;
  model.pointer(nx, ny, event.timeStamp);
  if (model.simulate) sentinel.fluidPointer(event.clientX / innerWidth, 1 - event.clientY / innerHeight, event.timeStamp);
}

function resetServiceMotion() {
  if (still()) textFeedback.reset(); else textFeedback.refresh();
}

// Dialogs: one controller, one modal at a time, the same glass, spring, trap and close.
// "Authorize" (contact): the perimeter takes a breath, the ember rises, the lattice dims and the camera draws back.
// "Purpose" (verse): the ember warms and the perimeter holds still to listen; the verse arrives as light reading
// across the words, and no glyph ever moves. Both panels spring from the ember's screen position.
function stopModalAnimations() { modalAnimations.forEach(control => control.stop()); modalAnimations = []; }
function coreTransform(d = dialogs.contact) {
  const from = anchor.getBoundingClientRect(); const to = d.dialog.getBoundingClientRect();
  return `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px) scale(.5)`;
}
function setScenery(values) {
  animate(uniforms, Object.fromEntries(Object.entries(values).map(([key, value]) => [key, [value, value]])), { duration: 0 }).complete();   // keep Motion's own values in step with the still
  for (const [key, value] of Object.entries(values)) uniforms[key].value = value;
  sentinel.drawOnce();
}
function focusContact() {
  if (!success.hidden) success.focus({ preventScroll: true });
  else if (submitting) $('#close-contact').focus({ preventScroll: true });
  else $('#contact-title').focus({ preventScroll: true });   // the panel, not a field: no caret or phone keyboard until the visitor picks a field; Tab goes on to the name
}

// The verse: words take the light in reading order, arriving warm and cooling to their resting colour (CSS owns
// it: silver, or the promise's blue for "hope and a future", which therefore stays lit), then the citation.
// Scene still => no decorative text light; the structural panel transition still plays.
const verseBody = $('#verse-body');
const verseWords = wrapWords(verseBody.querySelector('p'));
const verseFinal = new Map(verseWords.map(word => [word, getComputedStyle(word).color]));
const verseRef = $('.verse-ref');
styleEffect(verseRef, { '--glow-x': citeGlowX, '--glow': citeGlow });
let verseFlash = null, verseLined = false;   // verseLined: the underline is drawn (from its entrance until the panel has closed)
function lightCitation(clientX, clientY) {
  if (!verseLined || still()) { citeGlow.jump(0); return; }
  const rect = verseRef.getBoundingClientRect(), y = rect.bottom - 3.5;   // the underline sits 3 px above the citation's bottom
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right), dy = Math.abs(clientY - y);
  const t = clamp(1 - Math.hypot(dx, dy) / 120);
  citeGlowX.set(`${(clamp((clientX - rect.left) / Math.max(1, rect.width)) * rect.width).toFixed(1)}px`);
  citeGlow.set(t * t * (3 - 2 * t));   // smoothstep: it brightens as the pointer approaches, fully on the line
  living?.citationNear(verseRef, t * t * (3 - 2 * t), clientX);
}
function dimCitation() { citeGlow.set(0); living?.citationNear(verseRef, 0, 0); }
function settleVerse() {
  setImmediateMotion([...verseWords, verseRef], { opacity: 1 });
  textFeedback.pin(verseRef, true); verseLined = true;   // the citation's underline, already in place
  verseWords.forEach(word => setImmediateMotion(word, { color: verseFinal.get(word) }));
}
function revealVerse(live) {
  if (!live) { settleVerse(); return; }
  const first = .7, step = .024, last = first + (verseWords.length - 1) * step;   // words start once the panel has landed (>= 99 %)
  setImmediateMotion([verseRef, ...verseWords], { opacity: 0 });
  textFeedback.pin(verseRef, false); verseLined = false; citeGlow.jump(0);   // it draws in afresh with the reference
  verseWords.forEach((word, i) => modalAnimations.push(animate(word, { opacity: [0, 1], color: [word.closest('.verse-key') ? '#DCEFFF' : '#FFEBD0', verseFinal.get(word)] }, {
    delay: first + i * step, ease: 'easeOut', opacity: { duration: .35 }, color: { duration: .7 },
  })));
  // the reference arrives after the last word and answers with the bullets' own response: a warm letter wave and the underline
  modalAnimations.push(animate(verseRef, { opacity: [0, 1] }, { delay: last + .03, duration: .9, ease: [0.37, 0, 0.63, 1] }));   // the citation arrives softly
  verseFlash?.(); verseFlash = delay(() => { verseFlash = null; if (current?.name === 'verse' && modalState !== 'closing') { textFeedback.flash(verseRef, 2200, { soft: { in: 1.0, out: 1.8, spread: .45 }, keepLine: true }); verseLined = true; living?.citationDrawn(verseRef); } }, last + .35);   // the underline draws out from the centre and stays
}
function concealVerse() {
  verseFlash?.(); verseFlash = null;
  modalAnimations.push(animate([...verseWords, verseRef], { opacity: 0 }, { duration: .12 }));
}

const dialogs = {
  contact: {
    name: 'contact', dialog, surface, closeButton: $('#close-contact'), origin: trigger, initial: null,
    items: () => dialog.querySelectorAll('.dialog-item'), focus: focusContact, sceneOpacity: .22, veilOpacity: .38,   // a lighter veil: the scene reads through the glass panel
    scenery: () => [
      animate(uniforms, { u_open: 1 }, { duration: .5, ease }),
      animate(uniforms, { u_dolly: 1 }, { duration: .7, ease }),
      animate(uniforms, { u_dim: 1 }, { duration: .5, ease }),
      animate(uniforms, { u_ca: [.4, 0] }, { duration: .7 }),
    ],
    closeScenery: () => animate(uniforms, { u_open: 0, u_dolly: 0, u_dim: 0 }, { duration: .6, ease }),
    stillOpen: { u_dolly: 1, u_dim: 1, u_open: 1 }, stillClosed: { u_dolly: 0, u_dim: 0, u_open: 0 },
    onOpen() { prepareTurnstile($('#contact-turnstile')); }, reveal: null, settle: null, conceal: null,   // the bot check loads with the panel, never with the page
    afterClose() {
      if (still()) return;
      const s = model.state;
      if (s.deficit > 0) {                                   // the ledger is open: no "all clear" blink; the word and the reading catch up
        if (!restoring && s.resetting && s.resetAmp > 0) { restoring = true; labels.setState('RESTORING'); }
        labels.rollIntegrity(s.integrity);
      } else { integrityLive = false; labels.blinkIntegrity(.9, .998).then(() => { integrityLive = true; }); }
    },
  },
  verse: {
    name: 'verse', dialog: verseDialog, surface: verseSurface, closeButton: $('#close-verse'), origin: verseButton, initial: verseBody,
    items: () => [], focus: () => verseBody.focus({ preventScroll: true }), sceneOpacity: .3, veilOpacity: .42,
    scenery: () => [                                   // no chromatic aberration: the verse is not a security event
      animate(uniforms, { u_warm: 1 }, { duration: .6, ease }),
      animate(uniforms, { u_tight: 1 }, { duration: .8, ease }),
      animate(uniforms, { u_open: .5 }, { duration: .5, ease }),
      animate(uniforms, { u_dolly: .3 }, { duration: .7, ease }),
      animate(uniforms, { u_dim: 1 }, { duration: .5, ease }),
    ],
    closeScenery: () => animate(uniforms, { u_open: 0, u_dolly: 0, u_dim: 0, u_warm: 0, u_tight: 0 }, { duration: .6, ease }),
    stillOpen: { u_open: .5, u_dolly: .3, u_dim: 1, u_warm: 1, u_tight: 1 }, stillClosed: { u_open: 0, u_dolly: 0, u_dim: 0, u_warm: 0, u_tight: 0 },
    onOpen() { if (!still()) { this.purpose = true; labels.setState('PURPOSE'); boost('u_boostGreet', .3, .9); } },   // the ember exhales as the panel leaves it
    reveal: revealVerse, settle: settleVerse, conceal: concealVerse,
    afterClose() {
      textFeedback.pin(verseRef, false); verseLined = false; citeGlow.jump(0); living?.citationOff(verseRef);   // hidden now; the next opening draws it in again
      if (this.purpose) {                                    // a reset that ran behind the verse keeps its word
        this.purpose = false;
        const s = model.state;
        restoring = restoring || (!still() && s.resetting && s.resetAmp > 0);
        labels.setState(restoring ? 'RESTORING' : s.state);
      }
      if (!still() && entered && verseActive) animate(uniforms, { u_warm: .4 }, { duration: .5, ease });   // focus is back on the verse: its light holds
    },
  },
};
function openDialog(d, origin = d.origin) {
  if (modalState === 'open' || modalState === 'opening') return;
  if (current && current !== d) return;
  const wasClosed = !d.dialog.open; const serial = ++modalSerial;
  stopModalAnimations();
  if (wasClosed) { returnFocus = origin; d.dialog.showModal(); d.openedAt = performance.now(); }
  current = d;
  modalState = 'opening'; idle.jump(0); clearTimeout(idleTimer); stopSentry(); labels.hideAll(); touch.cancel('modal');
  d.surface.scrollTop = 0; d.focus(); updateAmbient(); d.onOpen();
  if (reducedMotion.matches) {
    d.surface.style.transform = 'none'; d.surface.style.opacity = '1';
    d.items().forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
    d.settle?.();
    scene.style.opacity = String(d.sceneOpacity); veil.style.opacity = String(d.veilOpacity); setScenery(d.stillOpen);
    modalState = 'open'; updateAmbient(); return;
  }
  const scenery = paused ? (setScenery(d.stillOpen), []) : d.scenery();
  const panel = animate(d.surface, { transform: wasClosed ? [coreTransform(d), 'translate(0px, 0px) scale(1)'] : 'translate(0px, 0px) scale(1)' }, { type: 'spring', visualDuration: .6, bounce: .05 });
  modalAnimations.push(panel, ...scenery,
    animate(d.surface, { opacity: wasClosed ? [0, 1] : 1 }, { duration: .3, ease }),
    animate(veil, { opacity: d.veilOpacity }, { duration: .35 }),
    animate(scene, { opacity: d.sceneOpacity }, { duration: .35, ease }),
  );
  const items = d.items();
  if (items.length) modalAnimations.push(animate(items, { opacity: [0, 1], y: [9, 0] }, { duration: .36, ease, delay: stagger(.035, { startDelay: .18 }) }));
  d.reveal?.(!still());
  Promise.all([panel, ...scenery].map(control => control.finished)).then(() => {
    if (serial !== modalSerial) return;
    modalState = 'open'; updateAmbient();
  });
}
function finishClose(d, serial) {
  if (serial !== modalSerial) return;
  d.dialog.close(); modalState = 'closed'; current = null;
  scene.style.opacity = '1'; veil.style.opacity = '0';
  if (still()) setScenery(d.stillClosed);
  updateAmbient(); noteActivity(); (returnFocus?.isConnected ? returnFocus : d.origin).focus({ preventScroll: true });
  d.afterClose();
}
function closeDialog(d) {
  if (!d.dialog.open || modalState === 'closing') return;
  const serial = ++modalSerial; stopModalAnimations(); modalState = 'closing'; updateAmbient();
  if (reducedMotion.matches) { finishClose(d, serial); return; }
  d.conceal?.();
  const panel = animate(d.surface, { transform: coreTransform(d), opacity: 0 }, { duration: .28, ease: [0.4, 0, 0.2, 1] });
  const items = d.items();
  modalAnimations.push(panel,
    ...(items.length ? [animate(items, { opacity: 0 }, { duration: .12 })] : []),
    animate(veil, { opacity: 0 }, { duration: .28 }),
    animate(scene, { opacity: 1 }, { duration: .28, ease }),
  );
  if (!paused) modalAnimations.push(d.closeScenery());
  panel.finished.then(() => finishClose(d, serial));
}
function openContact(origin = trigger) { openDialog(dialogs.contact, origin); }
function closeContact() { closeDialog(dialogs.contact); }
function wireDialog(d) {
  d.closeButton.addEventListener('click', () => closeDialog(d));
  d.dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(d); });
  d.dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || !d.dialog.open) return;
    const controls = [...d.dialog.querySelectorAll('button, input, textarea, select, a[href], [tabindex]')]
      .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && !el.closest('[inert]'));
    const first = controls[0]; const last = controls.at(-1);
    if (!first) return;
    const stray = document.activeElement === d.initial;   // the verse body holds focus for reading; Tab goes to the controls
    const widget = d.dialog.querySelector('.turnstile');   // a visible bot check lives in a frame the list cannot see: Tab may enter it
    if (!event.shiftKey && widget?.offsetHeight && (widget.compareDocumentPosition(document.activeElement) & Node.DOCUMENT_POSITION_PRECEDING)) return;
    if (event.shiftKey && (document.activeElement === first || !d.dialog.contains(document.activeElement) || stray)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !d.dialog.contains(document.activeElement) || stray)) {
      event.preventDefault(); first.focus();
    }
  });
  let backdropDown = false;
  const outsidePanel = event => { const rect = d.dialog.getBoundingClientRect(); return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom; };
  d.dialog.addEventListener('pointerdown', event => { backdropDown = event.target === d.dialog && outsidePanel(event) && !(d.name === 'verse' && event.timeStamp - d.openedAt < 500); });   // the verse line lies outside its panel: a double-click is not a dismissal
  d.dialog.addEventListener('pointerup', event => { if (backdropDown && event.target === d.dialog && outsidePanel(event)) closeDialog(d); backdropDown = false; });
  d.dialog.addEventListener('pointermove', event => {
    if (d.dialog.open) visitPoint(event.clientX, event.clientY, event.pointerType || 'mouse');
    if (d.name === 'verse' && d.dialog.open) lightCitation(event.clientX, event.clientY);
  }, { passive: true });
  if (d.name === 'verse') {   // the glow goes when the pointer leaves the window or a finger lifts
    d.dialog.addEventListener('pointerout', event => { if (!event.relatedTarget) dimCitation(); }, { passive: true });
    d.dialog.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') dimCitation(); }, { passive: true });
  }
}
Object.values(dialogs).forEach(wireDialog);
trigger.addEventListener('click', () => openContact(trigger));
verseButton.addEventListener('click', () => openDialog(dialogs.verse));

reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    entrance.forEach(control => control.complete()); successAnimations.forEach(control => control.complete());
    contactHover.forEach(control => control.stop()); idle.jump(0); clearTimeout(idleTimer); stopSentry();
    resetContactFeedback(); resetVerseFeedback(); integrityLive = true;
    const state = modalState; const serial = ++modalSerial; stopModalAnimations();
    if (state === 'closing' && current) finishClose(current, serial);
    else if (current?.dialog.open) {
      const d = current;
      d.surface.style.transform = 'none'; d.surface.style.opacity = '1';
      d.items().forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; });
      d.settle?.();
      scene.style.opacity = String(d.sceneOpacity); veil.style.opacity = String(d.veilOpacity); setScenery(d.stillOpen); modalState = 'open';
    }
    entered = true; model.state.entered = true;
  } else armIdle();
  applyMotionPolicy();
});
verseButton.disabled = false;

const fields = ['name', 'email', 'message'].map(name => form.elements.namedItem(name));
function validate(field) {
  const value = field.value.trim(); let message = '';
  if (!value) message = field.name === 'message' ? 'Please tell us a little about your enquiry.' : `Please enter your ${field.name === 'email' ? 'email address' : 'name'}.`;
  else if (field.name === 'name' && /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>\\]/u.test(value)) message = 'Please remove quotes, angle brackets or hidden characters from your name.';
  else if (field.name === 'email' && (field.validity.typeMismatch || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/.test(value))) message = 'Please enter a valid email address.';
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
  const payload = { name: fields[0].value.trim(), email: fields[1].value.trim(), message: fields[2].value.trim(), hp_ref: form.elements.hp_ref.value, requestId };
  submitting = true; fieldset.disabled = true; textFeedback.setText(buttonLabel, 'Sending…'); status.textContent = ''; status.classList.remove('is-error'); form.setAttribute('aria-busy', 'true');
  try {
    if (turnstileEnabled) payload.turnstile = await turnstileToken();
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
