// ?tiltsim, in development and VITE_DEBUG_HOOKS=1 builds only (main.js never imports it in production): a pad that fakes the
// device's tilt on a desktop, so the ember's tilt lean can be previewed without a phone. Drag the dot: right = right edge down,
// up = top edge away, the pad's rim = 30 deg of gravity (rings at 10 and 20 deg; 10 deg leans the ember as a finger 0.73 R from
// the centre would). The pose holds where it is let go, as a phone held at a new angle does: the neutral recentres the ember
// after about 2 s still. Double-click returns to level. It streams the same deviceorientation events a phone sends (portrait,
// held 50 deg from flat), so everything after the sensor is the real path. The mouse over the page still wins, as on a phone.
const D = Math.PI / 180;
// reference-sim.mjs poseScr(): the screen held `incl` deg from flat, then a gravity tilt of h deg (right edge down) and v deg
// (top edge away) for screen angle a -> [beta, gamma]
function pose(a, h, v, incl = 50) {
  const b = [0, -Math.sin(incl * D), -Math.cos(incl * D)], ev = [0, -b[2], b[1]];   // ev = x cross b, x = [1, 0, 0]
  let d = b.map((bi, i) => Math.cos(h * D) * bi + Math.sin(h * D) * (i === 0 ? 1 : 0));
  d = d.map((di, i) => Math.cos(v * D) * di + Math.sin(v * D) * ev[i]);
  const A = -a * D, x = d[0] * Math.cos(A) - d[1] * Math.sin(A), y = d[0] * Math.sin(A) + d[1] * Math.cos(A);
  return [Math.asin(-y) / D, Math.atan2(x, -d[2]) / D];
}

export function mountTiltSim(max = 30) {
  const size = 112, pad = document.createElement('div'), dot = document.createElement('div');
  pad.className = 'tiltsim'; pad.setAttribute('aria-hidden', 'true'); pad.title = 'Fake tilt: drag; double-click to level';
  pad.style.cssText = `position:fixed;top:16px;right:16px;z-index:9;width:${size}px;height:${size}px;border-radius:50%;border:1px solid #ffffff2e;background:#0a1113cc;touch-action:none;cursor:grab`;
  for (const f of [1 / 3, 2 / 3]) {
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;left:${50 - 50 * f}%;top:${50 - 50 * f}%;width:${100 * f}%;height:${100 * f}%;border-radius:50%;border:1px solid #ffffff17;pointer-events:none`;
    pad.append(ring);
  }
  dot.style.cssText = 'position:absolute;left:50%;top:50%;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:#F0A65E;box-shadow:0 0 10px #F0A65E99;pointer-events:none';
  pad.append(dot);
  document.body.append(pad);
  let h = 0, v = 0, dragging = false;
  const send = () => {
    const a = screen.orientation ? screen.orientation.angle : 0, [beta, gamma] = pose(a, h, v);
    dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta, gamma, absolute: false }));
  };
  const place = () => { dot.style.transform = `translate(${(h / max) * size / 2}px, ${(-v / max) * size / 2}px)`; };
  const aim = (event) => {
    const r = pad.getBoundingClientRect();
    let x = (event.clientX - r.left - r.width / 2) / (r.width / 2), y = (event.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    h = x * max; v = -y * max; place(); send();
  };
  pad.addEventListener('pointerdown', (event) => { dragging = true; pad.setPointerCapture(event.pointerId); pad.style.cursor = 'grabbing'; aim(event); });
  pad.addEventListener('pointermove', (event) => { if (dragging) aim(event); });
  const end = () => { dragging = false; pad.style.cursor = 'grab'; };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
  pad.addEventListener('dblclick', () => { h = v = 0; place(); send(); });
  send();
  setInterval(send, 1000 / 60);   // a phone's sensor streams; a re-attached listener (tab shown, unpaused) hears it at once
  return { set(nh, nv) { h = nh; v = nv; place(); send(); }, get pose() { return [h, v]; } };
}
