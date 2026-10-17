// SPDX-License-Identifier: 0BSD
// Written for Twenty Nine Eleven (2026); procedural, no data files. The far-background brain ("the mind behind the keep"):
// generated in a module worker (brain.worker.js), never on the main thread. No meshes, no data files.
// Brain-local frame: x = lateral (left hemisphere x < 0), y = up, z = anterior. Length (z) ~1.0, width ~0.84, height ~0.62.
// Output: surface + subcortical points with a region id and 7 network weights, k-NN "synapse" edges that never cross
// a sulcus or a fissure, and long-range tracts (bundles of strands) per network.

function lowbias32(x) { x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0; x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0; return (x ^ (x >>> 16)) >>> 0; }
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
import { NET_WORDS, THAL } from './brain-networks.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = clamp(0.5 + 0.5 * (b - a) / k); return b + (a - b) * h - k * h * (1 - h); };

// 3D gradient noise (Perlin-style, hashed lattice gradients), range ~[-1, 1].
const G = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(ix, iy, iz, x, y, z, seed) { const g = G[lowbias32(ix * 73856093 ^ iy * 19349663 ^ iz * 83492791 ^ seed) % 12]; return g[0] * x + g[1] * y + g[2] * z; }
export function noise3(x, y, z, seed = 7) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(grad(ix, iy, iz, fx, fy, fz, seed), grad(ix + 1, iy, iz, fx - 1, fy, fz, seed), u), l(grad(ix, iy + 1, iz, fx, fy - 1, fz, seed), grad(ix + 1, iy + 1, iz, fx - 1, fy - 1, fz, seed), u), v),
           l(l(grad(ix, iy, iz + 1, fx, fy, fz - 1, seed), grad(ix + 1, iy, iz + 1, fx - 1, fy, fz - 1, seed), u), l(grad(ix, iy + 1, iz + 1, fx, fy - 1, fz - 1, seed), grad(ix + 1, iy + 1, iz + 1, fx - 1, fy - 1, fz - 1, seed), u), v), w) * 1.6;
}

function sdEllipsoid(x, y, z, cx, cy, cz, rx, ry, rz) {   // iq's bound
  const a = (x - cx) / rx, b = (y - cy) / ry, c = (z - cz) / rz;
  const k0 = Math.sqrt(a * a + b * b + c * c), qa = a / rx, qb = b / ry, qc = c / rz, k1 = Math.sqrt(qa * qa + qb * qb + qc * qc);
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function sdCapsule(x, y, z, a, b, r) {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz));
  const ex = pax - bax * h, ey = pay - bay * h, ez = paz - baz * h;
  return Math.sqrt(ex * ex + ey * ey + ez * ez) - r;
}

// One cerebral hemisphere (s = -1 left, +1 right): a drooping, tapering ellipsoid with a temporal lobe, a flat medial wall.
function cerebrum(x, y, z, s) {
  const droop = 0.05 * smoothstep(0.1, 0.48, z);                        // frontal pole sits lower
  const taper = 1 - 0.2 * smoothstep(-0.15, -0.5, z);                   // occipital narrower
  const dome = 0.03 * smoothstep(0.25, -0.1, z) * smoothstep(-0.5, -0.2, z);   // parietal crown a little higher
  let d = sdEllipsoid((x - s * 0.2) / taper + s * 0.2, y + droop - dome, z, s * 0.2, 0.05, -0.02, 0.2, 0.26, 0.48);
  d = Math.max(d, -(y + 0.135) - 0.4 * smoothstep(0.12, 0.0, z));      // flat orbital base under the frontal lobe only
  const t = sdEllipsoid(x, y, z, s * 0.245, -0.135, -0.04, 0.13, 0.11, 0.245);   // temporal lobe, its pole under the frontal lobe
  d = smin(d, t, 0.03);                                                  // small blend: the Sylvian crease survives
  d = Math.max(d, 0.010 - s * x);                                        // medial wall (longitudinal fissure)
  return d;
}
function cerebellum(x, y, z) {
  const a = sdEllipsoid(x, y, z, -0.1, -0.235, -0.31, 0.13, 0.085, 0.11), b = sdEllipsoid(x, y, z, 0.1, -0.235, -0.31, 0.13, 0.085, 0.11);
  return smin(a, b, 0.04);
}
const STEM_A = [0, -0.12, -0.12], STEM_B = [0, -0.42, -0.19];
const brainstem = (x, y, z) => sdCapsule(x, y, z, STEM_A, STEM_B, 0.045);

