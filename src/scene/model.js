import { createPointerFilter, createCascade, frameRatio, friction, clamp, smoothstep } from './damp.js';
import { createPlexusLogic } from './plexus.js';
import { createCameraState, computeCamera, screenToWorldOnCentrePlane } from './camera.js';
import { FINDING } from './shape.js';
import { LAG, EXPOSURE, ORBIT, TIMING, INTEGRITY, RESET, TEAR, NODES } from './constants.js';
const inOut3 = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// The interaction model: GL-free and authoritative for everything the DOM shows. Both renderers read it.
// Chain of lags (each response lands on its own beat): smoothed pointer 0.33 s -> lag velocity 0.83 s ->
// orbit (two cascaded lerps, 90 % in ~1.3 s) -> per-particle displacement (in the sim) -> trail ~3 s -> heal.

// CPU twin of trail.glsl on a coarse grid over the viewport (uv, y up). Integrity and the Canvas2D tier read it.
// Its cells are ~6.5x larger than the GPU trail's texels, so the per-frame dilation is scaled down to match the
// GPU trail's spread in screen space (0.35 per 1/5-res texel ≈ 0.055 per grid cell).
const GRID_GROW = LAG.trailGrow * 0.16;
export function createTrailGrid(w = 48, h = 27) {
  let v = new Float32Array(w * h), tmp = new Float32Array(w * h);
  const rim = new Float32Array(w * h), head = new Float32Array(w * h);   // leading edge this tick; its x0.9-per-tick smoothed head (as trail.glsl G/B)
  function capsule(px, py, ax, ay, bx, by) {
    const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay;
    const t = clamp((pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-8));
    return Math.hypot(pax - bax * t, pay - bay * t);
  }
  function splat(ax, ay, bx, by, radius, aspect, add, amp = 1) {
    if (radius < 1e-5 || amp <= 0) return;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w, vv = (y + 0.5) / h;
      const k = clamp(1 - capsule(u * aspect, vv, ax * aspect, ay, bx * aspect, by) / radius);
      if (k > 0) add[y * w + x] += k * k * k * amp;
    }
  }
  return {
    w, h,
    get data() { return v; },
    clear() { v.fill(0); rim.fill(0); head.fill(0); },
    // the bright, short-lived head of a tear (igloo's front channel): gone in ~20 ticks
    front(u, vv) { const i = clamp(Math.floor(vv * h), 0, h - 1) * w + clamp(Math.floor(u * w), 0, w - 1); return Math.min(1, rim[i] * 2.5 + head[i] * 0.25); },
    step(trail, ratio, aspect) {
      const decay = friction(LAG.trailDecay, ratio);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, c = v[i];
        const n = Math.max(x > 0 ? v[i - 1] : 0, x < w - 1 ? v[i + 1] : 0, y > 0 ? v[i - w] : 0, y < h - 1 ? v[i + w] : 0);
        tmp[i] = c + (Math.max(c, n) - c) * GRID_GROW;
      }
      // The grid is coarser than the GPU trail: thin sweeps are drawn one cell wide but amplitude-gated, so a
      // sweep the GPU trail barely paints barely counts toward integrity.
      const cell = 1 / h;
      const amp = trail.radius > 1e-5 ? Math.min(1, trail.radius / (0.6 * cell)) : 0;
      if (amp > 0) splat(trail.ax, trail.ay, trail.bx, trail.by, Math.max(trail.radius, cell), aspect, tmp, amp);
      const keep = Math.pow(0.9, ratio);
      for (let i = 0; i < tmp.length; i++) { tmp[i] = Math.min(tmp[i] * decay, 1); rim[i] = Math.max(tmp[i] - v[i], 0); head[i] = (head[i] + rim[i]) * keep; }
      const t = v; v = tmp; tmp = t;
    },
    seal(cx, cy, rPx, width, height, k) {   // the resync front clears the grid behind it (cell centres, backing px, y up)
      if (k <= 0 || rPx <= 0) return;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        if (Math.hypot((x + 0.5) / w * width - cx, (y + 0.5) / h * height - cy) < rPx) v[y * w + x] *= 1 - k;
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
  const plexus = createPlexusLogic({ maxNodes: NODES, k: 4, maxLinksPerNode: 1, growSec: 0.1, retractSec: 0.06, minMove: 0.05, hysteresis: 0.9 });
  const exposure = new Float32Array(NODES), shown = new Uint8Array(NODES), hold = new Float64Array(NODES);
  const trailGrid = createTrailGrid(48, 27);
  const gridSeg = { acc: 0, ax: 0.5, ay: 0.5, radius: 0 };   // the grid's own segment since its last fixed-rate tick
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
    present: 0, crossedAt: -1e9, entered: false,
    probeVel: [0, 0, 0], lastProbeRaw: [0, 0, 0], poke: 0, wake: 0, probeJump: false, handDir: [0, 0, -1],
    // the integrity ledger and the reset (see INTEGRITY / RESET)
    quietSince: -1e9, damage: 0, deficit: 0, resetting: false, released: false, rollUntil: 0, resetT: -1, front: -10, resetAmp: 0, ampS: 0,
  };
  const eyeDir = [0, 0, -1], tmp3 = [0, 0, 0];

  function publish() {
    const u = uniforms;
    u.u_probeX.value = s.probeS[0]; u.u_probeY.value = s.probeS[1]; u.u_probeZ.value = s.probeS[2];
    u.u_vel.value = s.vel; u.u_yaw.value = s.yaw; u.u_pitch.value = s.pitch; u.u_tear.value = s.tear; u.u_present.value = s.present;
    u.u_probeRX.value = s.probeRaw[0]; u.u_probeRY.value = s.probeRaw[1]; u.u_probeRZ.value = s.probeRaw[2];
    u.u_pokeX.value = s.probeVel[0]; u.u_pokeY.value = s.probeVel[1]; u.u_pokeZ.value = s.probeVel[2]; u.u_poke.value = s.poke;
    u.u_handDX.value = s.handDir[0]; u.u_handDY.value = s.handDir[1]; u.u_handDZ.value = s.handDir[2];
    u.u_resetFront.value = s.front; u.u_resetAmp.value = s.ampS; u.u_wake.value = s.wake;
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
    let rawSpeed = 0;
    if (s.pointerDirty) {
      const jump = Math.hypot(s.raw[0] - s.lastRaw[0], s.raw[1] - s.lastRaw[1]) > 0.6 || now - s.lastPointerAt > 150;
      if (jump) { pf.set(s.raw[0], s.raw[1]); s.trail.ax = s.trail.bx = s.raw[0] * 0.5 + 0.5; s.trail.ay = s.trail.by = s.raw[1] * 0.5 + 0.5; s.probeJump = true; gridSeg.ax = s.trail.bx; gridSeg.ay = s.trail.by; gridSeg.radius = 0; }
      else {
        pf.target(s.raw[0], s.raw[1]);
        if (!s.probeJump) rawSpeed = Math.hypot((s.raw[0] - s.lastRaw[0]) * s.aspect, s.raw[1] - s.lastRaw[1]) / Math.max(dt, 1e-3);   // NDC-height units per second
      }
      s.lastRaw[0] = s.raw[0]; s.lastRaw[1] = s.raw[1]; s.pointerDirty = false;
    }
    if (motion) pf.step(ratio);
    s.vel = pf.state.vel;
    // 2. world probes on the centre plane (last frame's camera is fine)
    screenToWorldOnCentrePlane(cam.inv, pf.state.sx, pf.state.sy, cam.forward, s.probeS);
    screenToWorldOnCentrePlane(cam.inv, pf.state.x, pf.state.y, cam.forward, s.probeRaw);
    // The raw probe sits on the centre plane, inside the shell: the hand is measured across the view ray through it
    // (same camera, so the ray passes exactly under the pointer), never by 3D distance to the probe.
    { const e = cam.eye, dx = s.probeRaw[0] - e[0], dy = s.probeRaw[1] - e[1], dz = s.probeRaw[2] - e[2], l = Math.hypot(dx, dy, dz) || 1;
      s.handDir[0] = dx / l; s.handDir[1] = dy / l; s.handDir[2] = dz / l; }
    // 2b. the hand: raw probe velocity on the centre plane (R/s, clamped) and a poke that rises at once and dies in ~0.15 s.
    //     A still hand does nothing; movement is what the lattice feels, on the frame it happens.
    if (s.probeJump || !motion) { s.probeVel[0] = s.probeVel[1] = s.probeVel[2] = 0; s.probeJump = false; }
    else for (let i = 0; i < 3; i++) s.probeVel[i] = (s.probeRaw[i] - s.lastProbeRaw[i]) / Math.max(dt, 1e-3);
    for (let i = 0; i < 3; i++) s.lastProbeRaw[i] = s.probeRaw[i];
    const pvl = Math.hypot(s.probeVel[0], s.probeVel[1], s.probeVel[2]);
    if (pvl > 4) for (let i = 0; i < 3; i++) s.probeVel[i] *= 4 / pvl;
    s.poke = Math.max(s.poke * friction(LAG.poke, ratio), Math.min(1, rawSpeed / 2.0)) * motion * (s.simulate ? 1 : 0);   // no shove while the cage builds
    s.wake = Math.max(s.wake * friction(LAG.wake, ratio), s.poke) * motion;   // the light's slower tail: lit particles stay lit on their way home
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
    // 5. CPU trail twin and integrity. The grid gets the real previous -> current segment (b advances here) and
    //    paints only while the hand moves: lag velocity lingers after a stop and must never paint at the rest point.
    //    Sub-stepped at 30 Hz so the dip matches 60 Hz.
    const rx = pf.state.x * 0.5 + 0.5, ry = pf.state.y * 0.5 + 0.5;
    const moved = Math.hypot(rx - s.trail.bx, ry - s.trail.by) > 1e-4;
    if (!s.trail.pressDisc) { s.trail.bx = rx; s.trail.by = ry; }
    s.trail.radius = moved ? LAG.trailRadius * smoothstep(0.25, 0.7, s.vel) : 0;
    // The grid ticks at a fixed ~60 Hz over the segment since its last tick: a pass paints the same at 30/60/120/144 Hz
    // (per-frame ticks made every brisk gesture on a 120 Hz screen twice as heavy).
    if (motion && s.simulate) {
      gridSeg.acc += ratio; gridSeg.radius = Math.max(gridSeg.radius, s.trail.radius);
      if (gridSeg.acc >= 0.999) {
        const r = gridSeg.acc < 1.5 ? Math.min(gridSeg.acc, 1) : gridSeg.acc, n = r > 1.5 ? Math.round(r) : 1;
        const ax = gridSeg.ax, ay = gridSeg.ay, ex = s.trail.bx - ax, ey = s.trail.by - ay;   // catch-up ticks split the segment
        for (let q = 0; q < n; q++) trailGrid.step({ ax: ax + ex * q / n, ay: ay + ey * q / n, bx: ax + ex * (q + 1) / n, by: ay + ey * (q + 1) / n, radius: gridSeg.radius }, r / n, s.aspect);
        gridSeg.acc = Math.max(0, gridSeg.acc - r); gridSeg.ax = s.trail.bx; gridSeg.ay = s.trail.by; gridSeg.radius = 0;
      }
    }
    const meanDisc = trailGrid.meanInside(cam.shellPx, view.width, view.height);
    if (s.trail.radius > 0) s.quietSince = s.time;
    {
      const I = INTEGRITY, quiet = s.time - s.quietSince, span = I.rest - I.floor;
      if (quiet < I.quiet) {                                                     // under the hand: the ledger only grows
        if (s.resetting) { s.resetting = false; s.resetT = -1; s.front = -10; s.resetAmp = 0; s.onReset?.('abort', I.rest - s.deficit, 0); }
        if (quiet < I.active && s.simulate) s.damage += I.acc * meanDisc * (1 - s.damage) * dt;
        s.deficit = Math.min(span, Math.max(s.deficit, I.liveCap * (1 - Math.exp(-I.live * meanDisc / I.liveCap)), span * s.damage));
      } else if (!s.resetting && s.deficit > 0.01) {                             // a second of quiet: the reset fires
        s.resetting = true; s.released = false; s.resetT = 0; s.front = 0;
        s.resetAmp = s.deficit >= I.event ? 0.5 + 0.5 * Math.min(1, s.deficit / 0.3) : 0;   // scales with depth; trivial damage is silent
        s.onReset?.('start', I.rest - s.deficit, s.resetAmp);
      } else if (s.resetting) {
        if (s.resetT >= 0) { s.resetT = Math.min(1, s.resetT + dt / I.wave); s.front = RESET.front * inOut3(s.resetT); if (s.resetT >= 1) { s.resetT = -1; s.front = -10; } }
        if (!s.released && (s.resetAmp === 0 || s.front >= 1 || s.resetT < 0)) {   // the front crosses the shell: one decisive release
          s.released = true; s.deficit *= 1 - I.release; s.rollUntil = s.time + (s.resetAmp > 0 ? I.roll : 0);
          s.onReset?.('release', I.rest - s.deficit, s.resetAmp);
        } else if (s.released && s.time >= s.rollUntil) s.deficit *= Math.pow(0.5, dt / I.heal);   // the slow climb
        if (s.released && s.deficit < I.sealAt) { s.deficit = 0; s.damage = 0; s.resetting = false; s.onReset?.('sealed', I.rest, s.resetAmp); s.resetAmp = 0; }
      } else { s.damage = 0; s.deficit = 0; }
      s.integrity = I.rest - s.deficit;
      s.tear = Math.min(1, Math.max(meanDisc / I.tearRef, s.deficit / 0.45));   // the ember stays dimmed by the ledger until it seals
      s.ampS += ((s.resetT >= 0 && s.simulate ? s.resetAmp : 0) - s.ampS) * (1 - Math.pow(0.7, ratio));   // 6-frame in/out: an abort never pops
      if (s.resetT >= 0 && s.ampS > 1e-3) trailGrid.seal(cam.shellPx.x, cam.shellPx.y, s.front * cam.shellPx.r, view.width, view.height, 1 - Math.pow(1 - RESET.seal * s.ampS, ratio));
    }
    // 5b. a tear = one fast pass across the shell; re-armed once the probe calms
    {
      const sh = cam.shellPx, W = view.width, H = view.height;
      const ax = s.trail.ax * W, ay = s.trail.ay * H, bx = s.trail.bx * W, by = s.trail.by * H;
      const dx = bx - ax, dy = by - ay, f = clamp(((sh.x - ax) * dx + (sh.y - ay) * dy) / Math.max(dx * dx + dy * dy, 1e-6));
      if (moved && Math.hypot(ax + dx * f - sh.x, ay + dy * f - sh.y) <= sh.r) s.crossedAt = s.time;
      if (s.armed && s.simulate && s.vel > TEAR.vel && s.time - s.crossedAt < TEAR.window) { s.tears++; s.armed = false; }
      else if (!s.armed && s.vel < TEAR.calm) s.armed = true;
    }
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
    // At most three readings, deduplicated: reading, not a HUD.
    s.labels.sort((a, b) => a.dist - b.dist);
    { let n = 0; const seen = new Set();
      for (const l of s.labels) { const t = Array.isArray(l.text) ? l.text[0] : l.text; if (seen.has(t)) continue; seen.add(t); s.labels[n++] = l; if (n === 3) break; }
      s.labels.length = n; }
    // 7. the finding: after the second tear, the next CAM reading becomes it (once per page load)
    if (!s.findingDone && s.tears >= 2 && s.vel < TEAR.read) {
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
    if (!s.inScene && !s.modal && s.state === 'TRACKING' && now > s.loseAt + TIMING.lose * 1000) { s.state = 'STANDBY'; s.onState?.(s.state); }
    // 10. presence (the lattice only notices a visitor who is there) and publish
    const want = (s.inScene || s.keyboard) && !s.modal ? 1 : 0;
    s.present = approach(s.present, want, dt * motion, want ? 0.6 : 1.5);
    s.orbitNorm[0] = orbit[0].value / ORBIT.yaw; s.orbitNorm[1] = orbit[1].value / ORBIT.pitch;
    publish();
    s.onFrame?.();
  }

  // The composed still: cage at rest, no labels, no trail. Used whenever u_motion is 0.
  function drawStill(view) {
    pf.set(0, 0.1); pf.state.vel = 0; orbit.forEach((c) => c.set(0)); lean.forEach((c) => c.set(0));
    s.vel = 0; s.yaw = 0; s.pitch = 0; s.tear = 0; s.integrity = INTEGRITY.rest; s.labels.length = 0; s.linkAlpha = 0;
    s.quietSince = -1e9; s.damage = 0; s.deficit = 0; s.resetting = false; s.released = false; s.resetT = -1; s.front = -10; s.resetAmp = 0; s.ampS = 0;
    s.probeS[0] = s.probeS[1] = s.probeS[2] = 0; s.orbitNorm[0] = s.orbitNorm[1] = 0;
    s.trail.radius = 0; s.trail.pressDisc = false; s.present = 0;
    s.poke = 0; s.wake = 0; s.probeJump = true; for (const a of [s.probeVel, s.probeRaw, s.lastProbeRaw]) a[0] = a[1] = a[2] = 0;
    s.handDir[0] = 0; s.handDir[1] = 0; s.handDir[2] = -1;
    s.tier0.on = false; s.tier0.since = -1;
    trailGrid.clear();
    publish();
    if (view) computeCamera(cam, uniforms, view, { yaw: 0, pitch: 0 }, [0, 0, 0]);
    s.onFrame?.();
  }

  function pointer(nx, ny, nowMs = performance.now()) {
    if (!s.inScene) s.probeJump = true;   // first sample after load, leave or a lifted finger: no phantom swipe from the old point
    s.raw[0] = nx; s.raw[1] = ny; s.lastPointerAt = nowMs; s.pointerDirty = true;
    if (!s.inScene || (s.entered && s.state !== 'TRACKING')) enter();
  }
  // Greet only once the entrance is done, at the entry point (not last frame's smoothed probe).
  function enter() {
    s.inScene = true; s.returning = false;
    if (s.entered && s.state !== 'TRACKING') {
      s.state = 'TRACKING'; s.onState?.(s.state);
      screenToWorldOnCentrePlane(cam.inv, s.raw[0], s.raw[1], cam.forward, tmp3);
      s.onGreet?.(Math.asin(clamp(tmp3[0], -1, 1)));
    }
  }
  function leave() { s.inScene = false; s.returning = true; s.loseAt = performance.now(); rowHover(-1); }
  function press(nx, ny) {
    s.trail.pressDisc = true;
    s.trail.ax = s.trail.bx = nx * 0.5 + 0.5; s.trail.ay = s.trail.by = ny * 0.5 + 0.5;
    if (s.simulate) trailGrid.disc(s.trail.ax, s.trail.ay, 0.06, s.aspect);
    s.quietSince = s.time;                                   // a press is a hit
    gridSeg.ax = s.trail.bx; gridSeg.ay = s.trail.by; gridSeg.radius = 0;
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
    if (s.forcedNode >= 0 && hold[s.forcedNode] === Infinity) hold[s.forcedNode] = 0;
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
