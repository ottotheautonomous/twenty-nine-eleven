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

export const CLASS = { PT: 0, NET: 1, ACC: 2, CAM: 3, AVL: 4, AUTO: 5, SPACE: 6 };   // CAM = Surveillance: the finding's class stays 3
export const PER_CLASS = 8;                                                             // 7 x 8 = 56 classed nodes, 8 plain (hairlines only)
// Row-1 word centres on the desktop row, as main.js rowActive maps them (theta x 1.15 rad): each class anchors its first node there.
export const ROW_LON = [-0.96, -0.61, -0.30, 0.04, 0.37, 0.69, 1.01];
// RFC 5737 / RFC 2606 documentation ranges only; security vocabulary only.
export const POOL = [
  ['203.0.113.7 · 443/TCP · TLS 1.3', '198.51.100.23 · 22/TCP · OPEN', '192.0.2.41 · 3389/TCP · FILTERED', 'CERT · *.example · 211 D', 'HTTP/2 · HSTS · OK', '203.0.113.19 · 8443/TCP · TLS 1.2', '198.51.100.8 · 25/TCP · STARTTLS', '192.0.2.77 · 445/TCP · CLOSED', 'SSH · ED25519 · KEX OK', 'CSP · STRICT · OK', '203.0.113.52 · 53/UDP · NO RECURSION', 'JWT · RS256 · 15 MIN'],
  ['VLAN 20 · 198.51.100.0/24', 'core-01.example · AS64496', 'RTT 4 ms · 0.0 % LOSS', '802.1X · EAP-TLS', 'DHCP · 203.0.113.1', 'VLAN 30 · 192.0.2.0/25', 'edge-02.example · BGP · UP', 'LACP · 2 × 10G · OK', 'SNMPv3 · AUTHPRIV', 'DNS · 203.0.113.53 · DNSSEC', 'MTU 9000 · JUMBO', 'NTP · STRATUM 2 · ±1 ms'],
  ['RDR-02 · OSDP v2 · SECURE', 'BADGE 0x2F11 · GRANTED', 'DOOR-04 · HELD 0 s', 'ACS · MFA · OK', 'RDR-05 · DESFire EV3', 'REX-03 · ARMED', 'BADGE 0x1A07 · DENIED', 'DOOR-09 · LOCKED · 23:12', 'PANEL-01 · TAMPER OK', 'ELEV-02 · FLOOR 4 · OK', 'TURNSTILE-01 · 1 / 1', 'ACS · AUDIT · 0 GAPS'],
  ['CAM-07 · RTSP 554 · 25 FPS', 'NVR-01 · ONVIF · 8 CH', 'CAM-03 · 2.1 m · IR ON', 'CAM-12 · H.265 · 4 MP', 'CAM-09 · PTZ · PRESET 2', 'NVR-02 · RAID 6 · 31 D', 'CAM-01 · 0.002 LUX · OK', 'CAM-15 · TLS · ONVIF S', 'LPR-02 · 98.7 % · OK', 'CAM-05 · 12 mm · F1.6', 'CAM-11 · PoE 12.9 W', 'NVR-01 · CLOCK SYNC · OK'],
  // 4 AV & lighting (open standards only: DMX512, sACN, RDM, AES67/PTP, DALI)
  ['DMX-U1 · 512 CH · 44 Hz', 'sACN · 203.0.113.60 · UNIV 2', 'FIX-14 · 3200 K · 62 %', 'AES67 · 48 kHz · PTP LOCK', 'AMP-02 · 70 V · 2 × 250 W', 'MATRIX-01 · 8 × 8 · 4K60', 'RDM · FIX-07 · ADDR 145', 'SPL · ZONE B · 72 dBA', 'DSP-01 · 198.51.100.40 · 2.1 ms', 'LTG · SCENE 4 · FADE 3 s', 'PROJ-01 · 5500 lm · 1212 h', 'DALI · LINE 1 · 48 / 64'],
  // 5 Automation (BACnet, KNX, Modbus, MQTT, OPC UA)
  ['192.0.2.120 · 47808/UDP · BACnet/IP', 'KNX · 1.1.14 · DIM 40 %', 'MODBUS · UNIT 3 · 502/TCP', 'MQTT · 203.0.113.88 · 8883/TLS', 'HVAC-02 · 21.5 °C · AUTO', 'AHU-01 · 420 Pa · FAN 62 %', 'OPC UA · 4840/TCP · SIGNED', 'RELAY-06 · 16 A · CLOSED', 'BLIND-03 · 45 % · TILT 30°', 'PLC-01 · CYCLE 4 ms · RUN', 'METER-01 · 3.2 kW · PF 0.98', 'SCHED · SUNSET −20 min · SET'],
  // 6 Spatial design (zones, areas, light levels, occupancy, sightlines, egress)
  ['ZONE A · 124 m² · 500 lx', 'SIGHTLINE · 14.2 m · CLEAR', 'LIGHT · 3000 K · CRI 92', 'OCC · ZONE B · 18 / 40', 'EGRESS · 1.2 m · 2 ROUTES', 'COVERAGE · 92° · 0 BLIND', 'RT60 · 0.6 s · OK', 'DAYLIGHT · DF 2.4 % · OK', 'ZONE C · 48 m² · 300 lx', 'CEILING · 2.9 m · PLENUM 0.4 m', 'GRID · 7.5 m · 600 × 600', 'PLAN · L2 · REV C'],
];
// Each word's hover reading is its pool's first entry, which is also its anchor node's own text (slot 0): one voice per node.
export const ROW_READING = ['203.0.113.7 · 443/TCP · TLS 1.3', 'VLAN 20 · 198.51.100.0/24', 'RDR-02 · OSDP v2 · SECURE', 'CAM-07 · RTSP 554 · 25 FPS',
  'DMX-U1 · 512 CH · 44 Hz', '192.0.2.120 · 47808/UDP · BACnet/IP', 'ZONE A · 124 m² · 500 lx'];