// Landmark fissures (implicit): central sulcus (precentral = motor strip ahead of it), lateral (Sylvian) fissure, parieto-occipital.
const centralS = (y, z) => z - (-0.05 + 0.19 * (0.26 - y) / 0.36);
const sylvian = (y, z) => y - (-0.055 - 0.22 * z);                      // < 0 below = temporal
const parOcc = (y, z) => z - (-0.31 + 0.1 * (y - 0.05));

export const REGION = ['prefrontal', 'premotor', 'motor', 'somatosensory', 'parietal', 'temporal', 'occipital', 'cerebellum', 'brainstem', 'limbic', 'thalamus', 'callosum'];
function regionOf(x, y, z, part) {
  if (part === 1) return 7; if (part === 2) return 8; if (part === 3) return 10; if (part === 4) return 9; if (part === 5) return 11;
  const cs = centralS(y, z);
  if (Math.abs(x) < 0.05 && y > -0.08 && y < 0.17 && z > -0.28 && z < 0.3) return 9;     // cingulate band on the medial wall
  if (parOcc(y, z) < 0) return 6;
  if (sylvian(y, z) < 0 && Math.abs(x) > 0.13 && z < 0.3) return 5;
  if (cs > 0 && cs < 0.075) return 2;
  if (cs <= 0 && cs > -0.075) return 3;
  if (cs < 0) return 4;
  return z > 0.2 ? 0 : 1;
}

