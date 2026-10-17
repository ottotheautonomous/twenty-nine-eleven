// The flow: each ring's dust slides along its own ring (DEPTH-SPEC §2). Each ring k turns its grains about its own axis at
// omega0 * m_k * dir_k * (1 + vary * sin(2 pi t / P_k + ph_k)) * gain. Phases integrate the model's clock (pauses, clamped dt).
// gain: the entrance ease (FLOW.easeIn after the simulation starts), times the resume ease: after a pause, a panel or a hidden tab
// (sentinel.setActive(true) calls resume()) the dust re-eases from rest to its pace over FLOW.resume ms instead of restarting at full
// pace in one frame.
import { AX3, AX5, tiltMatrix } from './shape.js';
import { FLOW as FLOW_CFG } from './constants.js';

const TABLES = {   // compose.mjs: stratified multipliers 0.62..1.38 shuffled + directions, chosen for net-spin coherence
  a: { seed: 8898, m: FLOW_CFG.m, s: FLOW_CFG.dir },                                                               // coh .30, axis vertical
  b: { seed: 17434, m: [1.38, 1.127, 1.042, 0.873, 0.704, 1.211, 0.958, 1.296, 0.62, 0.789], s: [1, -1, 1, -1, -1, -1, -1, 1, 1, -1] }, // coh .10
  c: { seed: 1495, m: [1.38, 0.789, 0.958, 0.704, 1.042, 1.296, 0.62, 1.127, 0.873, 1.211], s: [-1, -1, 1, -1, -1, -1, 1, 1, -1, -1] }, // coh .45
};
const P = FLOW_CFG.period, PH = FLOW_CFG.phase;
const debugHooks = import.meta.env.DEV || import.meta.env.VITE_DEBUG_HOOKS === '1';
const Q = debugHooks ? new URLSearchParams(location.search) : new URLSearchParams();
if (Q.has('lap') && Number.isFinite(+Q.get('lap')) && +Q.get('lap') > 0) FLOW_CFG.lap = +Q.get('lap');
if (Q.has('depth') && Number.isFinite(+Q.get('depth'))) FLOW_CFG.depth = +Q.get('depth');
export const FLOW = {
  get lap() { return FLOW_CFG.lap; },
  set lap(v) { FLOW_CFG.lap = v; },
  get vary() { return FLOW_CFG.vary; },
  set vary(v) { FLOW_CFG.vary = v; },
  get depth() { return FLOW_CFG.depth; },
  set depth(v) { FLOW_CFG.depth = v; },
  easeIn: FLOW_CFG.easeIn / 1000, resume: FLOW_CFG.resume / 1000,   // s (the constants are ms)
  off: Q.has('flowoff') || Q.get('flow') === '0',
};
export function createFlow(set = 1) {
  const normals = set === 1 ? AX3 : AX5, T = tiltMatrix(), N = normals.length;
  const tab = TABLES[Q.get('coh') || Q.get('table') || 'a'] || TABLES.a;
  const axes = new Float32Array(30), rot = new Float32Array(30);
  normals.forEach((n, k) => axes.set(T.apply(n), k * 3));
  const phi = new Float64Array(N);
  let t = 0, gain = 0, started = -1, resumeAt = -1, resumePending = false, last = 0;
  const smooth = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  for (let k = 0; k < N; k++) rot.set([1, 0, 0], k * 3);
  return {
    N, axes, rot, get gain() { return gain; },
    // The next step starts the re-ease, live or not: a closing panel renders the dust before the scene is live again ('closed'), so
    // waiting for live ran it at full pace through the close and then cut it to rest. None before the start or during the entrance ease.
    resume() { resumePending = true; if (started >= 0 && last - started >= FLOW.easeIn) gain = 0; },   // at rest from here (the reading too)
    step(dt, sceneTime, live) {
      if (FLOW.off) return;
      last = sceneTime;
      if (live && started < 0) started = sceneTime;
      if (resumePending) { resumePending = false; if (started >= 0 && sceneTime - started >= FLOW.easeIn) resumeAt = sceneTime; }
      gain = started < 0 ? 0 : smooth((sceneTime - started) / FLOW.easeIn);
      if (resumeAt >= 0) { const x = (sceneTime - resumeAt) / FLOW.resume; if (x >= 1) resumeAt = -1; else gain *= smooth(x); }
      t += dt;
      const w0 = 2 * Math.PI / Math.max(1, FLOW_CFG.lap);
      for (let k = 0; k < N; k++) {
        const kk = k % 10, w = w0 * tab.m[kk] * tab.s[kk] * (1 + FLOW_CFG.vary * Math.sin(2 * Math.PI * t / P[kk] + PH[kk])) * gain;
        const d = w * dt; phi[k] = (phi[k] + d) % (2 * Math.PI);
        rot[k * 3] = Math.cos(phi[k]); rot[k * 3 + 1] = Math.sin(phi[k]); rot[k * 3 + 2] = d;
      }
    },
    // CPU twin for canvas2d / probes: rotate home (x,y,z) of ring k
    apply(k, x, y, z, out) {
      const nx = axes[k * 3], ny = axes[k * 3 + 1], nz = axes[k * 3 + 2], c = rot[k * 3], s = rot[k * 3 + 1], dt = nx * x + ny * y + nz * z;
      out[0] = x * c + (ny * z - nz * y) * s + nx * dt * (1 - c); out[1] = y * c + (nz * x - nx * z) * s + ny * dt * (1 - c); out[2] = z * c + (nx * y - ny * x) * s + nz * dt * (1 - c);
      return out;
    },
    ringOf(x, y, z) { let best = 1e9, kb = 0; for (let k = 0; k < N; k++) { const d = Math.abs(axes[k * 3] * x + axes[k * 3 + 1] * y + axes[k * 3 + 2] * z); if (d < best) { best = d; kb = k; } } return kb; },
  };
}
export const FLOW_GLSL = `
uniform vec3 uFlowAx[10]; uniform vec3 uFlowRot[10]; uniform int uFlowN;
vec3 flowHome(vec3 h, int kf) {
  vec3 n = uFlowAx[kf], cs = uFlowRot[kf];
  return h * cs.x + cross(n, h) * cs.y + n * dot(n, h) * (1.0 - cs.x);
}
`;
