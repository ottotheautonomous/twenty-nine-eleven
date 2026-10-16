// PROTOTYPE (branch living-proto-scene, throwaway): the six row-2 signatures of LIVING-SPEC §4, keyed by data-verb.
// One reversible entrance clock per signature (tau, ms): an exit is the entrance played backwards at the same rate (x1.6 on a
// snap), so every exit mirrors its entrance exactly. A separate settle (0 -> 1 after the entrance, frozen during an exit) carries
// the "holds at N %" step-downs, so an exit never re-brightens. Hold oscillations read the page clock phi (1.9 rad/s) and fade in
// over the last 15 % of the entrance (and out with it). All light is placed in home space.
import { AX3, tiltMatrix } from './shape.js';
import { linearRGB } from './constants.js';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const wrap = (x) => ((x % TAU) + TAU) % TAU;
// cubic-bezier(x1, y1, x2, y2) as CSS/Motion evaluate it
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
    return Y(clamp(t));
  };
}
const EASE = bezier(0.22, 1, 0.36, 1);
const PHI = 1.9;                                    // the ember's breath, rad/s
// phi with a seeded offset, roughened by the scene's flicker law (never in lockstep)
const osc = (t, a, b) => Math.sin(PHI * t + a) * (0.75 + 0.25 * Math.sin(0.8 * t + b) * Math.sin(1.73 * t + 2 * b));

export const VERBS = ['resolve', 'aperture', 'compose', 'toolpath', 'key', 'edit'];
export const TONES = { glint: linearRGB('#E8F0F6'), white: linearRGB('#FFF6EA'), dawn: linearRGB('#FFD8A6'), warm: linearRGB('#FFEBD0') };
const SETTLE = { resolve: 1, aperture: 400, compose: 400, toolpath: 300, key: 1, spill: 1, edit: 1 };   // ms (1 = none)