// Network anchors (cortical patches, brain-local units). L = x < 0. Radii in units.
const A = {
  M1L: [-0.29, 0.19, -0.01], M1R: [0.29, 0.19, -0.01], SMA: [0, 0.29, 0.05], CBL: [-0.12, -0.26, -0.34], CBR: [0.12, -0.26, -0.34],
  BS: [0, -0.4, -0.18], THL: [-0.06, -0.04, -0.05], THR: [0.06, -0.04, -0.05],
  S1L: [-0.3, 0.17, -0.09], IPLL: [-0.33, 0.08, -0.15], PMVL: [-0.33, 0.03, 0.12], MTGL: [-0.37, -0.13, -0.17],
  DLPFCL: [-0.24, 0.13, 0.31], DLPFCR: [0.24, 0.13, 0.31], PPCL: [-0.23, 0.2, -0.21], PPCR: [0.23, 0.2, -0.21], ACC: [0, 0.1, 0.2],
  V1L: [-0.06, 0.0, -0.47], V1R: [0.06, 0.0, -0.47], FFAL: [-0.2, -0.2, -0.22], FFAR: [0.2, -0.2, -0.22], MTL: [-0.33, -0.05, -0.3], MTR: [0.33, -0.05, -0.3],
  BROCA: [-0.31, -0.03, 0.21], WERN: [-0.36, -0.06, -0.12], AGL: [-0.31, 0.06, -0.24], AGR: [0.31, 0.06, -0.24],
  MPFC: [0, 0.07, 0.4], PCC: [0, 0.11, -0.22], HCL: [-0.21, -0.17, -0.06], HCR: [0.21, -0.17, -0.06],
  SPLR: [0.2, 0.24, -0.19], FEFR: [0.22, 0.24, 0.08], FEFL: [-0.22, 0.24, 0.08], IPLR: [0.33, 0.08, -0.15],
};
// Seven networks: anchors lit (patch radius) and tracts [from, to, bow]. bow > 0 bends the tract through the white matter.
const DEEP = new Set(['BS', 'THL', 'THR', 'HCL', 'HCR', 'CBL', 'CBR']);
let snapped = false;
function snapAnchors() {
  if (snapped) return; snapped = true;
  for (const [name, p] of Object.entries(A)) {
    if (DEEP.has(name) || Math.abs(p[0]) < 0.05) continue;                 // deep and medial anchors stay where they are
    const s = Math.sign(p[0]), c = [s * 0.17, -0.02, -0.02];
    let dir = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; const l = Math.hypot(...dir); dir = dir.map((v) => v / l);
    let lo = 0, hi = 0.6;
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; const d = sdf(c[0] + dir[0] * m, c[1] + dir[1] * m, c[2] + dir[2] * m)[0]; if (d < 0) lo = m; else hi = m; }
    A[name] = [c[0] + dir[0] * lo, c[1] + dir[1] * lo, c[2] + dir[2] * lo];
  }
}
export const NETWORKS = [
  { word: 'CNC', hubs: ['M1L'], entry: ['THL'], weight: 1.15, name: 'motor loop (M1, SMA, cerebellum, corticospinal)', anchors: [['M1L', 0.09], ['M1R', 0.09], ['SMA', 0.08], ['CBL', 0.11], ['CBR', 0.11], ['BS', 0.06]],
    tracts: [['M1L', 'BS', 0.5, 0], ['M1R', 'BS', 0.5, 0], ['CBL', 'BS', 0.3], ['CBR', 'BS', 0.3], ['CBR', 'THL', 0.4], ['THL', 'M1L', 0.4], ['SMA', 'M1L', 0.2], ['SMA', 'M1R', 0.2]] },
  { word: 'Fabrication', hubs: ['IPLL'], entry: ['THL'], name: 'tool-use / sensorimotor (S1, IPL, ventral premotor, pMTG)', anchors: [['S1L', 0.08], ['IPLL', 0.08], ['PMVL', 0.08], ['MTGL', 0.08]],
    tracts: [['PMVL', 'IPLL', 0.35], ['IPLL', 'MTGL', 0.3], ['S1L', 'IPLL', 0.2], ['PMVL', 'S1L', 0.25], ['PMVL', 'MTGL', 0.45]] },
  { word: 'Applied AI', hubs: ['DLPFCL'], entry: ['THL'], tractLevel: 10, name: 'frontoparietal control (DLPFC, PPC, ACC)', anchors: [['DLPFCL', 0.1], ['DLPFCR', 0.1], ['PPCL', 0.09], ['PPCR', 0.09], ['ACC', 0.07]],
    tracts: [['DLPFCL', 'PPCL', 0.6, 0], ['DLPFCR', 'PPCR', 0.6, 0], ['DLPFCL', 'DLPFCR', 0.5, 0], ['DLPFCL', 'ACC', 0.4, 0.05], ['DLPFCR', 'ACC', 0.4, 0.05], ['PPCL', 'PPCR', 0.5, 0]] },   // the SLF dives through the white matter (a U, not a chord on the crown); no lift on crown tracts
  { word: 'Computer vision', hubs: ['V1L', 'V1R'], entry: ['THL', 'THR'], name: 'visual streams (V1, optic radiation, ventral + dorsal)', anchors: [['V1L', 0.11], ['V1R', 0.11], ['FFAL', 0.08], ['FFAR', 0.08], ['MTL', 0.07], ['MTR', 0.07]],
    tracts: [['THL', 'V1L', 0.35], ['THR', 'V1R', 0.35], ['V1L', 'FFAL', 0.25], ['V1R', 'FFAR', 0.25], ['V1L', 'MTL', 0.2], ['V1R', 'MTR', 0.2], ['MTR', 'PPCR', 0.25], ['MTL', 'PPCL', 0.25]] },
  { word: 'Software', hubs: ['WERN'], entry: ['THL'], name: 'language (Broca, Wernicke, arcuate, angular, MTG)', anchors: [['BROCA', 0.085], ['WERN', 0.085], ['AGL', 0.07], ['MTGL', 0.07]],
    tracts: [['BROCA', 'WERN', 0.3, 0.55], ['BROCA', 'WERN', 0.35, 0.7], ['WERN', 'AGL', 0.2], ['BROCA', 'MTGL', 0.35], ['AGL', 'MTGL', 0.2]] },
  { word: 'Creative production', hubs: ['PCC'], entry: ['THL'], name: 'default mode (mPFC, PCC/precuneus, angular, hippocampus)', anchors: [['MPFC', 0.1], ['PCC', 0.1], ['AGL', 0.07], ['AGR', 0.07], ['HCL', 0.06], ['HCR', 0.06]],
    tracts: [['MPFC', 'PCC', 0.25], ['PCC', 'AGL', 0.3], ['PCC', 'AGR', 0.3], ['PCC', 'HCL', 0.3], ['PCC', 'HCR', 0.3], ['MPFC', 'HCL', 0.4], ['MPFC', 'HCR', 0.4]] },
  { word: 'Design', hubs: ['SPLR'], entry: ['THR'], strands: 2, spread: 0.06, weight: 1.3, name: 'right visuospatial / dorsal attention (SPL, IPS, FEF, MT)', anchors: [['SPLR', 0.1], ['FEFR', 0.08], ['IPLR', 0.08], ['MTR', 0.07], ['FEFL', 0.06]],
    tracts: [['FEFR', 'SPLR', 0.3], ['SPLR', 'MTR', 0.25], ['FEFR', 'IPLR', 0.35], ['FEFL', 'FEFR', 0.5], ['SPLR', 'IPLR', 0.15]] },
];
NETWORKS.forEach((N, i) => { if (N.word !== NET_WORDS[i]) throw new Error(`brain: network ${i} is ${N.word}, row 2 says ${NET_WORDS[i]}`); });

