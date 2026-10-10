import { frameRatio, damp, friction, smoothstep, clamp } from './damp.js';
import { projectPx } from './camera.js';
import { hexRGB, COLORS, NODES, LAG, HAND, RESET, EMBER_LIGHT } from './constants.js';

// The Canvas2D tier: the same design drawn with sprites. Same homes (R2 order), same camera, same model,
// same lag chain; a JS velocity grid stands in for the fluid and the model's CPU trail grid for the GPU trail.
const TONES = [COLORS.shadow, COLORS.mid, COLORS.hi, COLORS.rim].map(hexRGB);
TONES.push(TONES[2].map((c, i) => c + (hexRGB(COLORS.ember)[i] - c) * 0.45));   // 4: silver in the ember's light (hi toward ember: no new colour)
const RADII = [2.0, 3.0, 4.0];                       // CSS px (v1's sizes, hard-cored); multiplied by the backing scale
const BUCKETS = [0.05, 0.1, 0.18, 0.28, 0.38];         // globalAlpha per intensity bucket

function makeSprite(r, rgb) {
  const size = Math.ceil(r * 2 + 2), c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), m = size / 2;
  const grad = g.createRadialGradient(m, m, 0, m, m, r);
  const [R, G, B] = rgb.map((x) => Math.round(x * 255));
  grad.addColorStop(0, `rgba(${R},${G},${B},1)`); grad.addColorStop(0.35, `rgba(${R},${G},${B},0.85)`); grad.addColorStop(0.7, `rgba(${R},${G},${B},0.2)`); grad.addColorStop(1, `rgba(${R},${G},${B},0)`);   // hard core, short skirt
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  return c;
}

