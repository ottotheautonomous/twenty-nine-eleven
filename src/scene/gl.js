// SPDX-License-Identifier: 0BSD
// Minimal raw-WebGL2 plumbing for the kit: context + capability probe, program
// builder (GLSL ES 3.00, defines, optional KHR_parallel_shader_compile), render
// targets, ping-pong pairs, an attribute-less fullscreen triangle, and
// context-loss wiring. Written for Twenty Nine Eleven (2026). No dependencies.
//
// Format policy (why each choice, see research-kit.md section "Formats"):
//   simulation state (particle pos/vel)  RGBA32F  NEAREST, read with texelFetch only
//   fluid velocity                       RG16F    LINEAR (16F is filterable in core WebGL2)
//   fluid pressure/divergence/curl       R16F     NEAREST
//   HDR scene + bloom chain              RGBA16F  LINEAR, additive blending allowed
//   graded LDR (FXAA input)              RGBA8    LINEAR, luma in alpha
// Never filter or blend RGBA32F: OES_texture_float_linear (iOS ~49%) and
// EXT_float_blend (iOS ~51%) are missing on many phones (web3dsurvey.com).

export function createGL(canvas, attrs = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance', ...attrs,
  });
  if (!gl) return null;
  const caps = {
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'), // render to 16F/32F (~99.95%)
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),    // filter 32F
    floatBlend: !!gl.getExtension('EXT_float_blend'),              // blend into 32F
    parallel: gl.getExtension('KHR_parallel_shader_compile'),      // null on Firefox/Android
    pointSizeRange: gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE),  // [1, 64] on Apple M1/M2
    maxDrawBuffers: gl.getParameter(gl.MAX_DRAW_BUFFERS),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
  caps.rg16f = caps.colorBufferFloat && canRender(gl, gl.RG16F, gl.RG, gl.HALF_FLOAT);
  caps.rgba16f = caps.colorBufferFloat && canRender(gl, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT);
  caps.rgba32f = caps.colorBufferFloat && canRender(gl, gl.RGBA32F, gl.RGBA, gl.FLOAT);
  caps.maxPointSize = Math.min(caps.pointSizeRange[1], 64); // design for the Apple floor
  return { gl, caps };
}

// Framebuffer-completeness probe (same idea as Dobryakov's
// supportRenderTextureFormat): the only reliable renderability test.
export function canRender(gl, internalFormat, format, type) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
  return ok;
}

// Attribute-less fullscreen triangle. Every post/sim pass uses this VS.
export const FULLSCREEN_VS = `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER_FS = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';
const HEADER_VS = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n';

function defineBlock(defines) {
  return Object.entries(defines).map(([k, v]) => `#define ${k} ${v === true ? '' : v}\n`).join('');
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

// Returns { program, uniforms, ready() }. With KHR_parallel_shader_compile the
// link runs off-thread: poll ready() from the frame loop instead of reading
// LINK_STATUS immediately (reading it forces a synchronous wait). ANGLE/D3D11
// compiles HLSL through FXC, so long shaders (noise + SDF) can stall the main
// thread for 100s of ms on first use if you do not do this.
export function createProgram(gl, caps, vsBody, fsBody, defines = {}) {
  const d = defineBlock(defines);
  const vs = compile(gl, gl.VERTEX_SHADER, HEADER_VS + d + vsBody);
  const fs = compile(gl, gl.FRAGMENT_SHADER, HEADER_FS + d + fsBody);
  const program = gl.createProgram();
  gl.attachShader(program, vs); gl.attachShader(program, fs);
  gl.linkProgram(program);
  const out = { program, uniforms: null, error: null };
  out.ready = () => {
    if (out.uniforms || out.error) return !out.error;
    if (caps.parallel && !gl.getProgramParameter(program, caps.parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      out.error = (gl.getShaderInfoLog(vs) || '') + (gl.getShaderInfoLog(fs) || '') + (gl.getProgramInfoLog(program) || '');
      return false;
    }
    out.uniforms = {};
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(program, i);
      out.uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    return true;
  };
  return out;
}

export function createTarget(gl, w, h, { internalFormat, format, type, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE } = {}) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, fbo, width: w, height: h, dispose() { gl.deleteTexture(texture); gl.deleteFramebuffer(fbo); } };
}

export function createPair(gl, w, h, opts) {
  let read = createTarget(gl, w, h, opts), write = createTarget(gl, w, h, opts);
  return {
    get read() { return read; }, get write() { return write; },
    width: w, height: h,
    swap() { const t = read; read = write; write = t; },
    dispose() { read.dispose(); write.dispose(); },
  };
}

// Draw the fullscreen triangle into `target` (null = canvas).
export function blit(gl, target) {
  if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.viewport(0, 0, target.width, target.height); }
  else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function bindTex(gl, unit, texture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  return unit;
}

// Context loss: preventDefault is mandatory or the browser never restores.
// iOS Safari drops contexts on backgrounding and memory pressure; Chrome drops
// the oldest context past ~16 live ones. Test with
// gl.getExtension('WEBGL_lose_context').loseContext() / .restoreContext().
export function watchContext(canvas, { onLost, onRestored }) {
  const lost = (e) => { e.preventDefault(); onLost?.(); };
  const restored = () => onRestored?.(); // rebuild ALL programs, textures, FBOs, VAOs; reseed sim state
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  return () => { canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored); };
}
