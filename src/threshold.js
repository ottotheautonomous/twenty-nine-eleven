import { frame, cancelFrame } from 'motion';
import { VERTEX_SOURCE, FRAGMENT_SOURCE, toGLSL1 } from './shader.js';

// Scene constants shared with shader.js. The Canvas2D renderer projects the
// same geometry with the same camera, so every fallback is the same design.
const FLOOR_Y = -0.66, CAM_D = 3.2, DEPTH = 0.11, OPEN = 0.285, ARCH_Y = 0.13;
const OUTER = [0.37, 0.5];
const LAMP = [0, -0.08, -1.7];
const BUILTIN = ['res', 'anchor', 'anchorH', 'time', 'quality', 'debug'];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

function createWebGLRenderer(canvas, uniforms, version) {
  const options = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false };
  let gl;
  try { gl = canvas.getContext(version === 2 ? 'webgl2' : 'webgl', options); } catch { return null; }
  if (!gl) return null;
  if (version === 1) {
    if (!gl.getExtension('OES_standard_derivatives')) return null;
    if (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision <= 0) return null;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  let program, buffer, vertexArray;
  try {
    const vertex = compile(gl, gl.VERTEX_SHADER, version === 2 ? VERTEX_SOURCE : toGLSL1(VERTEX_SOURCE, 'vertex'));
    const fragment = compile(gl, gl.FRAGMENT_SHADER, version === 2 ? FRAGMENT_SOURCE : toGLSL1(FRAGMENT_SOURCE, 'fragment'));
    program = gl.createProgram();
    gl.attachShader(program, vertex); gl.attachShader(program, fragment);
    if (version === 1) gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    gl.detachShader(program, vertex); gl.detachShader(program, fragment);
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    if (version === 2) {
      vertexArray = gl.createVertexArray();
    } else {
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    }
  } catch (error) {
    if (program) gl.deleteProgram(program);
    console.warn(error.message);
    return null;
  }
  const keys = Object.keys(uniforms);
  const locations = Object.fromEntries([...BUILTIN.map(name => `u_${name}`), ...keys].map(name => [name, gl.getUniformLocation(program, name)]));
  return {
    type: version === 2 ? 'webgl2' : 'webgl',
    software: /swiftshader|llvmpipe|software|basic render/i.test(gpu),
    lost: () => gl.isContextLost(),
    draw(view) {
      if (gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      if (version === 2) gl.bindVertexArray(vertexArray);
      else { gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
      gl.uniform2f(locations.u_res, canvas.width, canvas.height);
      gl.uniform2f(locations.u_anchor, view.anchorX, canvas.height - view.anchorY);
      gl.uniform1f(locations.u_anchorH, view.anchorH);
      gl.uniform1f(locations.u_time, view.time);
      gl.uniform1f(locations.u_quality, view.quality);
      gl.uniform1f(locations.u_debug, view.debug);
      for (const key of keys) gl.uniform1f(locations[key], uniforms[key].value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() {
      if (gl.isContextLost()) return;
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (buffer) gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

// The same room drawn with 2D paths: the camera, door, opening, shaft, grid
// and lights all come from the shared uniforms and geometry.
function createCanvasRenderer(canvas, uniforms) {
  let ctx;
  try { ctx = canvas.getContext('2d', { alpha: false }); } catch { return null; }
  if (!ctx) return null;
  const u = key => uniforms[key].value;
  const outline = (z, dy) => {
    const [ox, oy] = OUTER; const points = [[-ox, -oy, z], [-ox, oy, z], [ox, oy, z], [ox, -oy, z], [OPEN, -oy, z], [OPEN, ARCH_Y, z]];
    for (let i = 1; i < 24; i++) { const a = (i / 24) * Math.PI; points.push([Math.cos(a) * OPEN, ARCH_Y + Math.sin(a) * OPEN, z]); }
    points.push([-OPEN, ARCH_Y, z], [-OPEN, -oy, z]);
    return points.map(p => [p[0], p[1] + dy, p[2]]);
  };
  const opening = (z, dy) => {
    const points = [[OPEN, -OUTER[1], z], [OPEN, ARCH_Y, z]];
    for (let i = 1; i < 24; i++) { const a = (i / 24) * Math.PI; points.push([Math.cos(a) * OPEN, ARCH_Y + Math.sin(a) * OPEN, z]); }
    points.push([-OPEN, ARCH_Y, z], [-OPEN, -OUTER[1], z]);
    return points.map(p => [p[0], p[1] + dy, p[2]]);
  };
  return {
    type: 'canvas2d',
    software: false,
    lost: () => false,
    draw(view) {
      const W = canvas.width, H = canvas.height, motion = u('u_motion');
      const yaw = (u('u_yaw') + u('u_idle') * 0.06 * Math.sin(view.time * 0.37)) * motion;
      const pitch = -0.10 + (u('u_pitch') + u('u_idle') * 0.03 * Math.sin(view.time * 0.23 + 1)) * motion;
      const dist = CAM_D + 0.6 * u('u_dolly');
      const target = [0, -0.02, 0];
      let ox = 0, oy = Math.sin(pitch) * dist, oz = Math.cos(pitch) * dist;
      [ox, oz] = [Math.cos(yaw) * ox + Math.sin(yaw) * oz, -Math.sin(yaw) * ox + Math.cos(yaw) * oz];
      const ro = [target[0] + ox, target[1] + oy, target[2] + oz];
      const fwd = normalize(sub(target, ro)), right = normalize(cross(fwd, [0, 1, 0])), up = cross(right, fwd);
      const focal = 2 * CAM_D * (view.anchorH / H), half = 0.5 * H;
      const project = p => {
        const d = sub(p, ro); const z = Math.max(dot(d, fwd), 0.05);
        return [view.anchorX + (dot(d, right) / z) * focal * half, view.anchorY - (dot(d, up) / z) * focal * half, z];
      };
      const path = points => { ctx.beginPath(); points.forEach((p, i) => { const [x, y] = project(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
      const dawn = u('u_dawn') * (1 - 0.6 * u('u_dim')) * (1 + 0.35 * u('u_engage'));
      const dy = (u('u_rise') - 1) * 0.35, reveal = u('u_reveal');
      const lamp = project(LAMP), px = lamp[0], py = lamp[1];

      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.fillStyle = '#0b0f12'; ctx.fillRect(0, 0, W, H);
      const horizon = project([0, FLOOR_Y, -40])[1];
      ctx.globalCompositeOperation = 'lighter';
      // The plan: grid revealed by the lamp pool in front of the door and the visitor light.
      const pool = project([0, FLOOR_Y, 0.9]), visitor = project([u('u_lightX'), FLOOR_Y, 1.15]);
      const reach = u('u_plan');
      const gridGlow = ctx.createRadialGradient(pool[0], pool[1], 0, pool[0], pool[1], Math.max(W, H) * 0.55 * Math.max(reach, 0.01));
      gridGlow.addColorStop(0, `rgba(140,200,194,${0.05 + 0.10 * dawn})`); gridGlow.addColorStop(0.5, 'rgba(140,200,194,0.035)'); gridGlow.addColorStop(1, 'rgba(140,200,194,0)');
      ctx.strokeStyle = gridGlow; ctx.lineWidth = Math.max(1, H / 900);
      ctx.beginPath();
      const line = (a, b) => {
        const da = sub(a, ro), db = sub(b, ro); let za = dot(da, fwd), zb = dot(db, fwd);
        if (za < 0.3 && zb < 0.3) return;
        if (za < 0.3) { const t = (0.3 - za) / (zb - za); a = [a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t]; }
        if (zb < 0.3) { const t = (0.3 - zb) / (za - zb); b = [b[0] + (a[0] - b[0]) * t, b[1], b[2] + (a[2] - b[2]) * t]; }
        const pa = project(a), pb = project(b); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
      };
      for (let x = -3; x <= 3.001; x += 0.25) line([x, FLOOR_Y, -6], [x, FLOOR_Y, 3]);
      for (let z = -6; z <= 3.001; z += 0.25) line([-3, FLOOR_Y, z], [3, FLOOR_Y, z]);
      ctx.stroke();
      // Fog hides the far grid toward the horizon.
      ctx.globalCompositeOperation = 'source-over';
      const fog = ctx.createLinearGradient(0, horizon, 0, horizon + H * 0.1);
      fog.addColorStop(0, 'rgba(11,15,18,1)'); fog.addColorStop(1, 'rgba(11,15,18,0)');
      ctx.fillStyle = fog; ctx.fillRect(0, horizon - 1, W, H * 0.1 + 1);
      ctx.globalCompositeOperation = 'lighter';
      // Horizon glow.
      const band = ctx.createLinearGradient(0, horizon - H * 0.12, 0, horizon + H * 0.05);
      band.addColorStop(0, 'rgba(255,190,120,0)'); band.addColorStop(0.7, `rgba(255,190,120,${0.04 * dawn})`); band.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = band; ctx.fillRect(0, horizon - H * 0.12, W, H * 0.17);
      // Visitor light on the floor.
      const vr = H * 0.32;
      if (vr > 1) {
        const vg = ctx.createRadialGradient(visitor[0], visitor[1], 0, visitor[0], visitor[1], vr);
        vg.addColorStop(0, 'rgba(140,215,208,0.05)'); vg.addColorStop(1, 'rgba(140,215,208,0)');
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      }
      // Halo behind the door: the dawn seen around and through it.
      const haloR = view.anchorH * 1.4;
      const halo = ctx.createRadialGradient(px, py, 0, px, py, haloR);
      halo.addColorStop(0, `rgba(255,228,186,${0.55 * dawn})`); halo.addColorStop(0.18, `rgba(255,200,140,${0.16 * dawn})`); halo.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = halo; ctx.fillRect(px - haloR, py - haloR, haloR * 2, haloR * 2);
      // The shaft: the opening projected from the lamp toward the viewer.
      const slice = opening(0, dy);
      for (let i = 0; i < 12; i++) {
        const z = 0.12 + i * 0.13, s = (z - LAMP[2]) / -LAMP[2];
        const centre = project([LAMP[0], LAMP[1] + 0.1 * s, z]), reach = view.anchorH * s * 0.75 * (1.7 / (CAM_D - z + 0.3));
        const beam = ctx.createRadialGradient(centre[0], centre[1], 0, centre[0], centre[1], Math.max(1, reach));
        beam.addColorStop(0, `rgba(255,196,128,${0.022 * (1 - i / 13) * dawn})`); beam.addColorStop(1, 'rgba(255,196,128,0)');
        path(slice.map(p => [LAMP[0] + (p[0] - LAMP[0]) * s, LAMP[1] + (p[1] - LAMP[1]) * s, z]));
        ctx.fillStyle = beam; ctx.fill();
      }
      // Pulse ring across the floor.
      const pulse = u('u_pulse');
      if (pulse < 1 && motion > 0) {
        const radius = pulse * 2.8; const ring = [];
        for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; ring.push([Math.cos(a) * radius, FLOOR_Y, Math.sin(a) * radius]); }
        path(ring.filter(p => dot(sub(p, ro), fwd) > 0.3));
        ctx.strokeStyle = `rgba(255,190,120,${0.35 * (1 - pulse) ** 2})`; ctx.lineWidth = Math.max(1, H / 500); ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
      // Contact shadow.
      const foot = project([0, FLOOR_Y, 0]);
      const shadow = ctx.createRadialGradient(foot[0], foot[1], 0, foot[0], foot[1], view.anchorH * 0.55);
      shadow.addColorStop(0, `rgba(0,0,0,${0.55 * u('u_rise')})`); shadow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.translate(foot[0], foot[1]); ctx.scale(1, 0.18); ctx.translate(-foot[0], -foot[1]);
      ctx.fillStyle = shadow; ctx.fillRect(foot[0] - view.anchorH, foot[1] - view.anchorH, view.anchorH * 2, view.anchorH * 2); ctx.restore();

      // The door: inner reveal faces, then the smoked-glass front face.
      const front = opening(DEPTH, dy), back = opening(-DEPTH, dy);
      for (let i = 0; i < front.length - 1; i++) {
        path([front[i], front[i + 1], back[i + 1], back[i]]);
        const ny = i === 0 || i === front.length - 2 ? 0 : -Math.sin(((i + 0.5) / 24) * Math.PI);
        const warmth = (0.35 + 0.65 * Math.max(0, -ny)) * dawn;
        ctx.fillStyle = `rgba(${Math.round(40 + 150 * warmth)},${Math.round(44 + 105 * warmth)},${Math.round(44 + 60 * warmth)},${0.85 * reveal})`;
        ctx.fill();
      }
      const faceTop = project([0, OUTER[1] + dy, DEPTH]), faceBottom = project([0, -OUTER[1] + dy, DEPTH]);
      const face = ctx.createLinearGradient(0, faceTop[1], 0, faceBottom[1]);
      face.addColorStop(0, 'rgba(34,52,56,0.92)'); face.addColorStop(0.55, 'rgba(18,30,33,0.9)'); face.addColorStop(1, 'rgba(12,20,23,0.94)');
      path(outline(DEPTH, dy)); ctx.fillStyle = face; ctx.globalAlpha = reveal; ctx.fill(); ctx.globalAlpha = 1;
      // Edges: a cool glint that follows the visitor light, and a warm inner rim.
      const glint = ctx.createRadialGradient(visitor[0], visitor[1] - view.anchorH, 0, visitor[0], visitor[1] - view.anchorH, view.anchorH * 1.6);
      glint.addColorStop(0, 'rgba(200,240,236,0.85)'); glint.addColorStop(1, 'rgba(160,200,198,0.22)');
      path(outline(DEPTH, dy)); ctx.strokeStyle = glint; ctx.lineWidth = Math.max(1, H / 800); ctx.stroke();
      ctx.beginPath(); front.forEach((p, i) => { const [x, y] = project(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = `rgba(255,214,160,${0.18 + 0.5 * dawn})`; ctx.stroke();

      if (u('u_dim') > 0) { ctx.fillStyle = `rgba(0,0,0,${0.35 * u('u_dim')})`; ctx.fillRect(0, 0, W, H); }
    },
    destroy() {},
  };
}

export function createThreshold(canvas, anchorEl, uniforms, { debug = 0, readout: showReadout = false } = {}) {
  const coarse = matchMedia('(pointer: coarse)');
  const params = new URLSearchParams(location.search);
  const view = { anchorX: 0, anchorY: 0, anchorH: 1, time: 0, quality: 1, debug };
  const anchor = { x: 0, y: 0, h: 0 };
  let renderer = null;
  let active = false;
  let accum = 0;
  let ema = 16.7, slow = 0, fast = 0;
  let mobile = false, cap = 1.25, scale = 1.25;
  let readout = null;

  function pick() {
    return createWebGLRenderer(canvas, uniforms, 2) || createWebGLRenderer(canvas, uniforms, 1) || createCanvasRenderer(canvas, uniforms);
  }
  renderer = pick();
  canvas.dataset.renderer = renderer ? renderer.type : 'static';
  const governed = () => renderer && renderer.type !== 'canvas2d' && !renderer.software && !params.has('quality');

  function budget() {
    const w = Math.max(1, canvas.clientWidth || innerWidth), h = Math.max(1, canvas.clientHeight || innerHeight);
    const limit = (mobile ? 1.0e6 : 2.0e6) / (renderer?.type === 'canvas2d' ? 1.5 : 1);
    return { w, h, max: Math.sqrt(limit / (w * h)) };
  }
  function resize() {
    if (!renderer) return;
    mobile = innerWidth <= 700 || coarse.matches;
    view.quality = mobile ? 0 : 1;
    const { w, h, max } = budget();
    cap = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.25, max);
    scale = Math.min(scale, cap);
    if (!governed()) scale = cap;
    const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    project();
  }
  function project() {
    const sx = canvas.width / Math.max(1, canvas.clientWidth || innerWidth);
    const sy = canvas.height / Math.max(1, canvas.clientHeight || innerHeight);
    view.anchorX = anchor.x * sx; view.anchorY = anchor.y * sy; view.anchorH = Math.max(1, anchor.h * sy);
  }
  function measure() {
    const rect = anchorEl.getBoundingClientRect();
    anchor.x = rect.left + rect.width / 2; anchor.y = rect.top + rect.height / 2; anchor.h = rect.height;
    project();
    if (!active) drawOnce();
  }
  function draw() {
    if (!renderer || renderer.lost()) return;
    renderer.draw(view);
  }
  function governor(delta) {
    if (!governed() || view.time < 3) return;
    ema = ema * 0.94 + delta * 0.06;
    slow = ema > 20 ? slow + 1 : 0;
    fast = ema < 11 ? fast + 1 : 0;
    if (slow > 60 && scale > cap * 0.55) { scale = Math.max(cap * 0.55, scale * 0.8); slow = 0; resize(); }
    else if (fast > 180 && scale < cap) { scale = Math.min(cap, scale * 1.15); fast = 0; resize(); }
  }
  function tick({ delta }) {
    if (!active) return;
    const interval = mobile || renderer?.type === 'canvas2d' ? 1000 / 30 : 1000 / 60;
    accum += Math.min(delta, 40);
    if (accum < interval - 2) return;
    view.time += (accum / 1000) * uniforms.u_motion.value;
    accum = 0;
    draw();
    governor(delta);
    if (readout) readout.textContent = `${renderer.type} ${Math.round(1000 / ema)}fps ${scale.toFixed(2)}x ${canvas.width}x${canvas.height}`;
  }
  function drawOnce() { if (renderer) frame.render(draw); }
  function setActive(on) {
    on = Boolean(on && renderer);
    if (on === active) return;
    active = on;
    canvas.dataset.active = String(on);
    accum = 0;
    if (on) frame.render(tick, true); else { cancelFrame(tick); drawOnce(); }
  }

  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelFrame(tick); });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer = pick(); canvas.dataset.renderer = renderer ? renderer.type : 'static';
    resize(); if (active) { active = false; setActive(true); } else drawOnce();
  });
  if (showReadout) {
    readout = document.createElement('pre');
    readout.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;margin:0;font:11px monospace;color:#9fb3ae;pointer-events:none';
    document.body.append(readout);
  }
  canvas.dataset.active = 'false';
  resize();
  measure();
  return {
    get type() { return renderer ? renderer.type : 'static'; },
    measure, resize: () => { resize(); measure(); }, setActive, drawOnce,
    destroy() { setActive(false); renderer?.destroy(); },
  };
}
