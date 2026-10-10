import { createPointerFilter, createCascade, frameRatio, friction, clamp, smoothstep } from './damp.js';
import { createPlexusLogic } from './plexus.js';
import { createCameraState, computeCamera, screenToWorldOnCentrePlane } from './camera.js';
import { FINDING } from './shape.js';
import { LAG, EXPOSURE, ORBIT, TIMING, INTEGRITY, NODES } from './constants.js';

// The interaction model: GL-free and authoritative for everything the DOM shows. Both renderers read it.
// Chain of lags (each response lands on its own beat): smoothed pointer 0.33 s -> lag velocity 0.83 s ->
// orbit (two cascaded lerps, 90 % in ~1.3 s) -> per-particle displacement (in the sim) -> trail ~3 s -> heal.

// CPU twin of trail.glsl on a coarse grid over the viewport (uv, y up). Integrity and the Canvas2D tier read it.
// Its cells are ~6.5x larger than the GPU trail's texels, so the per-frame dilation is scaled down to match the
// GPU trail's spread in screen space (0.35 per 1/5-res texel ≈ 0.055 per grid cell).
const GRID_GROW = LAG.trailGrow * 0.16;
export function createTrailGrid(w = 48, h = 27) {
  let v = new Float32Array(w * h), tmp = new Float32Array(w * h);
  function capsule(px, py, ax, ay, bx, by) {
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    const t = clamp((pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-8));
    return Math.hypot(pax - bax * t, pay - bay * t);
  }
  function splat(ax, ay, bx, by, radius, aspect, add) {
    if (radius < 1e-5) return;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, vv = (y + 0.5) / h;
      const k = clamp(1 - capsule(u * aspect, vv, ax * aspect, ay, bx * aspect, by) / radius);
      if (k > 0) add[y * w + x] += k * k * k;
    }
  }
  return {
    w, h,
    get data() { return v; },
    clear() { v.fill(0); },
    step(trail, ratio, aspect) {
      const decay = friction(LAG.trailDecay, ratio);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, c = v[i];
        const n = Math.max(x > 0 ? v[i - 1] : 0, x < w - 1 ? v[i + 1] : 0, y > 0 ? v[i - w] : 0, y < h - 1 ? v[i + w] : 0);
        tmp[i] = c + (Math.max(c, n) - c) * GRID_GROW;
      }
      // The grid is ~5x coarser than the GPU trail, so its radius is floored at one cell to register thin sweeps.
      const r = trail.radius > 1e-5 ? Math.max(trail.radius, 1 / h) : 0;
      splat(trail.ax, trail.ay, trail.bx, trail.by, r, aspect, tmp);
      for (let i = 0; i < tmp.length; i++) tmp[i] = Math.min(tmp[i] * decay, 1);
      const t = v; v = tmp; tmp = t;
    },
    disc(u, vv, r, aspect = 16 / 9) { splat(u, vv, u, vv, Math.max(r, 1.2 / h), aspect, v); for (let i = 0; i < v.length; i++) v[i] = Math.min(v[i], 1); },
    at(u, vv) { const x = clamp(Math.floor(u * w), 0, w - 1), y = clamp(Math.floor(vv * h), 0, h - 1); return v[y * w + x]; },
    // Mean of cells whose centre lies inside the shell's screen disc (backing px, y up).
    meanInside(shell, width, height) {
      let sum = 0, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = (x + 0.5) / w * width, py = (y + 0.5) / h * height;
        if (Math.hypot(px - shell.x, py - shell.y) <= shell.r) { sum += v[y * w + x]; n++; }
      }
      return n ? sum / n : 0;
    },
    maxAround(px, py, width, height) {
      const cx = clamp(Math.floor(px / width * w), 0, w - 1), cy = clamp(Math.floor(py / height * h), 0, h - 1);
      let m = 0;
      for (let y = Math.max(0, cy - 1); y <= Math.min(h - 1, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(w - 1, cx + 1); x++) m = Math.max(m, v[y * w + x]);
      return m;
    },
  };
}

