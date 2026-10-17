// The glyph haze (NEXT-SPEC §2): the faint haze around the cage, seen up close, is a field of the readouts' own characters (IBM Plex
// Mono, the decode alphabet), lit by the ember from inside the cage and crossed by the strands' shadows. Characters never move; only
// light moves over them. A cell's light: a dark breath outside the cage, then a fall-off (base), times the shadow of every ring on the
// ray from the ember through the cage to a wall behind it (great circles cast straight lines), times the ember's level, eased (lightMs).
// Life: each cell re-types itself now and then (a miniature of the readouts' decode); a lit edge sweeping over a cell re-types it once;
// the pointer stirs the rate; a touchdown sends one ring of re-typing outward; an optional egg spells 29:11 after a long idle.
// WebGL tiers only. CPU: the grid, light and decode state, written as one RG8 texture (glyph, light) the composite reads with the atlas.
// Still (u_motion 0): drawn static, no re-typing; hidden or paused: no frames, no work; the governor's first shed fades it out for good.
import { GLYPHS as G, DBG } from './constants.js';
import { GLYPHS as ALPHABET } from './decode.js';
import { AX3, AX5, tiltMatrix } from './shape.js';

const N = ALPHABET.length, PER_ROW = 8, ATLAS_ROWS = Math.ceil(N / PER_ROW);
const EGG = '29:11'.split('').map((c) => ALPHABET.indexOf(c));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// cubic-bezier(.16, 1, .3, 1), the house ease (the entrance); the shed plays it backwards
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = ((ax * t + bx) * t + cx) * t - x, d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; t -= e / d; }
    return ((ay * t + by) * t + cy) * t;
  };
}
const ease = bezier(0.16, 1, 0.3, 1);