const OUT = [0, 0];
function sdf(x, y, z) {   // returns [distance, part] (a shared array: read it at once) part: 0 cerebrum, 1 cerebellum, 2 brainstem
  const c = x < 0 ? cerebrum(x, y, z, -1) : cerebrum(x, y, z, 1), cb = cerebellum(x, y, z), bs = brainstem(x, y, z);
  if (c <= cb && c <= bs) { OUT[0] = c; OUT[1] = 0; } else if (cb <= bs) { OUT[0] = cb; OUT[1] = 1; } else { OUT[0] = bs; OUT[1] = 2; }
  return OUT;
}

// Every network's signal leaves the thalamus (behind the ember) by an entry tract to its hub (phase offset 0);
// tracts leaving a hub run next (0.45), oriented hub -> out; the rest last (0.8), oriented from the end nearer a hub.
export { THAL };
export function planTracts(N) {
  const hubs = new Set(N.hubs), out = [], same = (t, a, b) => (t[0] === a && t[1] === b) || (t[0] === b && t[1] === a);
  const entries = N.hubs.map((h, k) => [N.entry[Math.min(k, N.entry.length - 1)], h, 0.35, 0.1, 0]);
  const rest = N.tracts.filter((t) => !entries.some((e) => same(t, e[0], e[1])));
  const near = new Set();
  for (const t of rest) { if (hubs.has(t[0])) near.add(t[1]); if (hubs.has(t[1])) near.add(t[0]); }
  for (const [a, b, bow, lift] of rest) {
    if (hubs.has(a)) out.push([a, b, bow, lift, 0.45]);
    else if (hubs.has(b)) out.push([b, a, bow, lift, 0.45]);
    else if (near.has(b) && !near.has(a)) out.push([b, a, bow, lift, 0.8]);
    else out.push([a, b, bow, lift, 0.8]);
  }
  return [...entries, ...out];
}

