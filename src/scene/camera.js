import { perspective, lookAt, multiply, invert } from './mat4.js';
import { pointerRay } from './plexus.js';
import { FOV, KEY, EMBER } from './constants.js';

export function createCameraState() {
  return { view: new Float32Array(16), proj: new Float32Array(16), viewProj: new Float32Array(16), inv: new Float32Array(16),
    right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], lightDir: KEY.slice(), lightView: [0, 0, 1], eye: [0, 0, 10], dist: 10,
    shellPx: { x: 0, y: 0, r: 1 }, emberPx: [0, 0], emberView: [0, 0, -10], emberR: 1, guardY: 0, hazePx: [0, 0], ready: false };
}

const mulDir = (m, d) => {
  const x = m[0] * d[0] + m[4] * d[1] + m[8] * d[2], y = m[1] * d[0] + m[5] * d[1] + m[9] * d[2], z = m[2] * d[0] + m[6] * d[1] + m[10] * d[2];
  const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
};

// view: { anchorX, anchorY (backing px, y down), anchorH (backing px), width, height (backing px) }
// orbit: { yaw, pitch } incl. shake and idle drift. probeS: the light/ember lean (smoothed probe, shell units).
export function computeCamera(out, u, view, orbit, probeS) {
  const height = Math.max(1, view.height), width = Math.max(1, view.width), anchorH = Math.max(1, view.anchorH);
  const R_px = anchorH / 2;
  const tanHalf = Math.tan(FOV / 2);
  const D0 = (height / anchorH) / tanHalf;                       // distance at which the unit sphere spans anchorH px
  const dist = D0 * (1 + 0.25 * u.u_entry.value + 0.45 * u.u_dolly.value) * (1 - 0.06 * u.u_vel.value) * (1 - 0.15 * u.u_tier0.value);
  const { yaw, pitch } = orbit;
  const eye = [Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist];
  lookAt(out.view, eye, [0, 0, 0], [0, 1, 0]);
  perspective(out.proj, FOV, width / height, 0.1, Math.max(100, dist * 4));
  // Off-centre projection: put the sphere's centre on the DOM anchor without skewing it.
  const ndcX = (view.anchorX / width) * 2 - 1, ndcY = 1 - (view.anchorY / height) * 2;
  out.proj[8] = -ndcX; out.proj[9] = -ndcY;
  multiply(out.viewProj, out.proj, out.view); invert(out.inv, out.viewProj);
  out.right = [out.view[0], out.view[4], out.view[8]]; out.up = [out.view[1], out.view[5], out.view[9]];
  out.forward = [-out.view[2], -out.view[6], -out.view[10]];
  const lean = [KEY[0] + 0.35 * probeS[0], KEY[1] + 0.35 * probeS[1], KEY[2]]; const l = Math.hypot(...lean) || 1;
  out.lightDir = lean.map((x) => x / l);
  out.lightView = mulDir(out.view, out.lightDir);
  out.eye = eye; out.dist = dist;
  out.shellPx = { x: view.anchorX, y: height - view.anchorY, r: R_px };          // y up, backing px
  const ex = EMBER.offset * probeS[0], ey = EMBER.offset * probeS[1], V = out.view;   // the ember (world z = 0)
  out.emberPx = projectPx(out.viewProj, [ex, ey, 0], width, height);
  out.emberView[0] = V[0] * ex + V[4] * ey + V[12]; out.emberView[1] = V[1] * ex + V[5] * ey + V[13]; out.emberView[2] = V[2] * ex + V[6] * ey + V[14];   // view space: the depth split, its light
  out.emberR = EMBER.haloR * R_px;
  out.guardY = out.shellPx.y - R_px;                                           // lower limb, y up
  out.hazePx = [0.22 * R_px * probeS[0], 0.22 * R_px * probeS[1]];          // the void answers the hand
  out.width = width; out.height = height; out.ready = true;
  return out;
}

// World point -> backing px, y up. Returns [x, y, w].
export function projectPx(viewProj, p, width, height, out = [0, 0, 0]) {
  const m = viewProj;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  const iw = 1 / (Math.abs(w) > 1e-6 ? w : 1e-6);
  out[0] = (x * iw * 0.5 + 0.5) * width; out[1] = (y * iw * 0.5 + 0.5) * height; out[2] = w;
  return out;
}

// Ray through (ndcX, ndcY) intersected with the plane through the origin facing the camera (always hit).
const ro = [0, 0, 0], rd = [0, 0, 1];
export function screenToWorldOnCentrePlane(inv, ndcX, ndcY, forward, out) {
  pointerRay(ndcX, ndcY, inv, ro, rd);
  const denom = rd[0] * forward[0] + rd[1] * forward[1] + rd[2] * forward[2];
  const t = Math.abs(denom) > 1e-6 ? -(ro[0] * forward[0] + ro[1] * forward[1] + ro[2] * forward[2]) / denom : 0;
  out[0] = ro[0] + rd[0] * t; out[1] = ro[1] + rd[1] * t; out[2] = ro[2] + rd[2] * t;
  if (!Number.isFinite(out[0] + out[1] + out[2])) { out[0] = out[1] = out[2] = 0; }
  return out;
}