export const FINDING = ['CAM-07 · RTSP 554 · AUTH NONE', 'FINDING · TEST RANGE'];
export const TIER0 = 'ASSET // TIER 0 · SEALED';

function dist2(h, i, j) { const dx = h[i * 4] - h[j * 4], dy = h[i * 4 + 1] - h[j * 4 + 1], dz = h[i * 4 + 2] - h[j * 4 + 2]; return dx * dx + dy * dy + dz * dz; }
function nearestIndex(h, n, p) { let best = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = (h[i * 4] - p[0]) ** 2 + (h[i * 4 + 1] - p[1]) ** 2 + (h[i * 4 + 2] - p[2]) ** 2; if (d < bd) { bd = d; best = i; } } return best; }

// 64 nodes by farthest-point sampling over the first 4096 homes, seeded at the front-low point.
// 56 classed (7 classes x 8: an anchor on the lower front rim under each row-1 word, the rest spread by a farthest-member
// rule in a fixed hash order), 8 plain (hairlines only). Text is fixed per node.
export function pickNodes(homes, count = NODES, from = Math.min(4096, homes.length / 4)) {
  const nodes = new Float32Array(count * 3), best = new Float32Array(from).fill(Infinity);
  let cur = nearestIndex(homes, from, [0, -0.3, 1]);
  for (let k = 0; k < count; k++) {
    nodes[k * 3] = homes[cur * 4]; nodes[k * 3 + 1] = homes[cur * 4 + 1]; nodes[k * 3 + 2] = homes[cur * 4 + 2];
    let far = -1, farD = -1;
    for (let i = 0; i < from; i++) { const d = dist2(homes, i, cur); if (d < best[i]) best[i] = d; if (best[i] > farD) { farD = best[i]; far = i; } }
    cur = far;
  }
  const K = ROW_LON.length, nodeClass = new Int8Array(count).fill(-1), nodeText = new Array(count).fill(null), counters = new Array(K).fill(0);
  const anchors = new Int8Array(K).fill(-1);
  const at = (i) => [nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2]];
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const place = (n, c) => { nodeClass[n] = c; nodeText[n] = POOL[c][counters[c]++ % POOL[c].length]; };
  // 1. anchors: one node per class, the assignment that minimises the summed distance to the words' rim points (model.js
  //    rowHover's points), each class choosing among its four nearest nodes: the pins then walk under the row, left to right
  const rims = ROW_LON.map((lon) => { const r = [Math.sin(lon), -1.2, Math.cos(lon)], l = Math.hypot(...r); return r.map((x) => x / l); });
  const cands = rims.map((p) => [...Array(count).keys()].sort((a, b) => d2(at(a), p) - d2(at(b), p)).slice(0, 4));
  let bestSum = Infinity, bestMap = null;
  (function assign(c, used, map, sum) {
    if (sum >= bestSum) return;
    if (c === K) { bestSum = sum; bestMap = [...map]; return; }
    for (const n of cands[c]) if (!used.has(n)) { used.add(n); map[c] = n; assign(c + 1, used, map, sum + Math.sqrt(d2(at(n), rims[c]))); used.delete(n); }
  })(0, new Set(), [], 0);
  bestMap.forEach((n, c) => { place(n, c); anchors[c] = n; });
  // 2. the rest in the fixed hash order: each node joins the class (with room) whose nearest member is farthest from it, so every class spreads round the cage
  const order = [...Array(count).keys()].sort((a, b) => lowbias32(a + 11) - lowbias32(b + 11)).filter((n) => nodeClass[n] < 0);
  for (const n of order.slice(0, K * PER_CLASS - K)) {
    const p = at(n); let bc = -1, bs = -Infinity;
    for (let c = 0; c < K; c++) {
      if (counters[c] >= PER_CLASS) continue;
      let dmin = Infinity; for (let i = 0; i < count; i++) if (nodeClass[i] === c) dmin = Math.min(dmin, d2(at(i), p));
      const score = dmin - 0.02 * counters[c];   // tie-break toward the emptier class
      if (score > bs) { bs = score; bc = c; }
    }
    place(n, bc);
  }
  return { nodes, nodeClass, nodeText, anchors };
}

export function createShape({ count, set = LATTICE.set }) {
  const tilt = tiltMatrix();
  const homes = buildLattice(count, set, tilt);
  const { nodes, nodeClass, nodeText, anchors } = pickNodes(homes);
  return { homes, count, nodes, nodeClass, nodeText, anchors, rot: tilt.R, rotT: tilt.RT, set, shapeId: set === 1 ? 0 : 1 };
}