// The ten great circles in world space (shape.js builds homes on these frames, then tilts them).
export function ringFrames() {
  const T = tiltMatrix();
  return AX3.map((n0) => { const a = Math.abs(n0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const e1 = norm(cross(n0, a)), e2 = cross(n0, e1); return { n: T.apply(n0), e1: T.apply(e1), e2: T.apply(e2) }; });
}

export function createVerbs({ mobile = false, spill = false } = {}) {
  const rings = ringFrames();
  const ringN = new Float32Array(30), ringE1 = new Float32Array(30), ringE2 = new Float32Array(30);
  rings.forEach((r, k) => { ringN.set(r.n, k * 3); ringE1.set(r.e1, k * 3); ringE2.set(r.e2, k * 3); });
  const onRing = (k, th) => { const { e1, e2 } = rings[k]; const c = Math.cos(th), s = Math.sin(th); return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]; };
  const angleOn = (k, p) => Math.atan2(dot(p, rings[k].e2), dot(p, rings[k].e1));
  const crossings = [];
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) { const c = norm(cross(rings[i].n, rings[j].n)); for (const s of [1, -1]) crossings.push({ p: c.map((x) => x * s), rings: [i, j] }); }

  // Compose: the lattice cell containing a (the arrangement's face), its edges ordered round the cell from the lowest.
  function cell(a) {
    const sgn = rings.map((r) => Math.sign(dot(r.n, a))), M = 2048, edges = [];
    for (let k = 0; k < 10; k++) {
      const ins = new Uint8Array(M);
      for (let m = 0; m < M; m++) { const p = onRing(k, (m / M) * TAU); ins[m] = rings.every((r, j) => j === k || Math.sign(dot(r.n, p)) === sgn[j]) ? 1 : 0; }
      const start = ins.findIndex((v, i) => v && !ins[(i - 1 + M) % M]);
      if (start < 0) continue;
      let len = 0; while (ins[(start + len) % M] && len < M) len++;
      const a0 = (start / M) * TAU, l = (len / M) * TAU;
      edges.push({ k, a0, len: l, mid: onRing(k, a0 + l / 2) });
    }
    const cx = edges.reduce((s, e) => s + e.mid[0], 0) / edges.length, cy = edges.reduce((s, e) => s + e.mid[1], 0) / edges.length;
    edges.forEach((e) => { e.ang = Math.atan2(e.mid[1] - cy, e.mid[0] - cx); });
    const low = edges.reduce((b, e) => (e.mid[1] < b.mid[1] ? e : b), edges[0]);
    edges.forEach((e) => { e.order = wrap(e.ang - low.ang); });
    return edges.sort((x, y) => x.order - y.order);   // counter-clockwise on screen, from the lowest edge: assembled from the base up
  }
  // Toolpath: from the crossing nearest a, `legs` cuts, each along one ring to its next crossing, turning onto the other ring
  // there. Of the candidates, the most frontal path that stays clear of the ember's core (0.3 R in the view plane).
  function toolpath(a, legs = 2) {
    const start = crossings.reduce((b, c) => (dot(c.p, a) > dot(b.p, a) ? c : b), crossings[0]);
    const next = (k, p0, dir) => {   // the next crossing on ring k from p0 in direction dir
      const t0 = angleOn(k, p0); let best = null, bd = Infinity;
      for (const c of crossings) { if (!c.rings.includes(k)) continue; const d = wrap(dir * (angleOn(k, c.p) - t0)); if (d > 1e-3 && d < bd) { bd = d; best = c; } }
      return { c: best, len: bd, th0: t0 };
    };
    const paths = [];
    (function grow(at, prevRing, acc) {
      if (acc.length === legs) { paths.push(acc); return; }
      for (const k of at.rings) {
        if (k === prevRing) continue;
        for (const dir of [1, -1]) { const n = next(k, at.p, dir); if (n.c) grow(n.c, k, [...acc, { k, th0: n.th0, dir, len: n.len, end: n.c.p }]); }
      }
    })(start, -1, []);
    let best = null, bs = -Infinity;
    for (const P of paths) {
      let zs = 0, n = 0, minR = Infinity;
      for (const L of P) for (let q = 0; q <= 8; q++) { const p = onRing(L.k, L.th0 + L.dir * L.len * (q / 8)); zs += p[2]; n++; minR = Math.min(minR, Math.hypot(p[0], p[1])); }
      const score = zs / n - 3 * Math.max(0, 0.3 - minR) - 0.5 * Math.max(0, -Math.min(...P.map((L) => L.end[2])));
      if (score > bs) { bs = score; best = P; }
    }
    return { start: start.p, legs: best };
  }

  const slots = new Map();
  const handoffWait = (s) => [...slots.values()].some((o) => o !== s && o.tau / o.T > 0.6);
  let clock = 0;                                    // ms of scene time (oscillations)
  function enter(name, { theta = 0, forward = [0, 0, -1], legs = 2 } = {}) {
    if (name === 'key' && spill) name = 'spill';
    for (const o of slots.values()) if (o.name !== name) o.rate = -1.6;   // hand-off: the old one reverses at 0.625x
    const had = slots.get(name);
    if (had) { had.rate = 1; return had; }          // back on the same word mid-exit: it continues from where it is
    const lon = theta * 1.15, a = [Math.sin(lon), 0, Math.cos(lon)];   // the word's anchor: the front point of its meridian
    const s = { name, theta, a, tau: 0, rate: 1, settle: 0, T: 600, wait: true, born: clock };
    if (name === 'resolve') s.T = 1560;            // the front at 2.4 rad/s reaches the antipode (pi + the 0.6 rad feather) at 1560 ms
    else if (name === 'aperture') s.T = 700;
    else if (name === 'compose') { s.edges = cell(a).slice(0, 6); s.T = 110 * (s.edges.length - 1) + 200; }
    else if (name === 'toolpath') {
      const tp = toolpath(a, legs); s.legs = tp.legs; s.start = tp.start;
      s.feed = 1.6 / 1000; s.plunge = 90; s.dwell = 60;
      s.T = s.plunge + s.legs.reduce((t, L) => t + L.len / s.feed, 0) + s.dwell * (s.legs.length - 1);
    } else if (name === 'key' || name === 'spill') s.T = 900;
    else if (name === 'edit') {
      const v = forward.map((x) => -x);              // toward the camera; chosen once, so the set never swaps mid-hover
      const order = rings.map((r, k) => [Math.abs(dot(r.n, v)), k]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
      s.dim = order.slice(0, 6); s.gain = order.slice(6); s.T = 600;
    }
    slots.set(name, s);
    return s;
  }
  function exit(name, rate = 1) {
    if (name === 'key' && spill) name = 'spill';
    const s = slots.get(name); if (!s) return;
    if (s.wait && s.tau === 0) { slots.delete(name); return; }
    s.rate = Math.min(s.rate, -rate);               // a snap already under way is never slowed
  }
  function snapExiting() { for (const s of slots.values()) if (s.rate < 0) s.rate = Math.min(s.rate, -1.6); }
  function step(dtMs) {
    clock += dtMs;
    for (const s of [...slots.values()]) {
      if (s.wait) { if (s.rate > 0 && handoffWait(s)) continue; s.wait = false; }
      s.tau = clamp(s.tau + dtMs * s.rate, 0, s.T);
      if (s.rate > 0 && s.tau >= s.T) s.settle = Math.min(1, s.settle + dtMs / SETTLE[s.name]);
      if (s.rate < 0 && s.tau <= 0) slots.delete(s.name);
    }
  }

  // Per-frame values for both renderers. t: scene seconds.
  const P = {
    resolve: { on: 0, front: 0, band: 0, crest: mobile ? 0.12 : 0, a: [0, 0, 1] },
    aperture: { on: 0, radius: 1.05, light: 0, att: 0 },
    compose: { on: 0, edges: new Float32Array(24), bleed: 0, n: 0 },
    toolpath: { on: 0, legs: new Float32Array(12), s: 0, head: 0, tau: 0, plunge: 90, dwell: 60, feed: 0.0016, n: 0 },
    key: { yaw: 0, warm: 0 }, ember: { reach: 1, light: 1, warm: 0 },
    edit: { on: 0, light: new Float32Array(10), size: new Float32Array(10).fill(1) },
  };
  function params(t) {
    const clockS = clock / 1000;
    P.resolve.on = 0; P.aperture.on = 0; P.compose.on = 0; P.toolpath.on = 0; P.edit.on = 0;
    P.key.yaw = 0; P.key.warm = 0; P.ember.reach = 1; P.ember.light = 1; P.ember.warm = 0;
    for (const s of slots.values()) {
      const x = s.tau / s.T, hold = smooth(0.85, 1, x), e = EASE(x);
      if (s.name === 'resolve') {
        Object.assign(P.resolve, { on: 1, front: 2.4 * s.tau / 1000, band: PHI * clockS, a: s.a });
      } else if (s.name === 'aperture') {
        const a = smooth(0, 0.2, x), r = (1.05 - 0.59 * e) * (1 + 0.03 * hold * osc(clockS, 1.1, 0.7));
        Object.assign(P.aperture, { on: 1, radius: r, light: 0.55 * a * (1 - 0.6 * s.settle), att: 0.06 * a });
      } else if (s.name === 'compose') {
        const E = P.compose.edges; E.fill(-1);
        const down = 1 - 0.6 * s.settle;
        s.edges.forEach((ed, i) => {
          const rise = EASE(clamp((s.tau - 110 * i) / 200));
          E.set([ed.k, ed.a0, ed.len, 0.45 * rise * down * (1 + 0.08 * hold * osc(clockS, 0.9 * i, 0.37 * i))], i * 4);
        });
        Object.assign(P.compose, { on: 1, bleed: (1 / 3) * smooth(300, 500, s.tau), n: s.edges.length });
      } else if (s.name === 'toolpath') {
        let tt = s.tau - s.plunge, head = 0; const L = P.toolpath.legs; L.fill(0);
        s.legs.forEach((g, i) => L.set([g.k, g.th0, g.dir, g.len], i * 4));
        for (const g of s.legs) {                    // head position along the path (rad), un-eased: constant feed
          if (tt <= 0) break;
          const run = g.len / s.feed;
          if (tt < run) { head += tt * s.feed; tt = 0; break; }
          head += g.len; tt -= run + s.dwell;
        }
        Object.assign(P.toolpath, { on: 1, s: head, head: clamp(s.tau / s.plunge) * (1 - 0.5 * s.settle), tau: s.tau, plunge: s.plunge, dwell: s.dwell, feed: s.feed, n: s.legs.length });
      } else if (s.name === 'key') {
        const Y = (40 * Math.PI / 180) * Math.sign(s.theta || 1) * Math.max(0.5, Math.abs(s.theta));
        P.key.yaw = Y * e + (6 * Math.PI / 180) * hold * Math.sin(TAU * 0.12 * clockS);
        P.key.warm = 0.10 * e; P.ember.reach = 1 + 0.3 * e; P.ember.light = 1 / (P.ember.reach * P.ember.reach);
      } else if (s.name === 'spill') {
        P.ember.warm = e; P.ember.reach = 1 + 0.5 * e; P.ember.light = 1 / (P.ember.reach * P.ember.reach);
      } else if (s.name === 'edit') {
        P.edit.on = 1; P.edit.light.fill(0); P.edit.size.fill(1);
        for (const k of s.dim) { P.edit.light[k] = -(mobile ? 0.6 : 0.5) * e; P.edit.size[k] = 1 - 0.08 * e; }
        for (const k of s.gain) P.edit.light[k] = 0.08 * e;
      }
    }
    return P;
  }
  // The key light's swing about the world vertical: positive yaw moves it toward the right of the screen.
  function applyKey(cam) {
    const a = P.key.yaw; if (!a) return;
    const d = cam.lightDir, c = Math.cos(a), s = Math.sin(a);
    const x = d[0] * c - d[2] * s, z = d[0] * s + d[2] * c; cam.lightDir = [x, d[1], z];
    const V = cam.view, lx = V[0] * x + V[4] * d[1] + V[8] * z, ly = V[1] * x + V[5] * d[1] + V[9] * z, lz = V[2] * x + V[6] * d[1] + V[10] * z, l = Math.hypot(lx, ly, lz) || 1;
    cam.lightView = [lx / l, ly / l, lz / l];
  }
  // The Canvas2D twin of the RENDER_VS terms, per sprite (home h, random r, view-space offset from the ember dx, dy, the scalar
  // flicker it would have). Returns [light multiplier, flicker, tone] with tone 0 = keep, 3 = the cool glint, 4 = warm (dawn).
  const tw = [1, 1, 0];
  function cpuLight(h, r, dx, dy, flick, time) {
    let add = 0, mul = 1, tone = 0, k = -1, th = 0;
    if (P.compose.on || P.toolpath.on || P.edit.on) {
      let bd = 1e9; for (let q = 0; q < 10; q++) { const d = Math.abs(h[0] * ringN[q * 3] + h[1] * ringN[q * 3 + 1] + h[2] * ringN[q * 3 + 2]); if (d < bd) { bd = d; k = q; } }
      th = Math.atan2(h[0] * ringE2[k * 3] + h[1] * ringE2[k * 3 + 1] + h[2] * ringE2[k * 3 + 2], h[0] * ringE1[k * 3] + h[1] * ringE1[k * 3 + 1] + h[2] * ringE1[k * 3 + 2]);
    }
    if (P.resolve.on) {
      const a = P.resolve.a, l = Math.hypot(h[0], h[1], h[2]) || 1, gc = Math.acos(clamp((h[0] * a[0] + h[1] * a[1] + h[2] * a[2]) / l, -1, 1));
      const c = smooth(0, 0.6, P.resolve.front - gc), band = Math.sin(2.4 * gc - P.resolve.band);
      if (r < 0.08) flick = 0.6 + 0.4 * ((1 - c) * Math.sin(0.8 * time + 97 * r) * Math.sin(1.73 * time + 31 * r) + c * band);
      else if (r < 0.22) mul *= 1 + 0.4 * c * band;
      add += P.resolve.crest * c * smooth(0.5, 1, band);
    }
    if (P.aperture.on) {
      const rs = Math.hypot(dx, dy), A = P.aperture;
      add += A.light * Math.exp(-(((rs - A.radius) / 0.05) ** 2)) * (1 - 0.5 * smooth(0.7, 1, rs)) * smooth(0.24, 0.3, rs);
      mul *= 1 - A.att * smooth(A.radius, A.radius + 0.08, rs);
    }
    if (P.compose.on) {
      const E = P.compose.edges;
      for (let i = 0; i < 6; i++) {
        if (E[i * 4] < 0 || Math.round(E[i * 4]) !== k) continue;
        const len = E[i * 4 + 2], u = wrap(th - E[i * 4 + 1] + Math.PI) - Math.PI;
        const inside = smooth(-0.025, 0, u) * (1 - smooth(len, len + 0.025, u)), o = Math.max(-u, u - len), bl = o > 0 ? 1 - smooth(0, 0.35, o) : 0;
        const a = E[i * 4 + 3] * (inside + P.compose.bleed * bl * bl * (1 - inside)); add += a; if (a > 0.08) tone = 3;
      }
    }
    if (P.toolpath.on) {
      const T = P.toolpath, L = T.legs; let U = 0, tAt = T.plunge;
      for (let i = 0; i < T.n; i++) {
        if (Math.round(L[i * 4]) === k) {
          const len = L[i * 4 + 3], u = wrap(L[i * 4 + 2] * (th - L[i * 4 + 1]) + Math.PI) - Math.PI;
          if (u > -0.15 && u < len + 0.15) {
            const uu = U + u, head = T.head * Math.exp(-(((uu - T.s) / 0.04) ** 2));
            const inLeg = smooth(-0.02, 0, u) * (1 - smooth(len, len + 0.02, u)), cut = T.tau > T.plunge ? 0.18 * inLeg * (1 - smooth(T.s - 0.012, T.s + 0.012, uu)) : 0;
            const dawn = 1 - smooth(0, 500, T.tau - (tAt + clamp(u, 0, len) / T.feed));
            add += head + cut; if (head > 0.15 || cut * dawn > 0.06) tone = 4;
          }
        }
        tAt += L[i * 4 + 3] / T.feed + T.dwell; U += L[i * 4 + 3];
      }
    }
    if (P.edit.on && k >= 0) mul *= 1 + P.edit.light[k];
    tw[0] = (1 + add) * mul; tw[1] = flick; tw[2] = tone;
    return tw;
  }
  return {
    cpuLight,
    rings, ringN, ringE1, ringE2, crossings, cell, toolpath, onRing, angleOn,
    enter, exit, snapExiting, step, params, applyKey,
    clear() { slots.clear(); params(0); },
    active: () => slots.size > 0,
    level: (name) => { const s = slots.get(name === 'key' && spill ? 'spill' : name); return s ? s.tau / s.T : 0; },
    entranceMs: (name) => slots.get(name === 'key' && spill ? 'spill' : name)?.T ?? 0,
    slots, get spill() { return spill; },
  };
}