const approach = (v, target, dt, sec) => (v < target ? Math.min(target, v + dt / sec) : Math.max(target, v - dt / sec));
const nodeAt = (shape, i) => [shape.nodes[i * 3], shape.nodes[i * 3 + 1], shape.nodes[i * 3 + 2]];
function nearestClassed(shape, p, k, cls = null) {
  const out = [];
  for (let i = 0; i < NODES; i++) {
    if (shape.nodeClass[i] < 0 || (cls !== null && shape.nodeClass[i] !== cls)) continue;
    const q = nodeAt(shape, i), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    out.push([d, i]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, k).map((x) => x[1]);
}

export function createModel(shape, uniforms) {
  const pf = createPointerFilter({ lerpK: LAG.pointer, velGain: LAG.velGain, velFriction: LAG.velFriction });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const orbit = [createCascade(LAG.orbit, LAG.orbit), createCascade(LAG.orbit, LAG.orbit)];
  if (!reduced) { orbit[0].set(0.07); orbit[1].set(0.02); }          // entrance: starts ~4° yawed and eases to the aim
  const lean = [createCascade(LAG.orbit, LAG.orbit), createCascade(LAG.orbit, LAG.orbit)];
  const plexus = createPlexusLogic({ maxNodes: NODES, k: 5, maxLinksPerNode: 2, growSec: 0.1, retractSec: 0.06, minMove: 0.05, hysteresis: 0.9 });
  const exposure = new Float32Array(NODES), shown = new Uint8Array(NODES), hold = new Float64Array(NODES);
  const trailGrid = createTrailGrid(48, 27);
  const cam = createCameraState();
  const s = {
    time: 0, simulate: false, inScene: false, returning: false, still: false, modal: false, keyboard: false,
    raw: [0, 0], lastRaw: [0, 0], lastPointerAt: -1e9, pointerDirty: false,
    probeS: [0, 0, 0], probeRaw: [0, 0, 0], vel: 0, yaw: 0, pitch: 0, orbitNorm: [0, 0],
    tear: 0, integrity: INTEGRITY.rest, tears: 0, armed: true, finding: -1, findingDone: false,
    state: 'STANDBY', loseAt: 0,
    tier0: { since: -1, on: false }, labels: [], linkAlpha: 0,
    trail: { ax: 0.5, ay: 0.5, bx: 0.5, by: 0.5, radius: 0, pressDisc: false },
    forcedNode: -1, tapNodes: [], tapUntil: 0, aspect: 16 / 9,
  };
  const eyeDir = [0, 0, -1];

  function publish() {
    const u = uniforms;
    u.u_probeX.value = s.probeS[0]; u.u_probeY.value = s.probeS[1]; u.u_probeZ.value = s.probeS[2];
    u.u_vel.value = s.vel; u.u_yaw.value = s.yaw; u.u_pitch.value = s.pitch; u.u_tear.value = s.tear;
  }

  function step(dtMs, view) {
    const ratio = frameRatio(dtMs), dt = Math.min(Math.max(dtMs, 0), 100) / 1000, u = uniforms, motion = u.u_motion.value;
    const now = performance.now();
    s.time += dt * motion;
    s.aspect = view.width / Math.max(1, view.height);
    if (!cam.ready) computeCamera(cam, u, view, { yaw: 0, pitch: 0 }, [0, 0, 0]);
    // 0. the trail segment: the model owns a -> b. The renderers only read it and clear pressDisc.
    if (!s.trail.pressDisc) { s.trail.ax = s.trail.bx; s.trail.ay = s.trail.by; }
    // 1. pointer filter (NDC) with the phantom-swipe guard
    if (s.pointerDirty) {
      const jump = Math.hypot(s.raw[0] - s.lastRaw[0], s.raw[1] - s.lastRaw[1]) > 0.6 || now - s.lastPointerAt > 150;
      if (jump) { pf.set(s.raw[0], s.raw[1]); s.trail.ax = s.trail.bx = s.raw[0] * 0.5 + 0.5; s.trail.ay = s.trail.by = s.raw[1] * 0.5 + 0.5; }
      else pf.target(s.raw[0], s.raw[1]);
      s.lastRaw[0] = s.raw[0]; s.lastRaw[1] = s.raw[1]; s.pointerDirty = false;
    }
    if (motion) pf.step(ratio);
    s.vel = pf.state.vel;
    // 2. world probes on the centre plane (last frame's camera is fine)
    screenToWorldOnCentrePlane(cam.inv, pf.state.sx, pf.state.sy, cam.forward, s.probeS);
    screenToWorldOnCentrePlane(cam.inv, pf.state.x, pf.state.y, cam.forward, s.probeRaw);
    // 3. orbit through two cascaded lerps; half speed while losing the visitor
    const aimed = (s.inScene || s.keyboard) && motion;
    const aim = aimed ? [pf.state.sx * ORBIT.yaw, -pf.state.sy * ORBIT.pitch] : [0, 0];
    const k = s.returning ? LAG.orbit * 0.5 : LAG.orbit;
    const oy = orbit[0].step(aim[0], ratio, k), op = orbit[1].step(aim[1], ratio, k);
    if (s.returning && Math.hypot(oy, op) < 0.002) s.returning = false;
    const t = s.time, shake = motion * ORBIT.shake, drift = motion * u.u_idle.value * ORBIT.idle;
    s.yaw = oy + shake * (Math.sin(0.5 * t) + Math.sin(1.3 * t + 1.7) + Math.sin(2.1 * t + 0.4)) / 3 + drift * Math.sin(2 * Math.PI * t / 11);
    s.pitch = op + shake * 0.6 * (Math.sin(0.45 * t + 2.2) + Math.sin(1.1 * t + 0.9) + Math.sin(1.9 * t + 3.1)) / 3 + drift * 0.6 * Math.cos(2 * Math.PI * t / 17);
    const leanAim = aimed ? s.probeS : [0, 0];
    lean[0].step(clamp(leanAim[0], -1.5, 1.5), ratio); lean[1].step(clamp(leanAim[1], -1.5, 1.5), ratio);
    // 4. camera for this frame
    computeCamera(cam, u, view, { yaw: s.yaw, pitch: s.pitch }, [lean[0].value, lean[1].value]);
    // 5. CPU trail twin and integrity
    s.trail.radius = LAG.trailRadius * smoothstep(0.1, 1, s.vel);
    if (motion && s.simulate) trailGrid.step(s.trail, ratio, s.aspect);
    const meanDisc = trailGrid.meanInside(cam.shellPx, view.width, view.height);
    s.tear = Math.min(1, meanDisc / INTEGRITY.tearRef);
    s.integrity = clamp(INTEGRITY.rest - INTEGRITY.slope * meanDisc, INTEGRITY.floor, INTEGRITY.rest);
    if (s.integrity < INTEGRITY.tearEvent && s.armed) { s.tears++; s.armed = false; } else if (s.integrity > INTEGRITY.rearm) s.armed = true;
    // 6. plexus and exposure: stillness reads, motion tears
    const near = Math.hypot(s.probeS[0], s.probeS[1]) < 1.4;
    const live = s.simulate && s.inScene && near && !s.still && !s.modal && motion > 0;
    if (live) {
      const dx = s.probeS[0] - cam.eye[0], dy = s.probeS[1] - cam.eye[1], dz = s.probeS[2] - cam.eye[2], l = Math.hypot(dx, dy, dz) || 1;
      eyeDir[0] = dx / l; eyeDir[1] = dy / l; eyeDir[2] = dz / l;
      plexus.update(shape.nodes, NODES, cam.eye, eyeDir, dt);
    }
    s.linkAlpha = approach(s.linkAlpha, live ? 1 : 0, dt, live ? 0.1 : 0.06);
    const gain = EXPOSURE.gain * (1 - EXPOSURE.velPenalty * s.vel) * dt, decay = friction(EXPOSURE.decay, ratio);
    const sel = plexus.selected, selD = plexus.selectedDist2;
    const canShow = !s.still && !s.modal && motion > 0 && s.vel < 0.9;
    s.labels.length = 0;
    for (let i = 0; i < NODES; i++) {
      let j = -1; for (let q = 0; q < sel.length; q++) if (sel[q] === i) j = q;
      const selectedNow = live && j >= 0;
      const prox = selectedNow ? 1 - smoothstep(0.25, 0.9, Math.sqrt(selD[j])) : 0;
      exposure[i] = Math.min(1, exposure[i] + prox * gain) * decay;
      const held = hold[i] > now;
      if (held) exposure[i] = 1;
      const forced = held && (i === s.forcedNode || s.tapNodes.includes(i));
      const vis = canShow && shape.nodeClass[i] >= 0 && (selectedNow || forced) && (exposure[i] > EXPOSURE.show || (shown[i] && exposure[i] > EXPOSURE.hide));
      shown[i] = vis ? 1 : 0;
      const text = i === s.finding ? FINDING : (i === s.forcedNode && s.forcedText) ? s.forcedText : shape.nodeText[i];
      if (vis) s.labels.push({ node: i, dist: selectedNow ? selD[j] : -1, text, finding: i === s.finding });
    }
    s.labels.sort((a, b) => a.dist - b.dist); if (s.labels.length > 5) s.labels.length = 5;
    // 7. the finding: after the second tear, the next CAM reading becomes it (once per page load)
    if (!s.findingDone && s.tears >= 2) {
      const camLabel = s.labels.find((l) => shape.nodeClass[l.node] === 3);
      if (camLabel) { s.finding = camLabel.node; s.findingDone = true; camLabel.text = FINDING; camLabel.finding = true; s.onFinding?.(camLabel.node); }
    }
    // 8. tier-0 dwell: rest near the ember and the camera leans in
    const inCore = live && Math.hypot(s.probeS[0], s.probeS[1]) < TIMING.tier0Radius && s.vel < 0.1;
    if (inCore) {
      if (s.tier0.since < 0) s.tier0.since = now;
      if (!s.tier0.on && now - s.tier0.since > TIMING.tier0Dwell * 1000) { s.tier0.on = true; s.onTier0?.(true); }
    } else {
      s.tier0.since = -1;
      if (s.tier0.on) { s.tier0.on = false; s.onTier0?.(false); }
    }
    // 9. lose -> STANDBY after 1.5 s
    if (!s.inScene && s.state === 'TRACKING' && now > s.loseAt + TIMING.lose * 1000) { s.state = 'STANDBY'; s.onState?.(s.state); }
    // 10. publish
    s.orbitNorm[0] = orbit[0].value / ORBIT.yaw; s.orbitNorm[1] = orbit[1].value / ORBIT.pitch;
    if (!s.trail.pressDisc) { s.trail.bx = pf.state.x * 0.5 + 0.5; s.trail.by = pf.state.y * 0.5 + 0.5; }
    publish();
    s.onFrame?.();
  }

  // The composed still: cage at rest, no labels, no trail. Used whenever u_motion is 0.
  function drawStill(view) {
    pf.set(0, 0.1); pf.state.vel = 0; orbit.forEach((c) => c.set(0)); lean.forEach((c) => c.set(0));
    s.vel = 0; s.yaw = 0; s.pitch = 0; s.tear = 0; s.integrity = INTEGRITY.rest; s.labels.length = 0; s.linkAlpha = 0;
    s.probeS[0] = s.probeS[1] = s.probeS[2] = 0; s.orbitNorm[0] = s.orbitNorm[1] = 0;
    s.trail.radius = 0; s.trail.pressDisc = false;
    trailGrid.clear();
    if (view) computeCamera(cam, uniforms, view, { yaw: 0, pitch: 0 }, [0, 0, 0]);
    publish();
    s.onFrame?.();
  }

  function pointer(nx, ny, nowMs = performance.now()) {
    s.raw[0] = nx; s.raw[1] = ny; s.lastPointerAt = nowMs; s.pointerDirty = true;
    if (!s.inScene) enter();
  }
  function enter() {
    s.inScene = true; s.returning = false;
    if (s.state !== 'TRACKING') { s.state = 'TRACKING'; s.onState?.(s.state); s.onGreet?.(Math.asin(clamp(s.probeS[0], -1, 1))); }
  }
  function leave() { s.inScene = false; s.returning = true; s.loseAt = performance.now(); s.forcedNode = -1; }
  function press(nx, ny) {
    s.trail.pressDisc = true;
    s.trail.ax = s.trail.bx = nx * 0.5 + 0.5; s.trail.ay = s.trail.by = ny * 0.5 + 0.5;
    if (s.simulate) trailGrid.disc(s.trail.ax, s.trail.ay, 0.06, s.aspect);
  }
  function tap(nx, ny) {
    pointer(nx, ny, performance.now()); pf.set(nx, ny);
    screenToWorldOnCentrePlane(cam.inv, nx, ny, cam.forward, s.probeRaw);
    const p = s.probeRaw;
    s.tapNodes = nearestClassed(shape, p, 3);
    const until = performance.now() + 1500;
    s.tapNodes.forEach((i) => { hold[i] = until; });
    return [p[0], p[1], p[2]];
  }
  // Row-1 hover: the class node nearest the word's rim point links and prints the word's own reading.
  function rowHover(classIndex, lon = 0, reading = null) {
    if (s.forcedNode >= 0) hold[s.forcedNode] = 0;
    if (classIndex < 0) { s.forcedNode = -1; s.forcedText = null; return; }
    const rim = [Math.sin(lon), -1.2, Math.cos(lon)], l = Math.hypot(...rim);
    const [node] = nearestClassed(shape, rim.map((x) => x / l), 1, classIndex);
    s.forcedNode = node ?? -1;
    if (s.forcedNode >= 0) { hold[s.forcedNode] = Infinity; if (reading) s.forcedText = reading; }
  }

  return {
    state: s, cam, plexus, trailGrid, shape, step, drawStill, pointer, press, tap, enter, leave, rowHover,
    get labels() { return s.labels; }, get linkAlpha() { return s.linkAlpha; }, get simulate() { return s.simulate; },
    get time() { return s.time; }, get trail() { return s.trail; }, get orbitNorm() { return s.orbitNorm; },
  };
}
