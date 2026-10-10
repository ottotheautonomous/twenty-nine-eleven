import { createGL, createProgram, createTarget, createPair, blit, bindTex, FULLSCREEN_VS } from './gl.js';
import { createFluid } from './fluid.js';
import { createParticles } from './particles.js';
import { createBloom } from './bloom.js';
import { loadBlueNoise, blueNoiseOffset } from './bluenoise.js';
import { createPlexusRenderer } from './plexus.js';
import { frameRatio } from './damp.js';
import { COLORS, NODES, hexRGB, linearRGB } from './constants.js';
import bnUrl from './bn64-rgb.png?url';
import noiseSrc from './glsl/noise.glsl?raw';
import sdfSrc from './glsl/sdf.glsl?raw';
import trailSrc from './glsl/trail.glsl?raw';
import emberSrc from './glsl/ember.glsl?raw';
import compositeSrc from './glsl/composite.glsl?raw';

// "GL or Canvas2D" is decided on a scratch canvas: a canvas that has handed out a WebGL context can never give a 2D one.
export function probeGPU() {
  const scratch = document.createElement('canvas');
  let ctx = null;
  try { ctx = createGL(scratch, { powerPreference: 'low-power' }); } catch { ctx = null; }
  if (!ctx) return { ok: false };
  const { gl, caps } = ctx;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
  const ok = caps.rgba16f && caps.rg16f && caps.maxDrawBuffers >= 3;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { ok, gpu, software, rgba32f: caps.rgba32f, parallel: !!caps.parallel, maxPointSize: caps.maxPointSize };
}

