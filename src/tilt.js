import { TILT, LAG } from './scene/constants.js';
import { frameRatio, damp, smoothstep } from './scene/damp.js';

// Device tilt: on phones and tablets the ember leans downhill as the device tilts, through the pointer's own lean (model.js
// step 3 feeds the target to the same two cascades, clamp and camera). The deviceorientation reading becomes the gravity
// ("down") vector in the device frame, so representation flips near upright never matter and alpha (turning round) is
// ignored. A neutral follows how the device is held; the tilt from it along the screen's axes gives the target in shell units
// (+x right, +y up). The handler only stores two numbers; step() allocates nothing. Never activity: no idle, readouts or hand.
// createTilt(coarse?): { enable(on), ask(), step(dtMs) -> [x, y] | null }. `coarse` is only replaced by ?tiltsim (test builds).
const D = Math.PI / 180;
const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const angle = (p, q) => Math.acos(Math.min(1, dot(p, q))) / D;   // unit vectors, degrees
const unit = (v) => { const l = Math.sqrt(dot(v, v)) || 1; v[0] /= l; v[1] /= l; v[2] /= l; };
// screen.orientation.angle (window.orientation before iOS 16.4), as 0, 90, 180 or 270
const screenAngle = () => (((Math.round((screen.orientation?.angle ?? window.orientation) / 90) % 4) + 4) % 4) * 90 || 0;

export function createTilt(coarse = matchMedia('(pointer: coarse)')) {
  const T = TILT, ios = typeof window.DeviceOrientationEvent?.requestPermission === 'function';
  let wanted = false, attached = false, granted = !ios, asked = false, beta = 0, gamma = 0, firstAt = -1, readings = 0;
  let seeded = false, lastAt = -1, lastAngle = -1, stillFor = 0, repose = false, easeFrom = 0, gain = 0;
  const d = [0, 0, -1], f = [0, 0, -1], p = [0, 0, -1], b = [0, 0, -1], out = [0, 0];   // reading, filtered (and last), neutral; target
  const onReading = (e) => {
    if (!Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
    beta = e.beta; gamma = e.gamma; readings++;
    if (firstAt < 0) firstAt = performance.now();
  };
  function sync() {
    const on = T.on && wanted && granted && coarse.matches;   // T.on false: inert, no listener ever
    if (on === attached) return;
    attached = on;
    if (on) addEventListener('deviceorientation', onReading);
    else { removeEventListener('deviceorientation', onReading); firstAt = -1; seeded = false; out[0] = out[1] = 0; }
  }
  function step(dtMs) {
    if (!(dtMs > 0)) return attached ? out : null;             // a redraw without time (drawOnce): no state change
    if (!attached || firstAt < 0 || !coarse.matches) { seeded = false; return null; }
    const now = performance.now(), a = screenAngle(), dt = Math.min(dtMs, 100) / 1000, cb = Math.cos(beta * D);
    d[0] = Math.sin(gamma * D) * cb; d[1] = -Math.sin(beta * D); d[2] = -Math.cos(gamma * D) * cb;   // -(row 2 of Rz Rx Ry)
    // Reseed (target 0, the lean cascades untouched, so nothing jumps): the first step, the warm-up (some sensors open with a
    // flat 0, 0, 0), a stopped loop (hidden tab, open panel, pause, a stall) and a rotation. Each one restarts the ease-in gain.
    if (!seeded || now - firstAt < T.warm || now - lastAt > T.gap || a !== lastAngle) {
      for (let i = 0; i < 3; i++) f[i] = b[i] = d[i];
      stillFor = 0; repose = false; seeded = true; easeFrom = now;
    }
    lastAt = now; lastAngle = a; gain = smoothstep(0, T.ease * 1000, now - easeFrom);   // tilt eases in, never switches on
    // the pointer filter's lerp, then the neutral: re-pose (fast), settled (still for `settle` s) or moving (creeps)
    const k = damp(LAG.pointer, frameRatio(dtMs));
    for (let i = 0; i < 3; i++) { p[i] = f[i]; f[i] += (d[i] - f[i]) * k; }
    unit(f);
    stillFor = angle(p, f) / dt < T.still ? stillFor + dt : 0;
    const dv = angle(b, f);
    if (dv > T.repose) repose = true; else if (dv < T.reposeOut) repose = false;
    const kb = 1 - Math.exp(-dt / (repose ? T.reposeTau : stillFor > T.settle ? T.settleTau : T.driftTau));
    for (let i = 0; i < 3; i++) b[i] += (f[i] - b[i]) * kb;
    unit(b);
    // The screen's +x in the device frame is x = (c, s, 0) = (cos a, -sin a, 0). Made perpendicular to gravity it is the tilt's
    // horizontal axis eh = (x - xb b) / hl, and eh x b = (x x b) / hl the "top edge away" axis, so every holding angle has full
    // sensitivity. Held sideways under rotation lock (x along gravity) the target fades to rest.
    const c = Math.round(Math.cos(a * D)), s = -Math.round(Math.sin(a * D)), xb = c * b[0] + s * b[1];
    const fade = 1 - smoothstep(T.side[0], T.side[1], Math.abs(xb)), hl = Math.sqrt(1 - xb * xb), fb = dot(f, b);
    out[0] = out[1] = 0;
    if (!(fade > 0)) return out;
    const th = Math.atan2((c * f[0] + s * f[1] - xb * fb) / hl, fb) / D;                               // + right edge down
    const tv = Math.atan2((s * b[2] * f[0] - c * b[2] * f[1] + (c * b[1] - s * b[0]) * f[2]) / hl, fb) / D;   // + top edge away
    const m = Math.hypot(th, tv);
    if (m < 1e-9) return out;
    const L = T.lean * Math.tanh((m - T.dead * Math.tanh(m / T.dead)) / T.soft) * fade * gain / m;   // soft dead zone, soft clamp, radial
    out[0] = th * L; out[1] = tv * L;
    return out;
  }
  const api = {
    enable(on) { wanted = Boolean(on); sync(); },
    ask() {                                                      // only from the cage's touchend (main.js), synchronously
      if (!T.on || !T.askIOS || !ios || asked || granted || !coarse.matches) return;
      asked = true;
      let r; try { r = DeviceOrientationEvent.requestPermission(); } catch { return; }
      Promise.resolve(r).then((v) => { if (v === 'granted') { granted = true; sync(); } }, () => {});   // denied or failed: today's page
    },
    step,
  };
  // window.__tne.tilt.state: development and test builds only (absent from production, like ?debug)
  if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1') {
    Object.defineProperty(api, 'state', { get: () => ({ ios, attached, granted, asked, readings, beta, gamma, angle: lastAngle, target: [out[0], out[1]], stillFor, repose, seeded, gain }) });
  }
  return api;
}
