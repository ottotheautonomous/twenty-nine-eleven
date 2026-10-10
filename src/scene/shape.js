import { LATTICE, TUBE_JITTER, NODES } from './constants.js';

// Great-circle normals (unit). Set 1 = the ten 3-fold axes of the icosahedron (sdf.glsl AX3), set 0 = the six 5-fold axes (AX5).
export const AX3 = [[.57735027, .57735027, .57735027], [-.57735027, .57735027, .57735027], [.57735027, -.57735027, .57735027], [.57735027, .57735027, -.57735027],
  [0, .35682209, .93417236], [0, -.35682209, .93417236], [.93417236, 0, .35682209], [-.93417236, 0, .35682209], [.35682209, .93417236, 0], [-.35682209, .93417236, 0]];
export const AX5 = [[0, .85065081, .52573111], [0, -.85065081, .52573111], [.52573111, 0, .85065081], [-.52573111, 0, .85065081], [.85065081, .52573111, 0], [-.85065081, .52573111, 0]];

const frac = (x) => x - Math.floor(x);
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function lowbias32(x) { x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0; x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0; return (x ^ (x >>> 16)) >>> 0; }
const rand01 = (x) => (lowbias32(x >>> 0) >>> 8) / 16777216;

// Tilt so no pole faces the camera. m is row-major; homes use m·p and the SDF receives m^T (world -> lattice).
export function tiltMatrix([ax, ay] = LATTICE.tilt) {
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay);
  const m = [cy, 0, -sy, sx * sy, cx, sx * cy, cx * sy, -sx, cx * cy];
  const R = new Float32Array([m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);   // column-major m
  const RT = new Float32Array(m);                                                         // column-major m^T
  return { R, RT, apply: (p) => [m[0] * p[0] + m[1] * p[1] + m[2] * p[2], m[3] * p[0] + m[4] * p[1] + m[5] * p[2], m[6] * p[0] + m[7] * p[1] + m[8] * p[2]] };
}

// Homes in R2 low-discrepancy order: every prefix covers every circle evenly, which the governor's
// "first N rows" trick and the 2k-sprite Canvas2D tier both rely on. xyz (world, tilted) + random in w.
export function buildLattice(count, set = LATTICE.set, tilt = tiltMatrix()) {
  const normals = set === 1 ? AX3 : AX5, NC = normals.length;
  const frames = normals.map((n) => { const a = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const e1 = norm(cross(n, a)); return { n, e1, e2: cross(n, e1) }; });
  const homes = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const u = frac(0.5 + i * 0.7548776662466927), v = frac(0.5 + i * 0.5698402909980532);
    const { n, e1, e2 } = frames[Math.min(NC - 1, Math.floor(u * NC))];
    const th = v * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th);
    const rho = TUBE_JITTER * Math.sqrt(rand01(i * 3 + 1)), psi = rand01(i * 3 + 2) * Math.PI * 2;
    const a = 1 + rho * Math.cos(psi), b = rho * Math.sin(psi);
    const pt = [e1[0] * ct + e2[0] * st, e1[1] * ct + e2[1] * st, e1[2] * ct + e2[2] * st];
    const p = tilt.apply([pt[0] * a + n[0] * b, pt[1] * a + n[1] * b, pt[2] * a + n[2] * b]);
    homes[i * 4] = p[0]; homes[i * 4 + 1] = p[1]; homes[i * 4 + 2] = p[2]; homes[i * 4 + 3] = rand01(i ^ 0x9e3779b9);
  }
  return homes;
}