const CLASS_VS = `
layout(location = 0) in vec3 aPos; layout(location = 1) in float aClass;
uniform mat4 uViewProj; uniform float uSel, uAmp, uBacking; out float vA;
void main() { vA = abs(aClass - uSel) < 0.5 ? uAmp : 0.0; gl_Position = uViewProj * vec4(aPos, 1.0); gl_PointSize = 4.0 * uBacking; if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
const CLASS_FS = `
in float vA; out vec4 o;
void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = (1.0 - smoothstep(0.5, 1.0, r2)) * vA * 0.6; o = vec4(vec3(0.84, 0.91, 0.97) * a * 2.0, 0.0); }`;

function createClassNodes(gl, caps, shape) {
  const program = createProgram(gl, caps, CLASS_VS, CLASS_FS);
  const data = new Float32Array(NODES * 4);
  for (let i = 0; i < NODES; i++) data.set([shape.nodes[i * 3], shape.nodes[i * 3 + 1], shape.nodes[i * 3 + 2], shape.nodeClass[i]], i * 4);
  const vao = gl.createVertexArray(), vbo = gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
  gl.bindVertexArray(null);
  return {
    program,
    draw(cam, u, backing) {
      if (!program.ready()) return;
      const p = program.uniforms;
      gl.useProgram(program.program);
      gl.uniformMatrix4fv(p.uViewProj, false, cam.viewProj);
      gl.uniform1f(p.uSel, u.u_classSel.value); gl.uniform1f(p.uAmp, u.u_classAmp.value); gl.uniform1f(p.uBacking, backing);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      gl.bindVertexArray(vao); gl.drawArrays(gl.POINTS, 0, NODES); gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },
    dispose() { gl.deleteBuffer(vbo); gl.deleteVertexArray(vao); gl.deleteProgram(program.program); },
  };
}

export function emberLevel(u, t) {
  return u.u_ember.value * (1 + u.u_boostPress.value + u.u_boostGreet.value + 0.2 * u.u_engage.value + 0.4 * u.u_open.value + 0.2 * u.u_warm.value)
    * (1 - 0.15 * u.u_tear.value) * (1 + 0.05 * Math.sin(1.9 * t) * u.u_idle.value);
}

export function createWebGLRenderer(canvas, uniforms, shape, model, { tier, probe, flags = new Set() }) {
  let ctx = null;
  try { ctx = createGL(canvas, { powerPreference: tier.mobile ? 'default' : 'high-performance' }); } catch { ctx = null; }
  if (!ctx) return null;
  const { gl, caps } = ctx;
  if (!caps.rgba16f || !caps.rg16f || caps.maxDrawBuffers < 3) return null;

  const fluid = createFluid(gl, caps, { simRes: tier.fluidRes, pressureIterations: tier.jacobi, curl: 0, velocityDecay: 0.98, splatRadius: 0.10, splatGain: 1.0, maxSplatGapMs: 150 });
  let particles = createParticles(gl, caps, { noiseSrc, sdfSrc, side: tier.side, state32: tier.state32 && caps.rgba32f, homes: shape.homes, latticeRotT: shape.rotT, shape: shape.shapeId });
  if (!particles.mrtOk && tier.state32) {
    particles.dispose();
    particles = createParticles(gl, caps, { noiseSrc, sdfSrc, side: tier.side, state32: false, homes: shape.homes, latticeRotT: shape.rotT, shape: shape.shapeId });
  }
  if (!particles.mrtOk) return null;
  const bloom = createBloom(gl, caps, { levels: tier.bloomLevels, threshold: 0.5, smoothing: 0.03, radius: 0.85 });
  const trailP = createProgram(gl, caps, FULLSCREEN_VS, trailSrc);
  const emberP = createProgram(gl, caps, FULLSCREEN_VS, emberSrc);
  const compP = createProgram(gl, caps, FULLSCREEN_VS, compositeSrc);
  const plexus = createPlexusRenderer(gl, caps, createProgram, model.plexus);
  const classNodes = createClassNodes(gl, caps, shape);
  const programs = [trailP, emberP, compP, plexus.program, classNodes.program, ...Object.values(fluid.programs), ...Object.values(particles.programs), ...Object.values(bloom.programs)];

  // Dither: a flat 1x1 until the blue-noise PNG arrives.
  let blue = { texture: gl.createTexture(), size: 1 };
  gl.bindTexture(gl.TEXTURE_2D, blue.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 128, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  loadBlueNoise(gl, bnUrl).then((b) => { if (!gl.isContextLost()) blue = b; }).catch(() => {});

  const hdrFmt = { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR };
  const colors = { colDark: linearRGB(COLORS.shadow), colLight: linearRGB(COLORS.hi), colFast: linearRGB(COLORS.rim), ember: linearRGB(COLORS.ember), hot: linearRGB(COLORS.hot) };
  const srgb = { ink: hexRGB(COLORS.ink), haze: hexRGB(COLORS.haze), slate: hexRGB(COLORS.slate), accent: hexRGB(COLORS.ember) };
  const inkLinear = linearRGB(COLORS.ink);
  let W = 1, H = 1, hdr = [null, null], hdrIndex = 0, trail = null, rows = tier.rowsStart, stillSeeded = false, lastError = 0;
  const bnOffset = [0, 0];

  function resize(width, height) {
    W = Math.max(1, Math.round(width * tier.hdrScale)); H = Math.max(1, Math.round(height * tier.hdrScale));
    hdr.forEach((t) => t?.dispose());
    hdr = [createTarget(gl, W, H, hdrFmt), createTarget(gl, W, H, hdrFmt)];
    trail?.dispose(); trail = createPair(gl, Math.max(1, Math.round(W / 5)), Math.max(1, Math.round(H / 5)), hdrFmt);
    bloom.resize(W, H); fluid.resize(width, height);
    stillSeeded = false;
  }
  const ok = () => programs.every((p) => p.ready());
  let warmed = false;
  function warmup() {
    if (warmed || !ok() || !hdr[0]) return;
    warmed = true;
    particles.reset();
    gl.bindFramebuffer(gl.FRAMEBUFFER, hdr[0].fbo); gl.viewport(0, 0, W, H);
    particles.draw(model.cam, 1, uniforms, drawOpts(0));             // ANGLE's gl.POINTS variant, paid before the canvas is visible
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function drawOpts(time) {
    const cam = model.cam, count = rows * tier.side[0];
    const rPx = cam.shellPx.r * tier.hdrScale;
    return {
      trail: trail.read.texture, time, invRes: [1 / W, 1 / H],
      sizeK: particles.cfg.sizePx * (rPx / 135) * cam.dist * (tier.mobile ? 1.15 : 1),
      intensity: particles.cfg.intensity * Math.min(4, 131072 / Math.max(1, count)),
      emberLevel: emberLevel(uniforms, time), ...colors,
    };
  }

  function stepTrail(ratio) {
    const t = model.trail, p = trailP.uniforms;
    gl.useProgram(trailP.program); gl.disable(gl.BLEND);
    gl.uniform1i(p.uPrev, bindTex(gl, 0, trail.read.texture));
    gl.uniform2f(p.uA, t.ax, t.ay); gl.uniform2f(p.uB, t.bx, t.by);
    gl.uniform1f(p.uRadius, t.pressDisc ? 0.06 : t.radius);
    gl.uniform1f(p.uAspect, W / H); gl.uniform1f(p.uDecay, Math.pow(0.985, ratio)); gl.uniform1f(p.uGrow, 0.35); gl.uniform1f(p.uTime, model.time % 1000);
    blit(gl, trail.write); trail.swap();
    t.pressDisc = false;
  }
  function clearTrail() {
    for (const target of [trail.read, trail.write]) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function drawEmber(prev, cam, u, time) {
    const p = emberP.uniforms, s = tier.hdrScale;
    const ex = cam.emberPx[0] * s, ey = cam.emberPx[1] * s, er = Math.max(1, cam.emberR * s);
    const x0 = Math.max(0, Math.floor(ex - 3 * er)), y0 = Math.max(0, Math.floor(ey - 3 * er));
    const x1 = Math.min(W, Math.ceil(ex + 3 * er)), y1 = Math.min(H, Math.ceil(ey + 3 * er));
    if (x1 <= x0 || y1 <= y0) return;
    gl.useProgram(emberP.program);
    gl.uniform1i(p.uPrevHdr, bindTex(gl, 0, prev.texture)); gl.uniform1i(p.uTrail, bindTex(gl, 1, trail.read.texture));
    gl.uniform2f(p.uEmberPx, ex, ey); gl.uniform1f(p.uEmberR, er);
    gl.uniform3fv(p.uEmberCol, colors.ember); gl.uniform3fv(p.uEmberHot, colors.hot);
    gl.uniform1f(p.uLevel, emberLevel(u, time)); gl.uniform1f(p.uFlicker, 0.08 * (1 - u.u_build.value));
    gl.uniform1f(p.uWarmMix, u.u_warm.value); gl.uniform1f(p.uTime, time % 1000); gl.uniform2f(p.uInvRes, 1 / W, 1 / H);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(x0, y0, x1 - x0, y1 - y0);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND); gl.disable(gl.SCISSOR_TEST);
  }

  function composite(cur, bloomTex, cam, u) {
    const p = compP.uniforms;
    gl.useProgram(compP.program);
    gl.uniform1i(p.uScene, bindTex(gl, 0, cur.texture)); gl.uniform1i(p.uBloom, bindTex(gl, 1, bloomTex)); gl.uniform1i(p.uBlue, bindTex(gl, 2, blue.texture));
    blueNoiseOffset(blue.size, bnOffset); gl.uniform2i(p.uBlueOffset, bnOffset[0], bnOffset[1]);
    gl.uniform1f(p.uBloomIntensity, 0.9); gl.uniform1f(p.uExposure, 1.0);
    gl.uniform3fv(p.uInk, srgb.ink); gl.uniform3fv(p.uHaze, srgb.haze); gl.uniform3fv(p.uSlate, srgb.slate); gl.uniform3fv(p.uAccent, srgb.accent);
    gl.uniform1f(p.uLift, 0.12); gl.uniform1f(p.uHighlightTint, 0.08); gl.uniform1f(p.uVignette, 0.25); gl.uniform1f(p.uDither, 1.0);
    gl.uniform3f(p.uShell, cam.shellPx.x, cam.shellPx.y, cam.shellPx.r);
    gl.uniform1f(p.uGuardY, cam.guardY); gl.uniform1f(p.uGuardFeather, (tier.mobile ? 16 : 28) * (cam.scaleY || 1));
    gl.uniform1f(p.uDim, u.u_dim.value); gl.uniform1f(p.uCA, u.u_ca.value);
    blit(gl, null);
  }

  function draw(view, dtMs) {
    if (gl.isContextLost() || !ok() || !hdr[0]) return false;
    const u = uniforms, motion = u.u_motion.value, cam = model.cam, s = model.state;
    const ratio = frameRatio(dtMs), dt = Math.min(dtMs, 1000 / 30) / 1000, time = view.time;
    const cur = hdr[hdrIndex], prev = hdr[hdrIndex ^ 1];
    if (motion === 0) {
      // The composed still: the cage exactly at home, built, no trail.
      if (!stillSeeded) { particles.reset(); clearTrail(); particles.step(0, time, cam, fluid.texture, trail.read.texture, u, rows); stillSeeded = true; }
    } else {
      stillSeeded = false;
      if (dtMs > 0) {
        if (s.simulate) { fluid.step(dt); stepTrail(ratio); }
        particles.step(ratio, time, cam, fluid.texture, trail.read.texture, u, rows);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo); gl.viewport(0, 0, W, H);
    gl.clearColor(inkLinear[0], inkLinear[1], inkLinear[2], 0); gl.clear(gl.COLOR_BUFFER_BIT);
    particles.draw(cam, rows * tier.side[0], u, drawOpts(time));
    if (u.u_classAmp.value > 0.001) classNodes.draw(cam, u, (cam.scaleY || 1) * tier.hdrScale);
    if (model.linkAlpha > 0.001) plexus.draw(shape.nodes, cam.viewProj, [0.84, 0.91, 0.97], 0.25 * model.linkAlpha);
    drawEmber(prev, cam, u, time);
    const bloomTex = bloom.render(cur.texture, W, H) || cur.texture;
    composite(cur, bloomTex, cam, u);
    hdrIndex ^= 1;
    if (view.readout) lastError = gl.getError();          // debug only: getError stalls the pipeline
    return true;
  }

  return {
    type: 'webgl2', software: probe.software, gl, fluid,
    lost: () => gl.isContextLost(),
    ready: () => ok() && !!hdr[0],
    warmup, resize, draw,
    setRows(n) { rows = Math.max(1, Math.min(tier.side[1], Math.round(n))); },
    glError: () => lastError,
    get rows() { return rows; },
    destroy() {
      if (gl.isContextLost()) return;
      fluid.dispose(); particles.dispose(); classNodes.dispose();
      hdr.forEach((t) => t?.dispose()); trail?.dispose();
      [trailP, emberP, compP, plexus.program].forEach((p) => gl.deleteProgram(p.program));
    },
  };
}