export function createCanvasRenderer(canvas, uniforms, shape, model, { tier }) {
  let ctx;
  try { ctx = canvas.getContext('2d', { alpha: false }); } catch { return null; }
  if (!ctx) return null;
  const maxN = Math.min(tier.sprites || 2000, shape.count);
  let N = maxN;
  let ox, oy, oz, vx, vy, vz, d1, d2, sx, sy, sz, inten, tone, sizeIdx, veil;
  function alloc() {
    [ox, oy, oz, vx, vy, vz, d1, d2, sx, sy, sz, inten] = Array.from({ length: 12 }, () => new Float32Array(N));
    tone = new Uint8Array(N); sizeIdx = new Uint8Array(N); veil = new Uint8Array(N);
  }
  alloc();
  const G = { w: 32, h: 18, vx: new Float32Array(32 * 18), vy: new Float32Array(32 * 18), tx: new Float32Array(32 * 18), ty: new Float32Array(32 * 18) };
  let sprites = [], spriteScale = 0, hazeImg = null, hazeR = 0;
  const small = document.createElement('canvas'), sctx = small.getContext('2d');
  const layer = document.createElement('canvas'), lctx = layer.getContext('2d');      // emissive layer on black: bloom adds only light
  const vmask = document.createElement('canvas'), vctx = vmask.getContext('2d');     // the ember's veil: front sprites union, erased once (a floor, like GL)
  const linkBuf = new Float32Array(model.plexus.maxVertices * 4);
  const tmp = [0, 0, 0];

  function ensureSprites(scale) {
    if (scale === spriteScale && sprites.length) return;
    spriteScale = scale;
    sprites = RADII.map((r) => TONES.map((rgb) => makeSprite(r * scale, rgb)));
  }
  // The haze is baked once per radius and blitted at the leaned centre: full-canvas gradient fills cost more than the sprites.
  // The vignette is CSS on this tier (html[data-renderer='canvas2d'] body::before).
  function ensureHaze(R) {
    const r = Math.max(2, Math.ceil(R * 2.2));
    if (hazeImg && hazeR === r) return;
    hazeR = r; hazeImg = document.createElement('canvas'); hazeImg.width = hazeImg.height = r * 2;
    const g = hazeImg.getContext('2d'), grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, '#11151b'); grad.addColorStop(1, 'rgba(10,13,17,0)');
    g.fillStyle = grad; g.fillRect(0, 0, r * 2, r * 2);
  }

  // Velocity grid: capsule splat of the pointer's motion (uv/s, y up), decay, two relaxation passes.
  function gridStep(trail, dt, ratio, aspect) {
    const { w, h } = G;
    const ax = trail.ax, ay = trail.ay, bx = trail.bx, by = trail.by;
    const fx = (bx - ax) * aspect / Math.max(dt, 1e-3), fy = (by - ay) / Math.max(dt, 1e-3);
    const radius = 0.14;
    if (Math.abs(fx) + Math.abs(fy) > 1e-4) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const pax = (u - ax) * aspect, pay = v - ay, bax = (bx - ax) * aspect, bay = by - ay;
        const t = clamp((pax * bax + pay * bay) / Math.max(bax * bax + bay * bay, 1e-8));
        let k = clamp(1 - Math.hypot(pax - bax * t, pay - bay * t) / radius); k = k * k * k;
        G.vx[y * w + x] += fx * k; G.vy[y * w + x] += fy * k;
      }
    }
    const decay = friction(0.98, ratio);
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const ax_ = (G.vx[x > 0 ? i - 1 : i] + G.vx[x < w - 1 ? i + 1 : i] + G.vx[y > 0 ? i - w : i] + G.vx[y < h - 1 ? i + w : i]) * 0.25;
        const ay_ = (G.vy[x > 0 ? i - 1 : i] + G.vy[x < w - 1 ? i + 1 : i] + G.vy[y > 0 ? i - w : i] + G.vy[y < h - 1 ? i + w : i]) * 0.25;
        G.tx[i] = (G.vx[i] + ax_) * 0.5; G.ty[i] = (G.vy[i] + ay_) * 0.5;
      }
      G.vx.set(G.tx); G.vy.set(G.ty);
    }
    for (let i = 0; i < G.vx.length; i++) { G.vx[i] *= decay; G.vy[i] *= decay; }
  }
  const gridAt = (u, v) => { const x = clamp(Math.floor(u * G.w), 0, G.w - 1), y = clamp(Math.floor(v * G.h), 0, G.h - 1); return y * G.w + x; };

  function emberLevel(u, t) {
    return u.u_ember.value * Math.min(1.6, 1 + u.u_boostPress.value + u.u_boostGreet.value + 0.2 * u.u_engage.value + 0.4 * u.u_open.value + 0.2 * u.u_warm.value)
      * (1 - 0.15 * u.u_tear.value) * (1 + 0.05 * Math.sin(1.9 * t) * u.u_idle.value);
  }

  function draw(view, dtMs) {
    const u = uniforms, motion = u.u_motion.value, ratio = frameRatio(dtMs), dt = Math.min(dtMs, 100) / 1000;
    const cam = model.cam, s = model.state;
    if (!cam.ready) return false;
    const W = canvas.width, H = canvas.height, scale = cam.scaleY || 1;
    ensureSprites(Math.max(0.75, scale * Math.min(1, cam.shellPx.r / (135 * scale)))); ensureHaze(cam.shellPx.r);
    const time = model.time;
    if (motion && s.simulate) gridStep(s.trail, dt, ratio, W / H);
    s.trail.pressDisc = false;
    // ---- simulate (same force model as the GL sim, scalar) ----
    const P = s.probeRaw, k06 = damp(LAG.particle, ratio), build = u.u_build.value, open = u.u_open.value, flinch = u.u_flinch.value;
    const PR = s.probeRaw, PV = s.probeVel, poke = s.poke, HD = s.handDir;   // the hand (measured across the view ray HD)
    const handW = (al) => 1 + (HAND.back - 1) * smoothstep(-0.2, 0.2, al);   // near face 1, far side HAND.back
    const RF = s.front, RA = s.ampS, RB = RESET.band;                           // the resync front (radius R, eased amp, band)
    const tight = u.u_tight.value, idleU = u.u_idle.value, fr = friction(0.9, ratio), sim = motion && s.simulate;
    const view4 = cam.view, VP = cam.viewProj, right = cam.right, up = cam.up, L = cam.lightDir;
    const ringLon = u.u_ringLon.value, ringPhase = u.u_ringPhase.value, ringAmp = u.u_ringAmp.value;
    const pnx = Math.cos(ringLon), pnz = -Math.sin(ringLon);
    const tapT = u.u_tapT.value, tapX = u.u_tapX.value, tapY = u.u_tapY.value, tapZ = u.u_tapZ.value, sentry = u.u_sentry.value;
    const KEY = cam.lightDir;
    const dens = 2000 / N;                              // luminance stays put as the sprite count changes
    const lvl = emberLevel(u, time) * (0.55 + 0.45 * model.trailGrid.maxAround(cam.emberPx[0], cam.emberPx[1], W, H));   // the ember's level (a tear lets the warmth out)
    const EV = cam.emberView, eReach2 = EMBER_LIGHT.reach * EMBER_LIGHT.reach, eFall2 = EMBER_LIGHT.falloff * EMBER_LIGHT.falloff, eGain = EMBER_LIGHT.light * Math.min(lvl, 1.2);
    for (let i = 0; i < N; i++) {
      const hx = shape.homes[i * 4], hy = shape.homes[i * 4 + 1], hz = shape.homes[i * 4 + 2], r = shape.homes[i * 4 + 3];
      // build-inward front in view space
      const vxh = view4[0] * hx + view4[4] * hy + view4[8] * hz, vyh = view4[1] * hx + view4[5] * hy + view4[9] * hz;
      const sFront = Math.min(Math.hypot(vxh, vyh), 1) + 0.12 * r;
      const built = smoothstep(sFront - 0.08, sFront, 1.2 * build);
      let px = hx + ox[i], py = hy + oy[i], pz = hz + oz[i];
      if (sim) {
        const prox = u.u_present.value * (1 - smoothstep(0.35, 1.2, Math.hypot(px - P[0], py - P[1], pz - P[2]))) * (0.5 + 0.3 * Math.sin(time + r * 12.34) * r);
        const idle = idleU * 0.2 * (0.5 + 0.5 * Math.sin(-2 * time + hx)) * (0.5 + 0.5 * Math.cos(-time)) * (0.5 + 1.5 * r);
        const target = Math.max(idle, prox);
        d1[i] += (target - d1[i]) * k06; d2[i] += (d1[i] - d2[i]) * k06;
      }
      const scaleH = (1.35 + (1 - 1.35) * built) * (1 + 0.06 * open + 0.12 * d2[i] + 0.06 * flinch);
      const tx = hx * scaleH, ty = hy * scaleH, tz = hz * scaleH;
      projectPx(VP, [px, py, pz], W, H, tmp);
      const su = tmp[0] / W, sv = tmp[1] / H, w = tmp[2];
      if (sim) {
        const gi = gridAt(su, sv), fxv = G.vx[gi], fyv = G.vy[gi], fl = Math.min(Math.hypot(fxv, fyv), 1);
        const tr = model.trailGrid.at(su, sv);
        let ax = (right[0] * fxv + up[0] * fyv) * 7e-4, ay = (right[1] * fxv + up[1] * fyv) * 7e-4, az = (right[2] * fxv + up[2] * fyv) * 7e-4;
        // the hand: an instant, velocity-weighted shove in the view plane, away from the pointer (same gains as GL: this
        // tier's 6x spring stands in for GL's tube attraction)
        if (poke > 1e-3) {
          const dx_ = px - PR[0], dy_ = py - PR[1], dz_ = pz - PR[2], al = dx_ * HD[0] + dy_ * HD[1] + dz_ * HD[2];
          const qx = dx_ - HD[0] * al, qy = dy_ - HD[1] * al, qz = dz_ - HD[2] * al, hd = Math.max(Math.hypot(qx, qy, qz), 1e-3);
          let hk = 1 - smoothstep(0, HAND.radius, hd); hk *= hk * handW(al); const hand = poke * poke * hk * (1 + HAND.spread * (2 * r - 1));   // squared as in SIM_FS
          const sh = hand * HAND.shove, dr = hand * HAND.drag;
          ax += qx / hd * sh + PV[0] * dr; ay += qy / hd * sh + PV[1] * dr; az += qz / hd * sh + PV[2] * dr;
        }
        // the resync front: kicked home as it passes; behind it the breach no longer weakens the spring (as SIM_FS)
        let behind = 0;
        if (RA > 1e-3) {
          const rs = Math.hypot(vxh, vyh), dfr = rs - RF, wave = RA * Math.exp(-dfr * dfr / (RB * RB));   // view-space radius of the home
          behind = RA * (1 - smoothstep(RF - 0.25, RF, rs));
          ax += (tx - px) * RESET.kick * wave; ay += (ty - py) * RESET.kick * wave; az += (tz - pz) * RESET.kick * wave;
        }
        const sw = 2e-4 * (1 - 0.5 * tight) * (0.7 + 0.3 * r);
        ax += Math.sin(py * 7 + time * (1 + 0.7 * r)) * sw; ay += Math.sin(pz * 7 + time * 0.8) * sw; az += Math.sin(px * 7 - time * 0.6) * sw;
        const k = 1e-3 * (1 + 0.3 * tight) * built * (1 - 0.65 * fl) * (1 - 0.7 * tr * (1 - behind)) * 6;   // stiffer than GL: no SDF attraction here
        vx[i] = (vx[i] + (ax + (tx - px) * k) * ratio) * fr; vy[i] = (vy[i] + (ay + (ty - py) * k) * ratio) * fr; vz[i] = (vz[i] + (az + (tz - pz) * k) * ratio) * fr;
        px += vx[i] * ratio; py += vy[i] * ratio; pz += vz[i] * ratio;
        ox[i] = px - hx; oy[i] = py - hy; oz[i] = pz - hz;
        projectPx(VP, [px, py, pz], W, H, tmp);
      } else if (!motion) {
        ox[i] = tx - hx; oy[i] = ty - hy; oz[i] = tz - hz; px = tx; py = ty; pz = tz;
        projectPx(VP, [px, py, pz], W, H, tmp);
      }
      sx[i] = tmp[0]; sy[i] = H - tmp[1]; sz[i] = tmp[2];
      // light: wrap diffuse from the key with the radial as the normal
      const nl = Math.hypot(hx, hy, hz) || 1;
      const diff = Math.max(((hx * L[0] + hy * L[1] + hz * L[2]) / nl + 0.25) / 1.25, 0);
      const speed = Math.hypot(vx[i], vy[i], vz[i]);
      const tr2 = sim ? model.trailGrid.at(tmp[0] / W, tmp[1] / H) : 0;
      const head = sim ? model.trailGrid.front(tmp[0] / W, tmp[1] / H) : 0;      // the tear's bright head (as RENDER_FS)
      // ring ripple, tap wave, sentry band, flicker (same formulas as RENDER_VS, scalar)
      let ring = 0;
      if (ringAmp > 0.001) {
        const dp = hx * pnx + hz * pnz, planeD = Math.abs(dp);
        const ix = hx - pnx * dp, iy = hy, iz = hz - pnz * dp, il = Math.hypot(ix, iy, iz) || 1;
        const ang = Math.acos(clamp(-iy / il, -1, 1));
        ring = ringAmp * Math.exp(-(((ang - Math.PI * ringPhase) / 0.22) ** 2)) * Math.exp(-((planeD / 0.1) ** 2));
      }
      const tap = tapT > 0 && tapT < 1 ? Math.exp(-(((Math.hypot(hx - tapX, hy - tapY, hz - tapZ) - 2.4 * tapT) / 0.14) ** 2)) * (1 - tapT) : 0;
      const sen = sentry > 0 ? 0.15 * Math.exp(-(((0.5 + 0.5 * (hx * KEY[0] + hy * KEY[1] + hz * KEY[2]) / nl - (1 - sentry)) / 0.08) ** 2)) : 0;
      const flick = r < 0.08 ? 0.6 + 0.4 * Math.sin(0.8 * time + 97 * r) * Math.sin(1.73 * time + 31 * r) : 1;
      const dfr = Math.hypot(vxh, vyh) - RF, wave = RA > 1e-3 ? RA * Math.exp(-dfr * dfr / (RB * RB)) : 0;   // the resync ring's light (the tap's vocabulary)
      const grow = 1 + 0.3 * (ring + tap + wave) + 0.12 * d2[i];
      const boost = 1 + 1.5 * (ring + tap + wave) + sen;
      const lit = 0.25 + 0.75 * diff;
      let tn = lit < 0.35 ? 0 : lit < 0.62 ? 1 : 2;
      let touch = 0;
      if (s.wake > 1e-3) {
        const dx_ = px - PR[0], dy_ = py - PR[1], dz_ = pz - PR[2], al = dx_ * HD[0] + dy_ * HD[1] + dz_ * HD[2];
        let hk2 = 1 - smoothstep(0, 1.1 * HAND.radius, Math.hypot(dx_ - HD[0] * al, dy_ - HD[1] * al, dz_ - HD[2] * al)); hk2 *= hk2 * handW(al); touch = s.wake * hk2;
      }
      if (speed > 0.004 || tr2 > 0.25 || d2[i] > 0.45 || touch > 0.3 || wave > 0.3) tn = 3;
      // perspective size: nearer sprites larger; energy-conserving intensity
      const depth = w > 0 ? cam.dist / w : 1;
      const grain = (r * 13.7) % 1;                    // per-particle grain, fixed for life
      const sizeF = depth * grow * (0.75 + 0.55 * grain);
      sizeIdx[i] = sizeF < 0.97 ? 0 : sizeF < 1.08 ? 1 : 2;
      const energy = Math.max(0.03, Math.pow(1 / grow, 1.5));
      const fwd = cam.forward, back = (hx * fwd[0] + hy * fwd[1] + hz * fwd[2]) > 0 ? 0.45 : 1;   // far hemisphere dimmer: the cage has a back
      const dz = (view4[2] * hx + view4[6] * hy + view4[10] * hz) / nl;                           // limb factor: edge-on struts stop stacking to white
      inten[i] = 0.95 * dens * built * flick * boost * energy * (0.35 + 0.65 * lit) * back * (0.35 + 0.65 * Math.abs(dz)) * (1 + 0.6 * tr2 + 0.8 * d2[i] * d2[i]) * (1 + 0.1 * u.u_engage.value) * (1 + touch) * (1 + 0.5 * head);
      // the ember inside the cage (as RENDER_FS): a sprite behind it shows its lit face and takes its tone; one in front catches a
      // quarter (its rim) and veils the source
      const vxp = view4[0] * px + view4[4] * py + view4[8] * pz + view4[12] - EV[0], vyp = view4[1] * px + view4[5] * py + view4[9] * pz + view4[13] - EV[1];
      const vzp = view4[2] * px + view4[6] * py + view4[10] * pz + view4[14] - EV[2], rho2 = vxp * vxp + vyp * vyp, nearer = vzp > 0;
      const eL = eGain * Math.exp(-rho2 / eReach2) / (1 + (rho2 + vzp * vzp) / eFall2) * (nearer ? 0.25 : 1);
      if (tn < 3 && (eL > 0.10 || (tone[i] === 4 && eL > 0.08))) tn = 4;   // hysteresis: the idle breath and drift never flicker the tone
      inten[i] *= 1 + 1.2 * eL;
      veil[i] = nearer && rho2 < 0.25 ? 1 : 0;   // in front and within 0.5 R of the ember in the view plane
      tone[i] = tn;
    }
    // ---- paint: emissive layer first (on black), then background + layer + bloom of the layer ----
    if (layer.width !== W || layer.height !== H) { layer.width = W; layer.height = H; }
    {
    const ctx = lctx;                                   // block-scoped: the emissive layer
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    // the ember: the source (core + the back half of the halo), veiled only by sprites NEARER than it; the halo's front half is the
    // air between the camera and everything, painted over the veil. Sprites behind it are painted later and only add.
    const ex = cam.emberPx[0], ey = H - cam.emberPx[1], er = cam.emberR;
    if (lvl > 0.001) {
      const warm = u.u_warm.value, a = Math.min(1, lvl), air = 0.5;
      let g = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 1.6);
      g.addColorStop(0, `rgba(255,${Math.round(226 + 10 * warm)},${Math.round(186 + 10 * warm)},${a})`);
      g.addColorStop(0.04, `rgba(255,216,166,${0.9 * a})`);
      g.addColorStop(0.12, `rgba(240,166,94,${0.35 * a * (1 - air)})`);
      g.addColorStop(0.3, `rgba(240,166,94,${0.08 * a * (1 - air)})`);
      g.addColorStop(1, 'rgba(240,166,94,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(ex - er * 1.6, ey - er * 1.6, er * 3.2, er * 3.2);
      // the veil: the union of the front sprites (source-over into a mask the size of the ember box), erased once at EMBER_LIGHT.veil,
      // so overlapping sprites can never cut deeper than one (GL's floor), never a black hole
      const bx = Math.floor(ex - er * 1.6), by = Math.floor(ey - er * 1.6), bs = Math.ceil(er * 3.2) + 2;
      if (vmask.width !== bs || vmask.height !== bs) { vmask.width = bs; vmask.height = bs; } else vctx.clearRect(0, 0, bs, bs);
      vctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < N; i++) { if (!veil[i] || sz[i] <= 0 || inten[i] < 0.02) continue; const sp = sprites[sizeIdx[i]][0], half = sp.width / 2; vctx.drawImage(sp, sx[i] - half - bx, sy[i] - half - by); }
      ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = EMBER_LIGHT.veil; ctx.drawImage(vmask, bx, by); ctx.globalAlpha = 1;
      g = ctx.createRadialGradient(ex, ey, 0, ex, ey, er * 1.6);
      g.addColorStop(0, 'rgba(240,166,94,0)');
      g.addColorStop(0.04, 'rgba(240,166,94,0)');
      g.addColorStop(0.12, `rgba(240,166,94,${0.35 * a * air})`);
      g.addColorStop(0.3, `rgba(240,166,94,${0.08 * a * air})`);
      g.addColorStop(1, 'rgba(240,166,94,0)');
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(ex - er * 1.6, ey - er * 1.6, er * 3.2, er * 3.2);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let b = 0; b < BUCKETS.length; b++) {
      ctx.globalAlpha = BUCKETS[b];
      const lo = b === 0 ? 0.02 : (BUCKETS[b - 1] + BUCKETS[b]) / 2, hi = b === BUCKETS.length - 1 ? Infinity : (BUCKETS[b] + BUCKETS[b + 1]) / 2;
      for (let i = 0; i < N; i++) {
        const I = inten[i];
        if (I < lo || I >= hi || sz[i] <= 0) continue;
        const sp = sprites[sizeIdx[i]][tone[i]], half = sp.width / 2;
        ctx.drawImage(sp, sx[i] - half, sy[i] - half);
      }
    }
    ctx.globalAlpha = 1;
    // class nodes while a row-1 word is hovered
    const classAmp = u.u_classAmp.value;
    if (classAmp > 0.001) {
      const sel = Math.round(u.u_classSel.value), sp = sprites[1][3];
      ctx.globalAlpha = 0.6 * classAmp;
      for (let i = 0; i < NODES; i++) {
        if (shape.nodeClass[i] !== sel) continue;
        projectPx(VP, [shape.nodes[i * 3], shape.nodes[i * 3 + 1], shape.nodes[i * 3 + 2]], W, H, tmp);
        ctx.drawImage(sp, tmp[0] - sp.width / 2, H - tmp[1] - sp.width / 2);
      }
      ctx.globalAlpha = 1;
    }
    // hairlines: one path, 1 px, white at 0.25
    if (model.linkAlpha > 0.001) {
      const count = model.plexus.writeVertices(shape.nodes, linkBuf, 1);
      if (count) {
        ctx.beginPath();
        for (let v = 0; v < count; v += 2) {
          projectPx(VP, [linkBuf[v * 4], linkBuf[v * 4 + 1], linkBuf[v * 4 + 2]], W, H, tmp); ctx.moveTo(tmp[0], H - tmp[1]);
          projectPx(VP, [linkBuf[v * 4 + 4], linkBuf[v * 4 + 5], linkBuf[v * 4 + 6]], W, H, tmp); ctx.lineTo(tmp[0], H - tmp[1]);
        }
        ctx.strokeStyle = `rgba(215,233,247,${0.25 * model.linkAlpha})`; ctx.lineWidth = Math.max(1, scale * 0.75); ctx.stroke();
      }
    }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;   // the page canvas
    ctx.fillStyle = '#080a0e'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(hazeImg, cam.shellPx.x + cam.hazePx[0] - hazeR, H - cam.shellPx.y - cam.hazePx[1] - hazeR);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(layer, 0, 0);
    // bloom: quarter-res copy of the layer's shell box, drawn back softly (never ctx.filter)
    const R = cam.shellPx.r, cx = cam.shellPx.x, cy = H - cam.shellPx.y;
    const bx = Math.max(0, cx - 1.25 * R), by = Math.max(0, cy - 1.25 * R), bw = Math.min(W - bx, 2.5 * R), bh = Math.min(H - by, 2.5 * R);
    if (bw > 4 && bh > 4) {
      const qw = Math.max(1, Math.round(bw / 4)), qh = Math.max(1, Math.round(bh / 4));
      if (small.width !== qw || small.height !== qh) { small.width = qw; small.height = qh; }
      sctx.globalCompositeOperation = 'copy'; sctx.drawImage(layer, bx, by, bw, bh, 0, 0, qw, qh);
      ctx.globalAlpha = 0.2; ctx.drawImage(small, 0, 0, qw, qh, bx, by, bw, bh); ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    if (u.u_dim.value > 0) { ctx.fillStyle = `rgba(0,0,0,${0.5 * u.u_dim.value})`; ctx.fillRect(0, 0, W, H); }
    return true;
  }

  // The governor lowers the active sprite count without reallocating, so particles keep their state.
  return { type: 'canvas2d', software: false, lost: () => false, ready: () => true, resize() {}, draw, destroy() {}, setSprites(n) {
    const next = Math.max(250, Math.min(maxN, Math.round(n)));
    // Sprites coming back start at rest on the lattice; their stored state is stale from when they were last drawn.
    for (const a of [ox, oy, oz, vx, vy, vz, d1, d2]) a.fill(0, N, Math.max(N, next));
    N = next;
  }, get sprites() { return N; } };
}