export const CLASS = { PT: 0, NET: 1, ACC: 2, CAM: 3 };
// RFC 5737 / RFC 2606 documentation ranges only; security vocabulary only.
export const POOL = [
  ['203.0.113.7 · 443/TCP · TLS 1.3', '198.51.100.23 · 22/TCP · OPEN', '192.0.2.41 · 3389/TCP · FILTERED', 'CERT · *.example · 211 D', 'HTTP/2 · HSTS · OK', '203.0.113.19 · 8443/TCP · TLS 1.2', '198.51.100.8 · 25/TCP · STARTTLS', '192.0.2.77 · 445/TCP · CLOSED', 'SSH · ED25519 · KEX OK', 'CSP · STRICT · OK', '203.0.113.52 · 53/UDP · NO RECURSION', 'JWT · RS256 · 15 MIN'],
  ['VLAN 20 · 198.51.100.0/24', 'core-01.example · AS64496', 'RTT 4 ms · 0.0 % LOSS', '802.1X · EAP-TLS', 'DHCP · 203.0.113.1', 'VLAN 30 · 192.0.2.0/25', 'edge-02.example · BGP · UP', 'LACP · 2 × 10G · OK', 'SNMPv3 · AUTHPRIV', 'DNS · 203.0.113.53 · DNSSEC', 'MTU 9000 · JUMBO', 'NTP · STRATUM 2 · ±1 ms'],
  ['RDR-02 · OSDP v2 · SECURE', 'BADGE 0x2F11 · GRANTED', 'DOOR-04 · HELD 0 s', 'ACS · MFA · OK', 'RDR-05 · DESFire EV3', 'REX-03 · ARMED', 'BADGE 0x1A07 · DENIED', 'DOOR-09 · LOCKED · 23:12', 'PANEL-01 · TAMPER OK', 'ELEV-02 · FLOOR 4 · OK', 'TURNSTILE-01 · 1 / 1', 'ACS · AUDIT · 0 GAPS'],
  ['CAM-07 · RTSP 554 · 25 FPS', 'NVR-01 · ONVIF · 8 CH', 'CAM-03 · 2.1 m · IR ON', 'CAM-12 · H.265 · 4 MP', 'CAM-09 · PTZ · PRESET 2', 'NVR-02 · RAID 6 · 31 D', 'CAM-01 · 0.002 LUX · OK', 'CAM-15 · TLS · ONVIF S', 'LPR-02 · 98.7 % · OK', 'CAM-05 · 12 mm · F1.6', 'CAM-11 · PoE 12.9 W', 'NVR-01 · CLOCK SYNC · OK'],
];
export const ROW_READING = ['203.0.113.7 · 443/TCP · TLS 1.3', 'VLAN 20 · 198.51.100.0/24', 'RDR-02 · OSDP v2 · SECURE', 'CAM-07 · RTSP 554 · 25 FPS'];
export const FINDING = ['CAM-07 · RTSP 554 · AUTH NONE', 'FINDING · TEST RANGE'];
export const TIER0 = 'ASSET // TIER 0 · SEALED';

function dist2(h, i, j) { const dx = h[i * 4] - h[j * 4], dy = h[i * 4 + 1] - h[j * 4 + 1], dz = h[i * 4 + 2] - h[j * 4 + 2]; return dx * dx + dy * dy + dz * dz; }
function nearestIndex(h, n, p) { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (h[i * 4] - p[0]) ** 2 + (h[i * 4 + 1] - p[1]) ** 2 + (h[i * 4 + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } } return best; }

// 64 nodes by farthest-point sampling over the first 4096 homes, seeded at the front-low point.
// 48 classed (12 per class, interleaved by a fixed hash order), 16 plain (hairlines only). Text is fixed per node.
export function pickNodes(homes, count = NODES, from = Math.min(4096, homes.length / 4)) {
  const nodes = new Float32Array(count * 3), best = new Float32Array(from).fill(Infinity);
  let cur = nearestIndex(homes, from, [0, -0.3, 1]);
  for (let k = 0; k < count; k++) {
    nodes[k * 3] = homes[cur * 4]; nodes[k * 3 + 1] = homes[cur * 4 + 1]; nodes[k * 3 + 2] = homes[cur * 4 + 2];
    let far = -1, farD = -1;
    for (let i = 0; i < from; i++) { const d = dist2(homes, i, cur); if (d < best[i]) best[i] = d; if (best[i] > farD) { farD = best[i]; far = i; } }
    cur = far;
  }
  const order = [...Array(count).keys()].sort((a, b) => lowbias32(a + 11) - lowbias32(b + 11));
  const nodeClass = new Int8Array(count).fill(-1), nodeText = new Array(count).fill(null), counters = [0, 0, 0, 0];
  order.slice(0, 48).forEach((n, j) => { const c = j % 4; nodeClass[n] = c; nodeText[n] = POOL[c][counters[c]++ % POOL[c].length]; });
  return { nodes, nodeClass, nodeText };
}

export function createShape({ count, set = LATTICE.set }) {
  const tilt = tiltMatrix();
  const homes = buildLattice(count, set, tilt);
  const { nodes, nodeClass, nodeText } = pickNodes(homes);
  return { homes, count, nodes, nodeClass, nodeText, rot: tilt.R, rotT: tilt.RT, set, shapeId: set === 1 ? 0 : 1 };
}