export function createGlyphs(gl, { mobile = false, set = 1 } = {}) {
  const pitch = mobile ? G.pitchPhone : G.pitch, size = mobile ? G.sizePhone : G.size, peak = mobile ? G.peakPhone : G.peak;
  const normalsW = (set === 1 ? AX3 : AX5).map((n) => tiltMatrix().apply(n)), NK = normalsW.length, nV = new Float32Array(NK * 3);
  const cellsTex = gl.createTexture(), atlasTex = gl.createTexture();
  for (const t of [cellsTex, atlasTex]) {
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  let cw = 0, ch = 0, atlasReady = false, atlasFor = 0, building = false;   // the atlas's cell size (output px), the scale it was built for
  let want = 0, wantAt = 0, wantTimer = 0;   // a new backing scale waiting to hold for settleMs before it gets its own atlas
  let cols = 0, rows = 0, ox = 0, oy = 0, R = 1, cx = 0, cy = 0, sxL = 1, syL = 1, hL = 1, layCw = 0, layCh = 0;   // grid (output px, y up): shell, scale, cell size it was laid out at
  let fresh = 0;   // 1: the first layout (the light arrives on its ease, and the field writes itself in), 2: a relayout (light seeded at target)
  let qx, qy, base, invBase, light, mask, tmask, shade, cssX, cssY, wxA, wyA, lowAt, nextAt, glyph, final, steps, rippled, egged, bytes, active = new Int32Array(0);
  let enter = 0, shed = false, shedAt = -1, lastT = -1, ripple = null, rippleId = 0, idleFor = 0, eggAt = 0, egg = null, built = false, textDirty = true, parity = 0;
  const sig = new Float64Array(8), sigLast = new Float64Array(8).fill(NaN);
  const stats = { steps: 0, rolls: 0, uploads: 0, bytes: 0, cpu: [], lambda: 0, atlas: 0, amp: 0, eggs: 0, rippleRolls: 0 };   // for the probes
  let textRects = [], labelRects = null, requestDraw = null;

  function buildAtlas(scale) {   // the 40 glyphs, white on black, one cell each, at the output pixel size (once per scale)
    if (building) return;
    building = true;
    const px = Math.round(size * scale), font = `400 ${px}px "IBM Plex Mono"`;
    const done = () => {
      const w = Math.round(pitch[0] * scale), h = Math.round(pitch[1] * scale), c = document.createElement('canvas');
      c.width = w * PER_ROW; c.height = h * ATLAS_ROWS;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#fff'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let i = 0; i < N; i++) g.fillText(ALPHABET[i], (i % PER_ROW + 0.5) * w, (Math.floor(i / PER_ROW) + 0.5) * h);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, c);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      cw = w; ch = h; atlasFor = scale; atlasReady = true; building = false; stats.atlas++; sigLast[0] = NaN; requestDraw?.();
    };
    (document.fonts?.load ? document.fonts.load(font) : Promise.resolve()).then(done, done);
  }
  // A resize passes through a transient backing scale (the canvas backing follows 120 ms later), and a drag through many: a scale gets
  // its own atlas only once it has held for settleMs. Until then the grid is laid out at the current atlas's cell size, so the grid and
  // the atlas always agree (the glyphs are drawn a little large or small for that moment, never off their cells).
  function settleAtlas(scale) {
    if (building) return;
    const now = performance.now();
    if (Math.abs(want - scale) > 1e-3) { want = scale; wantAt = now; clearTimeout(wantTimer); wantTimer = setTimeout(() => requestDraw?.(), G.settleMs + 20); return; }   // the timer: still frames
    if (now - wantAt >= G.settleMs) { want = 0; buildAtlas(scale); }
  }

  // The grid: whole output pixels, anchored on the shell centre, covering |q| <= outer[1], at the atlas's cell size; per-cell geometry
  // once. A relayout keeps each character (and its decode) by its place relative to the centre cell, so a resize re-types nothing, and
  // the first compute after it puts light and masks straight at their targets (no dip, no flash of cells near text). The first layout
  // keeps its entrance: the light eases in and writes the field in as it arrives; only the masks start at their targets.
  function layout(cam) {
    const o = built ? { cols, rows, glyph, final, steps, nextAt, lowAt } : null;
    R = cam.shellPx.r; cx = cam.shellPx.x; cy = cam.shellPx.y; sxL = cam.scaleX || 1; syL = cam.scaleY || 1; hL = cam.height; layCw = cw; layCh = ch;
    const half = G.outer[1] * R;
    cols = Math.ceil((2 * half) / cw); rows = Math.ceil((2 * half) / ch);
    ox = Math.round(cx - (cols * cw) / 2); oy = Math.round(cy - (rows * ch) / 2);
    const n = cols * rows, act = [], di = o ? (o.cols - cols) / 2 : 0, dj = o ? (o.rows - rows) / 2 : 0;
    qx = new Float32Array(n); qy = new Float32Array(n); base = new Float32Array(n); invBase = new Float32Array(n); light = new Float32Array(n);
    mask = new Float32Array(n).fill(1); tmask = new Uint8Array(n); shade = new Float32Array(n).fill(1);
    cssX = new Float32Array(n); cssY = new Float32Array(n); wxA = new Float32Array(n); wyA = new Float32Array(n);
    lowAt = new Float32Array(n).fill(-1e9); nextAt = new Float32Array(n); glyph = new Uint8Array(n); final = new Uint8Array(n); steps = new Uint8Array(n);
    rippled = new Int32Array(n); egged = new Uint8Array(n); bytes = new Uint8Array(n * 2);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i, wx = ox + (i + 0.5) * cw, wy = oy + (j + 0.5) * ch, x = (wx - cx) / R, y = (wy - cy) / R, r = Math.sqrt(x * x + y * y);
      qx[k] = x; qy[k] = y; wxA[k] = wx; wyA[k] = wy; cssX[k] = wx / sxL; cssY[k] = (hL - wy) / syL;
      const oi = Math.round(i + di), oj = Math.round(j + dj);
      if (o && oi >= 0 && oj >= 0 && oi < o.cols && oj < o.rows) { const q = oj * o.cols + oi; glyph[k] = o.glyph[q]; final[k] = o.final[q]; steps[k] = o.steps[q]; nextAt[k] = o.nextAt[q]; lowAt[k] = o.lowAt[q]; }
      else glyph[k] = final[k] = Math.floor(Math.random() * N);
      base[k] = smooth(G.inner[0], G.inner[1], r) * (1 - smooth(G.outer[0], G.outer[1], r)) / (1 + ((r - 1) / G.falloff) ** 2);
      invBase[k] = 1 / Math.max(base[k], 1e-4);
      if (base[k] > 0.002) act.push(k);
    }
    active = Int32Array.from(act);
    gl.bindTexture(gl.TEXTURE_2D, cellsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, cols, rows, 0, gl.RG, gl.UNSIGNED_BYTE, null);
    if (egg) { egg = null; idleFor = 0; eggAt = 0; }   // its cells moved (the egg is off by default)
    fresh = o ? 2 : 1; ripple = null; built = true; textDirty = true; sigLast[0] = NaN;
  }

  // Text the field must never sit behind (CSS px [x0, y0, x1, y1], y down): the static boxes (main.js) once per layout, as a per-cell mask
  const inRect = (X, Y, r, m) => X > r[0] - m && X < r[2] + m && Y > r[1] - m && Y < r[3] + m;
  function maskText() {
    const m = G.maskPx;
    for (const k of active) { let hit = 0; for (const r of textRects) if (inRect(cssX[k], cssY[k], r, m)) { hit = 1; break; } tmask[k] = hit; }
    textDirty = false;
  }

  function roll(k, t, to = -1) {   // a decode in miniature: rollSteps intermediate glyphs, rollMs each, then the final one
    if (steps[k] && to < 0) return;
    let f = to >= 0 ? to : Math.floor(Math.random() * (N - 1)); if (to < 0 && f >= glyph[k]) f++;
    final[k] = f; steps[k] = G.rollSteps; nextAt[k] = t + G.rollMs; glyph[k] = Math.floor(Math.random() * N); stats.rolls++;
  }

  // view: { time (s) }, motion 0/1, emberLvl: the ember's level over its rest, build: u_build, idle: u_idle, hand: { x, y (output px,
  // y up), present } or null. Returns the field's amplitude for the composite (0: nothing drawn, no fetches).
  function step(cam, view, dtMs, motion, emberLvl, build, idle, hand) {
    if (!G.on || shed && shedAt >= 0 && enter <= 0) return 0;
    const scale = cam.scaleY || 1;
    if (!atlasReady) { if (!building) buildAtlas(scale); return 0; }
    if (Math.abs(atlasFor - scale) > 1e-3 && !shed) settleAtlas(scale); else want = 0;   // shedding: the field is leaving for good, keep its atlas
    if (!built || cw !== layCw || ch !== layCh || cam.shellPx.r !== R || cam.shellPx.x !== cx || cam.shellPx.y !== cy || cam.height !== hL
        || (cam.scaleX || 1) !== sxL || scale !== syL) layout(cam);
    if (textDirty) maskText();
    const t0 = DBG ? performance.now() : 0, t = view.time * 1000, dt = motion ? Math.max(0, Math.min(100, dtMs)) : 0;
    // entrance (after the ember ignites) and the governor's shed (the entrance played backwards, twice as fast)
    if (shed) enter = Math.max(0, enter - dt / G.shedMs);
    else if (build >= 0.9) enter = motion ? Math.min(1, enter + dt / G.inMs) : 1;
    const amp = peak * (motion ? ease(enter) : enter);
    stats.amp = amp;
    if (amp <= 0 && !shed) return 0;
    // the light: recomputed when the camera, the ember, the masks or the clock move (the idle drift moves them every frame while it runs)
    const V = cam.view, E = cam.emberView, ex = E[0] - V[12], ey = E[1] - V[13], ez = E[2] - V[14];
    const moving = motion > 0 && dt > 0, nl = labelRects ? labelRects.length : 0;
    sig[0] = ex; sig[1] = ey; sig[2] = ez; sig[3] = V[0]; sig[4] = V[2]; sig[5] = V[5]; sig[6] = emberLvl; sig[7] = nl;
    let dirty = false; for (let q = 0; q < 8; q++) if (Math.abs(sig[q] - sigLast[q]) > 1e-6 || sigLast[q] !== sigLast[q]) { dirty = true; break; }
    if (!dirty && !moving) return amp;
    sigLast.set(sig); stats.steps++;
    for (let k = 0; k < NK; k++) { const n = normalsW[k]; nV[k * 3] = V[0] * n[0] + V[4] * n[1] + V[8] * n[2]; nV[k * 3 + 1] = V[1] * n[0] + V[5] * n[1] + V[9] * n[2]; nV[k * 3 + 2] = V[2] * n[0] + V[6] * n[1] + V[10] * n[2]; }
    const first = fresh; fresh = 0;   // the first compute after a layout: every cell's shadow, the masks at their targets (and the light, after a relayout)
    const kL = moving && first !== 2 ? 1 - Math.exp(-dt / G.lightMs) : 1, kM = moving && !first ? dt / G.maskMs : 1, E2 = ex * ex + ey * ey + ez * ez;
    const w2 = G.strutW * G.strutW, cut = 9 * w2, keepS = 1 - G.strut, dz0 = -G.wall - ez, m = G.maskPx;
    const present = hand ? hand.present : 0, px = hand ? hand.x : 0, py = hand ? hand.y : 0, stir2 = (G.stirPx * scale) ** 2, stirOn = present > 0.01;
    const rr = ripple && t - ripple.t0 < G.rippleMs ? (t - ripple.t0) * G.ripplePxMs * scale : -1, rr2 = rr * rr;
    const rate = G.rate / 1000, half = moving && !first ? 2 : 1;   // in motion the shadows refresh half the cells per frame (alternating): 30 Hz, under the 140 ms light
    parity ^= 1;
    let lambda = 0;
    for (let a = 0; a < active.length; a++) {
      const k = active[a];
      if (half === 1 || (a & 1) === parity) {
        // the ray from the ember to the wall point behind this cell leaves the sphere at s; each ring shadows it where s is on its plane
        let dx = qx[k] - ex, dy = qy[k] - ey, dz = dz0; const il = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz); dx *= il; dy *= il; dz *= il;
        const b = ex * dx + ey * dy + ez * dz, tt = -b + Math.sqrt(b * b - (E2 - 1)), s0 = ex + tt * dx, s1 = ey + tt * dy, s2 = ez + tt * dz;
        let T = 1;
        for (let n = 0; n < NK; n++) { const d = s0 * nV[n * 3] + s1 * nV[n * 3 + 1] + s2 * nV[n * 3 + 2], d2 = d * d; if (d2 < cut) T *= 1 - keepS * Math.exp(-d2 / w2); }
        shade[k] = T;
      }
      const target = Math.min(1, base[k] * shade[k] * emberLvl);
      let mt = tmask[k] ? 0 : 1;
      if (mt && nl) for (let q = 0; q < nl; q++) if (inRect(cssX[k], cssY[k], labelRects[q], m)) { mt = 0; break; }
      const mk = mask[k], dm = mt - mk; mask[k] = dm > kM ? mk + kM : dm < -kM ? mk - kM : mt;
      const was = first === 2 ? target : light[k], lk = was + (target - was) * kL; light[k] = lk;   // a relaid cell: no edge "sweeps" it
      if (moving) {
        const rel = lk * invBase[k];
        if (rel < G.wake[0]) lowAt[k] = t;
        else if (rel > G.wake[1] && was * invBase[k] <= G.wake[1] && t - lowAt[k] < G.wakeMs) roll(k, t);   // the light writes
        let stir = 1;
        if (stirOn) { const ddx = wxA[k] - px, ddy = wyA[k] - py, sd = ddx * ddx + ddy * ddy; if (sd < stir2) stir = 1 + (G.stir - 1) * present * (1 - Math.sqrt(sd / stir2)); }
        const lam = rate * (0.3 + lk) * stir; lambda += lam;
        if (!egged[k] && Math.random() < lam * dt) roll(k, t);
        if (rr > 0 && rippled[k] !== rippleId) { const ddx = wxA[k] - ripple.x, ddy = wyA[k] - ripple.y; if (ddx * ddx + ddy * ddy < rr2) { rippled[k] = rippleId; roll(k, t); stats.rippleRolls++; } }   // the touch ring
        while (steps[k] && t >= nextAt[k]) { steps[k]--; glyph[k] = steps[k] ? Math.floor(Math.random() * N) : final[k]; nextAt[k] += G.rollMs; }
      }
      const al = lk * mask[k] * (steps[k] ? 0.7 : 1);
      bytes[k * 2] = glyph[k]; bytes[k * 2 + 1] = al >= 1 ? 255 : (al * 255 + 0.5) | 0;
    }
    stats.lambda = lambda * 1000;   // the model's re-roll rate (per second), for the probes
    if (moving) eggStep(t, dt, idle);
    gl.bindTexture(gl.TEXTURE_2D, cellsTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RG, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    stats.uploads++; stats.bytes = bytes.length;
    if (DBG) { stats.cpu.push(performance.now() - t0); if (stats.cpu.length > 240) stats.cpu.shift(); }
    lastT = t;
    return amp;
  }

  // The egg (GLYPHS.egg, off unless the owner says yes; ?glyphs=egg in test builds): after a long idle, five bright unshadowed cells
  // in a row decode into 29:11 left to right, hold, then decode away right to left (the exit mirrors the entrance).
  function eggStep(t, dt, idle) {
    if (!G.egg) return;
    if (!egg) {
      idleFor = idle > 0.5 ? idleFor + dt : 0;
      if (!eggAt) eggAt = G.eggEveryMs[0] + Math.random() * (G.eggEveryMs[1] - G.eggEveryMs[0]);
      if (idleFor < eggAt) return;
      let best = -1, bestV = 0;
      for (let j = 0; j < rows; j++) for (let i = 0; i + 5 <= cols; i++) {
        let v = 1; for (let m = 0; m < 5; m++) { const k = j * cols + i + m, r2 = qx[k] * qx[k] + qy[k] * qy[k]; v = Math.min(v, r2 > 1.69 && r2 < 3.24 && light[k] * mask[k] * invBase[k] > 0.9 ? light[k] : 0); }   // clear of the cage (1.3-1.8 R), unshadowed
        if (v > bestV) { bestV = v; best = j * cols + i; }
      }
      if (best < 0) { idleFor = 0; eggAt = 0; return; }
      egg = { at: best, t0: t, saved: [] }; stats.eggs++; stats.eggAt = [ox + (best % cols) * cw, oy + Math.floor(best / cols) * ch, 5 * cw, ch];   // output px (y up), for the clips
      for (let m = 0; m < 5; m++) { egg.saved.push(final[best + m]); egged[best + m] = 1; }
    }
    const e = egg, inEnd = 4 * G.rollMs + G.rollSteps * G.rollMs, outAt = inEnd + G.eggHoldMs;
    for (let m = 0; m < 5; m++) {
      const k = e.at + m, tin = e.t0 + m * G.rollMs, tout = e.t0 + outAt + (4 - m) * G.rollMs;
      if (t >= tin && !e[`i${m}`]) { e[`i${m}`] = 1; steps[k] = 0; roll(k, t, EGG[m]); }
      if (t >= tout && !e[`o${m}`]) { e[`o${m}`] = 1; steps[k] = 0; roll(k, t, e.saved[m]); }
    }
    if (t >= e.t0 + outAt + 4 * G.rollMs + G.rollSteps * G.rollMs) { for (let m = 0; m < 5; m++) egged[e.at + m] = 0; egg = null; idleFor = 0; eggAt = 0; }
  }

  return {
    stats, get cells() { return cellsTex; }, get atlas() { return atlasTex; }, get ready() { return atlasReady && built; },
    grid: () => [ox, oy, layCw, layCh, cols, rows, PER_ROW, ATLAS_ROWS],   // step() relays out before any draw once the atlas's size changes
    step,
    setTextRects(r) { textRects = r || []; textDirty = true; sigLast[0] = NaN; },
    setLabelRects(r) { labelRects = r; },
    onDraw(fn) { requestDraw = fn; },
    ripple(x, y, t) { ripple = { x, y, t0: t }; rippleId++; },   // output px (y up), scene ms
    shed() { if (!shed) { shed = true; shedAt = lastT; } },
    dispose() { clearTimeout(wantTimer); gl.deleteTexture(cellsTex); gl.deleteTexture(atlasTex); },
  };
}