// opts: points (surface + deep), k (neighbours), tractSegs, seed, foldFreq (strands per tract: NETWORKS[i].strands ?? 3)
export function buildBrain({ points = 5000, k = 3, maxDegree = 4, tractSegs = 20, seed = 2911, foldFreq = 8.5, deepShare = 0.06, sulcus = 0.09, bridges = 0.02 } = {}) {
  const foldAt = (x, y, z, pt) => {
    if (pt === 1) return Math.sin((y + 0.03 * noise3(x * 6, y * 6, z * 6, seed)) * 95);   // cerebellar folia
    if (pt !== 0) return 1;
    const f = foldFreq, w = 0.55;
    return noise3(x * f + w * noise3(x * 3, y * 3, z * 3, seed + 1), y * f + w * noise3(x * 3 + 5, y * 3, z * 3, seed + 2), z * f + w * noise3(x * 3, y * 3 + 9, z * 3, seed + 3), seed);
  };
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  snapAnchors();
  const R = rng(seed);
  const nSurf = Math.round(points * (1 - deepShare)), nDeep = points - nSurf;
  // 1. surface candidates: rejection-sample the SDF shell, then Poisson-disc thin to an even spacing.
  const area = 2.3;                                                     // approx. surface area (units^2) incl. cerebellum + stem
  const rmin = 0.82 * Math.sqrt(area / nSurf);
  const cell = rmin, gx = Math.ceil(1.0 / cell) + 2, grid = new Map();
  const key = (x, y, z) => (Math.floor((x + 0.5) / cell) * 4096 + Math.floor((y + 0.55) / cell)) * 4096 + Math.floor((z + 0.55) / cell);
  const P = [], part = [], fold = [];
  // coarse occupancy grid: only cells the surface passes through are sampled (acceptance ~40 % instead of ~2 %)
  const GN = 36, gs = 1.1 / GN, ox = -0.55, oy = -0.55, oz = -0.58, shellCells = [];
  for (let a = 0; a < GN; a++) for (let b = 0; b < GN; b++) for (let c = 0; c < GN; c++) {
    const [d] = sdf(ox + (a + 0.5) * gs, oy + (b + 0.5) * gs, oz + (c + 0.5) * gs);
    if (Math.abs(d) < gs * 0.9) shellCells.push(a, b, c);
  }
  const NC = shellCells.length / 3;
  let misses = 0;
  while (P.length < nSurf && misses < nSurf * 60) {
    const ci = Math.floor(R() * NC) * 3;
    const x = ox + (shellCells[ci] + R()) * gs, y = oy + (shellCells[ci + 1] + R()) * gs, z = oz + (shellCells[ci + 2] + R()) * gs;
    const [d, pt] = sdf(x, y, z);
    if (Math.abs(d) > 0.006) { misses++; continue; }
    if (pt < 2 && Math.abs(foldAt(x, y, z, pt)) < sulcus) { misses++; continue; }   // sulci are empty channels
    if (pt === 0 && Math.abs(x) < 0.02 && !(y > -0.08 && y < 0.17 && z > -0.28 && z < 0.3) && R() < 0.7) { misses++; continue; }   // a sparse medial wall (its rim read as a bright oval)
    let near = false;
    for (let a = -1; a <= 1 && !near; a++) for (let b = -1; b <= 1 && !near; b++) for (let c = -1; c <= 1 && !near; c++) {
      const L = grid.get(key(x + a * cell, y + b * cell, z + c * cell)); if (!L) continue;
      for (const i of L) if ((P[i][0] - x) ** 2 + (P[i][1] - y) ** 2 + (P[i][2] - z) ** 2 < rmin * rmin) { near = true; break; }
    }
    if (near) { misses++; continue; }
    const i = P.length; P.push([x, y, z]); part.push(pt);
    fold.push(foldAt(x, y, z, pt));
    const kk = key(x, y, z); (grid.get(kk) || grid.set(kk, []).get(kk)).push(i);
  }
  // 2. deep structures: thalami, hippocampi (curved tubes in the temporal lobes), the callosal arch.
  for (let i = 0; i < nDeep; i++) {
    const u = R(), sgn = R() < 0.5 ? -1 : 1;
    if (u < 0.3) { const th = R() * Math.PI * 2, ph = Math.acos(2 * R() - 1); P.push([sgn * 0.065 + 0.035 * Math.sin(ph) * Math.cos(th), -0.04 + 0.03 * Math.cos(ph), -0.05 + 0.05 * Math.sin(ph) * Math.sin(th)]); part.push(3); }
    else if (u < 0.6) { const s = R(); P.push([sgn * (0.2 - 0.03 * s), -0.19 + 0.09 * s * s, 0.04 - 0.22 * s]); part.push(4); }
    else { const s = R() * 2 - 1; P.push([(R() - 0.5) * 0.3, 0.09 - 0.07 * s * s, 0.24 * s]); part.push(5); }
    fold.push(1);
  }
  const n = P.length;
  const pos = new Float32Array(n * 3), region = new Uint8Array(n), net = new Uint8Array(n * 8);   // 7 network weights (0..255) + depth flag
  const lant = new Uint8Array(n * 8);   // 7 lantern footprint weights, 1 within 0.8 r of a lit anchor -> 0 at 2.4 r: the explored memory's edges (D2)
  for (let i = 0; i < n; i++) {
    const [x, y, z] = P[i]; pos.set(P[i], i * 3);
    region[i] = regionOf(x, y, z, part[i]);
    NETWORKS.forEach((N, j) => {
      let w = 0;
      let lw = 0;
      for (const [a, r] of N.anchors) { const c = A[a], d = Math.hypot(x - c[0], y - c[1], z - c[2]); w = Math.max(w, 1 - smoothstep(r * 0.55, r, d)); lw = Math.max(lw, 1 - smoothstep(r * 0.8, r * 2.4, d)); }
      net[i * 8 + j] = Math.round(w * 255); lant[i * 8 + j] = Math.round(lw * 255);
    });
    net[i * 8 + 7] = part[i] >= 3 ? 255 : 0;
  }
  // 3. synapses: k nearest within rmax, never across a sulcus (fold sign change), a fissure, or the midline.
  const rmax = rmin * 2.3, edges = [], deg = new Uint8Array(n), seen = new Set();
  const cell2 = rmax, grid2 = new Map(), key2 = (x, y, z) => (Math.floor((x + 0.5) / cell2) * 4096 + Math.floor((y + 0.55) / cell2)) * 4096 + Math.floor((z + 0.55) / cell2);
  for (let i = 0; i < n; i++) { const kk = key2(P[i][0], P[i][1], P[i][2]); (grid2.get(kk) || grid2.set(kk, []).get(kk)).push(i); }
  const cand = [];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = P[i]; cand.length = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const L = grid2.get(key2(x + a * cell2, y + b * cell2, z + c * cell2)); if (!L) continue;
      for (const j of L) { if (j === i) continue; const d2 = (P[j][0] - x) ** 2 + (P[j][1] - y) ** 2 + (P[j][2] - z) ** 2; if (d2 < rmax * rmax) cand.push([d2, j]); }
    }
    cand.sort((p, q) => p[0] - q[0]);
    let made = 0;
    for (const [, j] of cand) {
      if (made >= k) break;
      if (deg[i] >= maxDegree || deg[j] >= maxDegree) continue;
      const pi = part[i], pj = part[j];
      if ((pi >= 3) !== (pj >= 3)) continue;                                 // deep never wires to cortex by proximity
      if (pi !== pj && pi < 3) continue;                                     // cerebrum / cerebellum / stem stay separate
      if (pi === 0 || pi === 1) {
        if (fold[i] * fold[j] < 0 && R() > bridges) continue;                // a sulcus between them (a few bridges keep it one web)
        if (Math.sign(P[i][0]) !== Math.sign(P[j][0]) && pi === 0) continue; // longitudinal fissure
        if (pi === 0 && (Math.sign(centralS(P[i][1], P[i][2])) !== Math.sign(centralS(P[j][1], P[j][2])) ||
            (Math.abs(P[i][0]) > 0.13 && Math.sign(sylvian(P[i][1], P[i][2])) !== Math.sign(sylvian(P[j][1], P[j][2]))))) continue;
      }
      const e = i < j ? i * 65536 + j : j * 65536 + i;
      if (seen.has(e)) continue;
      seen.add(e); edges.push(i, j); deg[i]++; deg[j]++; made++;
    }
  }
  // 4. tracts: cubic arcs between anchors, bowed toward the centre (white matter), as N.strands (3; Design 2, wider) jittered strands.
  const tractVerts = [], tractNet = [], tractT = [], tractOff = [];            // segment list (pairs of xyz), network id, param along the tract, phase offset
  const strands = [], strandNet = [], strandOff = [], strandTract = [];        // per strand: [first tract vertex, vertex count], network, phase offset, tract
  let tractNo = 0;
  NETWORKS.forEach((N, j) => planTracts(N).forEach(([a, b, bow, lift = 0.1, off = 0.8]) => {
    const p0 = A[a], p3 = A[b], tk = tractNo++;
    // control points dive toward the white-matter core of the hemisphere (U-fibres); a cross-hemisphere tract arches over the callosum
    const sa = Math.abs(p0[0]) < 0.05 ? Math.sign(p3[0]) : Math.sign(p0[0]), sb = Math.abs(p3[0]) < 0.05 ? Math.sign(p0[0]) : Math.sign(p3[0]);
    const core = sa === sb ? [sa * 0.1, -0.01, (p0[2] + p3[2]) / 2 * 0.6] : [0, 0.1, (p0[2] + p3[2]) / 2];
    const ctl = (p, q) => [p[0] + (core[0] - p[0]) * bow + (q[0] - p[0]) * 0.22, p[1] + (core[1] - p[1]) * bow + (q[1] - p[1]) * 0.22, p[2] + (core[2] - p[2]) * bow + (q[2] - p[2]) * 0.22];
    const p1 = ctl(p0, p3), p2 = ctl(p3, p0);
    const len = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    p1[1] += lift * len; p2[1] += lift * len;                              // arcs read in a side view too (the arcuate's C, the SLF's bow)
    const nStrands = N.strands ?? 3, spread = N.spread ?? 0.03;
    for (let s = 0; s < nStrands; s++) {
      const jx = (R() - 0.5) * spread, jy = (R() - 0.5) * spread, jz = (R() - 0.5) * spread;
      let prev = null;
      strands.push(tractVerts.length / 3, tractSegs * 2); strandNet.push(j); strandOff.push(off); strandTract.push(tk);
      for (let q = 0; q <= tractSegs; q++) {
        const t = q / tractSegs, it = 1 - t, w = Math.sin(Math.PI * t);      // strands fan at the ends, bundle in the middle
        const b0 = it * it * it, b1 = 3 * it * it * t, b2 = 3 * it * t * t, b3 = t * t * t;
        const p = [b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0] + jx * (1 - 0.6 * w), b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1] + jy * (1 - 0.6 * w), b0 * p0[2] + b1 * p1[2] + b2 * p2[2] + b3 * p3[2] + jz * (1 - 0.6 * w)];
        if (prev) { tractVerts.push(...prev, ...p); tractNet.push(j, j); tractT.push((q - 1) / tractSegs, t); tractOff.push(off, off); }
        prev = p;
      }
    }
  }));
  const ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  const anchors = Object.fromEntries(Object.entries(A).map(([k, p]) => [k, p.slice()]));   // after snapping: plain name -> [x, y, z]
  const netAnchors = NETWORKS.map((N) => N.anchors.map(([a]) => a));                     // anchor names per network (the main thread has no NETWORKS)
  const tractLevels = NETWORKS.map((N) => N.tractLevel ?? null);                          // per-network lit-arc level overrides (BUILD-SPEC §1 trim order)
  const netWeight = NETWORKS.map((N) => N.weight ?? 1);                                   // a network's lit weight: Design x1.3 (far side), CNC x1.15 (its cortex sits in the cage disc)
  return { n, pos, region, net, edges: new Uint16Array(edges), tracts: { verts: new Float32Array(tractVerts), net: new Uint8Array(tractNet), t: new Float32Array(tractT), off: new Float32Array(tractOff) }, lant,
    strands: new Uint32Array(strands), strandNet: new Uint8Array(strandNet), strandOff: new Float32Array(strandOff), strandTract: new Uint16Array(strandTract), anchors, netAnchors, tractLevels, netWeight, networks: NETWORKS, ms: (typeof performance !== 'undefined' ? performance : Date).now() - t0, rmin };
}

// The GL vertex buffer, interleaved at stride 40: pos f32x3 @0 | net u8x8 @12 | lantern u8x8 @20 | tract f32x3 @28 (net id or -1, t,
// phase offset). Points first (n), tract vertices after (tv). Pure; runs in the worker so the main thread does one bufferData.
export const BRAIN_STRIDE = 40;
export function packBrain(b) {
  const n = b.n, T = b.tracts, tv = T.verts.length / 3, buf = new ArrayBuffer((n + tv) * BRAIN_STRIDE);
  const f = new Float32Array(buf), u8 = new Uint8Array(buf), F = BRAIN_STRIDE / 4;
  for (let i = 0; i < n; i++) {
    const o = i * F, ob = i * BRAIN_STRIDE;
    f[o] = b.pos[i * 3]; f[o + 1] = b.pos[i * 3 + 1]; f[o + 2] = b.pos[i * 3 + 2];
    for (let k = 0; k < 8; k++) { u8[ob + 12 + k] = b.net[i * 8 + k]; u8[ob + 20 + k] = b.lant[i * 8 + k]; }
    f[o + 7] = -1; f[o + 8] = 0; f[o + 9] = 0;
  }
  for (let v = 0; v < tv; v++) {
    const o = (n + v) * F;
    f[o] = T.verts[v * 3]; f[o + 1] = T.verts[v * 3 + 1]; f[o + 2] = T.verts[v * 3 + 2];
    f[o + 7] = T.net[v]; f[o + 8] = T.t[v]; f[o + 9] = T.off[v];
  }
  return buf;
}
