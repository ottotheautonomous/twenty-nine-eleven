// An analytic, layered surface field. The folds and their filament contours are
// evaluated in one full-screen pass, so there is no ray march or particle pool.
const VERTEX_SOURCE = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 out_color;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform vec2 u_origin;
uniform float u_time;

const vec3 INK = vec3(0.017, 0.028, 0.025);
const vec3 JADE = vec3(0.43, 0.78, 0.65);
const vec3 ICE = vec3(0.55, 0.82, 0.83);
const vec3 VIOLET = vec3(0.42, 0.39, 0.64);

float pool(vec2 p, vec2 center, vec2 spread) {
  vec2 q = (p - center) / spread;
  return exp(-dot(q, q));
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec2 p = (uv - u_origin) * vec2(aspect, -1.0);
  vec2 pointer = u_pointer * vec2(1.0, -1.0);
  float time = u_time;
  float radius = length(p);

  // The distant illumination occupies the frame, including the space between
  // the tapes. Its direction stays coherent with the nearer material.
  vec3 color = INK;
  color += JADE * pool(p, vec2(-0.75, 0.30), vec2(0.72, 0.56)) * 0.047;
  color += ICE * pool(p, vec2(0.83, -0.42), vec2(0.67, 0.69)) * 0.040;
  color += VIOLET * pool(p, vec2(0.57, 0.69), vec2(0.69, 0.38)) * 0.025;

  // The glyph is an aperture. The lower, broad recess gives the identity and
  // contact control a quiet reading plane without a visible rectangular mask.
  vec2 reading = (uv - vec2(u_origin.x, u_origin.y + 0.32))
    * vec2(aspect / min(0.46, aspect * 0.48), 1.0 / 0.30);
  float recess = 1.0 - 0.96 * exp(-dot(reading, reading) * 1.45);
  float apertureScale = min(1.0, aspect / 0.85);
  float aperture = smoothstep(0.115 * apertureScale, 0.225 * apertureScale, radius);
  vec3 light = normalize(vec3(-0.42, 0.73, 0.62));
  vec3 view = vec3(0.0, 0.0, 1.0);

  // Three translucent depths share a common flow, but have distinct folds.
  // Each angular contour becomes a continuous filament running to the edges.
  for (int i = 0; i < 3; i++) {
    float layer = float(2 - i);
    vec2 q = p + pointer * (0.016 + layer * 0.008);
    q.y *= 1.0 + layer * 0.095;
    q.x += sin(q.y * 1.6 + time * 0.075 + layer) * 0.038 * layer;
    float r = max(length(q), 0.018);
    float angle = atan(q.y, q.x);
    float flow = angle
      + (0.31 + layer * 0.055) * sin(r * 2.0 - angle * 2.0 - time * 0.11 + layer * 0.65)
      + 0.09 * sin(r * 4.3 + angle * 3.0 + time * 0.065 + layer)
      + (0.32 + layer * 0.085) * smoothstep(0.12, 1.4, r);
    float fold = flow * 4.0 + layer * 1.46 + 0.19 * sin(r * 2.1 - time * 0.09);
    float crest = sin(fold) * 0.5 + 0.5;
    float sheet = smoothstep(0.20, 0.39, crest) * (1.0 - smoothstep(0.97, 1.0, crest));

    // Derivatives supply the material normal of the folded surface. The light
    // catches its shoulders and leaves a dark reverse side between the tapes.
    float height = sin(fold) * (0.050 + layer * 0.012)
      + sin(r * 1.7 - angle * 2.0 + layer) * 0.025;
    vec3 normal = normalize(vec3(-dFdx(height) * u_resolution.y,
      -dFdy(height) * u_resolution.y, 1.0));
    float diffuse = max(dot(normal, light), 0.0);
    float specular = pow(max(dot(reflect(-light, normal), view), 0.0), 26.0);
    float grazing = pow(1.0 - abs(normal.z), 2.5);
    float shadow = smoothstep(-0.8, 0.6, cos(fold - 0.45));

    float contourCoordinate = (flow * (36.0 + layer * 8.0) + r * 0.62 + layer * 2.1) / 3.14159265;
    float contour = abs(fract(contourCoordinate + 0.5) - 0.5);
    float antialias = max(fwidth(contourCoordinate), 0.0007);
    float filament = 1.0 - smoothstep(antialias * 0.35, antialias * 1.45 + 0.0007, contour);
    float shoulder = exp(-pow((crest - 0.34) * 26.0, 2.0));
    float farEdge = exp(-pow((crest - 0.92) * 38.0, 2.0));
    float breath = 0.76 + 0.24 * sin(r * 4.0 - time * 0.42 + flow * 3.0 + layer);
    vec3 mineral = mix(JADE, ICE, 0.30 + 0.24 * sin(flow * 2.0 + layer));
    mineral = mix(mineral, VIOLET, layer * 0.10);

    float depth = 1.0 / (1.0 + layer * 0.44);
    float visible = aperture * recess * depth;
    vec3 material = mineral * (0.032 + diffuse * 0.165 + grazing * 0.075) * shadow;
    color = mix(color, color * 0.80 + material, sheet * visible * 0.75);
    color += mineral * filament * sheet * visible
      * (0.030 + diffuse * 0.065 + specular * 0.095) * breath;
    color += mineral * (shoulder * 0.40 + farEdge * 0.095) * visible
      * (0.36 + diffuse * 0.64) * breath;
    color += ICE * specular * sheet * visible * 0.11;
  }

  // A soft falloff keeps the screen feeling deep rather than edge-lit flat.
  float edge = length((uv - 0.5) * vec2(0.78, 0.65));
  color *= 1.0 - smoothstep(0.38, 0.77, edge) * 0.32;
  color = 1.0 - exp(-color * 1.50);
  out_color = vec4(color, 1.0);
}`;

const STATIC_BACKGROUND = 'radial-gradient(ellipse at 10% 25%, #183c344d, transparent 56%), radial-gradient(ellipse at 95% 78%, #224a4c40, transparent 58%), radial-gradient(ellipse at 80% 5%, #39324d33, transparent 52%), #080c0b';
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function createWebGLRenderer(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: true, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false,
    });
  } catch { return null; }
  if (!gl) return null;

  const shaders = [];
  let program;
  let vertexArray;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SOURCE], [gl.FRAGMENT_SHADER, FRAGMENT_SOURCE]]) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader allocation failed');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
    }
    program = gl.createProgram();
    if (!program) throw new Error('Program allocation failed');
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    vertexArray = gl.createVertexArray();
    if (!vertexArray) throw new Error('Vertex array allocation failed');
    const uniforms = Object.fromEntries(['resolution', 'pointer', 'origin', 'time']
      .map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
    shaders.forEach(shader => { gl.detachShader(program, shader); gl.deleteShader(shader); });

    return {
      type: 'webgl2',
      draw(state) {
        if (gl.isContextLost()) return;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.bindVertexArray(vertexArray);
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
        gl.uniform2f(uniforms.pointer, state.pointer[0], state.pointer[1]);
        gl.uniform2f(uniforms.origin, state.origin[0], state.origin[1]);
        gl.uniform1f(uniforms.time, state.time);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy() {
        gl.deleteVertexArray(vertexArray);
        gl.deleteProgram(program);
      },
    };
  } catch {
    shaders.forEach(shader => gl.deleteShader(shader));
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    if (program) gl.deleteProgram(program);
    return { type: 'static', draw() {}, destroy() {} };
  }
}

function createCanvasRenderer(canvas) {
  let context;
  try { context = canvas.getContext('2d', { alpha: false }); } catch { return null; }
  if (!context) return null;

  // Canvas is a complete surface renderer, rather than a wireframe substitute.
  // Six tapered meshes are painted from back to front. A cross-section gradient
  // gives each mesh a satin face, a polished shoulder and a dark reverse side.
  const profiles = [
    { angle: -2.82, phase: 0.3, width: 0.27, tone: 2, depth: 0.78 },
    { angle: -1.79, phase: 1.1, width: 0.26, tone: 0, depth: 0.82 },
    { angle: -0.64, phase: 2.4, width: 0.34, tone: 1, depth: 0.88 },
    { angle: 0.36, phase: 3.8, width: 0.30, tone: 0, depth: 0.91 },
    { angle: 1.47, phase: 4.6, width: 0.31, tone: 1, depth: 0.93 },
    { angle: 2.49, phase: 5.5, width: 0.36, tone: 0, depth: 0.96 },
  ];
  const palettes = [
    ['7, 22, 20', '16, 42, 35', '38, 72, 58', '94, 130, 107', '164, 190, 162', '96, 136, 118', '26, 57, 47', '14, 37, 34', '37, 69, 68', '88, 120, 119', '109, 139, 136', '13, 36, 33'],
    ['7, 21, 25', '14, 37, 44', '34, 66, 74', '91, 124, 137', '169, 193, 193', '86, 126, 131', '22, 49, 55', '12, 30, 37', '34, 56, 70', '77, 104, 122', '121, 145, 155', '12, 31, 37'],
    ['15, 18, 29', '27, 30, 48', '47, 49, 73', '105, 110, 143', '174, 177, 195', '103, 123, 137', '31, 47, 56', '17, 29, 35', '39, 53, 63', '79, 112, 117', '112, 142, 140', '15, 32, 35'],
  ];
  const stops = [0, 0.10, 0.25, 0.34, 0.39, 0.46, 0.56, 0.70, 0.82, 0.91, 0.96, 1];
  const surfacePalettes = palettes.map(palette => palette.map(shade => shade.split(',').map(Number)));
  const contours = [-0.94, -0.74, -0.49, -0.08, 0.20, 0.44, 0.67, 0.94];
  let atmosphere = null;
  let atmosphereContext = null;
  let atmosphereWidth = 0;
  let atmosphereHeight = 0;
  try {
    atmosphere = document.createElement('canvas');
    atmosphereContext = atmosphere.getContext('2d', { alpha: false });
  } catch { /* The primary canvas remains sufficient if caching is unavailable. */ }

  function paintAtmosphere(target, width, height) {
    const base = target.createLinearGradient(0, 0, width, height);
    base.addColorStop(0, '#111e1c');
    base.addColorStop(0.45, '#080e0d');
    base.addColorStop(1, '#111c20');
    target.fillStyle = base;
    target.fillRect(0, 0, width, height);
    for (const [x, y, color] of [[0.08, 0.20, '42, 85, 67'], [0.94, 0.74, '44, 76, 88'], [0.76, -0.10, '65, 52, 83']]) {
      const radius = Math.min(width, height) * 0.80;
      const glow = target.createRadialGradient(width * x, height * y, 0, width * x, height * y, radius);
      glow.addColorStop(0, `rgba(${color}, 0.24)`);
      glow.addColorStop(1, `rgba(${color}, 0)`);
      target.fillStyle = glow;
      target.fillRect(width * x - radius, height * y - radius, radius * 2, radius * 2);
    }
  }

  function surfacePoint(sample, across) {
    const shear = sample.width * 0.12 * Math.sin(across * Math.PI) * sample.fold;
    return {
      x: sample.x + sample.nx * sample.width * across + sample.tx * shear,
      y: sample.y + sample.ny * sample.width * across + sample.ty * shear,
    };
  }

  function trace(points, move = true) {
    if (move) context.moveTo(points[0].x, points[0].y);
    else context.lineTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index++) {
      const point = points[index];
      const next = points[index + 1];
      context.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    const last = points.at(-1);
    context.lineTo(last.x, last.y);
  }

  return {
    type: 'canvas2d',
    draw(state) {
      const width = canvas.width;
      const height = canvas.height;
      const originX = state.origin[0] * width;
      const originY = state.origin[1] * height;
      const scale = Math.hypot(width, height) * 0.94;
      const apertureScale = Math.min(1, width / height / 0.85);
      if (atmosphereContext) {
        if (atmosphereWidth !== width || atmosphereHeight !== height) {
          atmosphereWidth = width; atmosphereHeight = height;
          atmosphere.width = width; atmosphere.height = height;
          paintAtmosphere(atmosphereContext, width, height);
        }
        context.drawImage(atmosphere, 0, 0);
      } else paintAtmosphere(context, width, height);

      context.lineJoin = 'round';
      context.lineCap = 'round';
      for (const profile of profiles) {
        const samples = [];
        for (let step = 0; step <= 40; step++) {
          const t = step / 40;
          const radius = height * 0.065 * apertureScale + t * scale;
          const angle = profile.angle
            + Math.sin(t * 3.4 + profile.phase + state.time * 0.085) * 0.40
            + Math.sin(t * 6.1 - profile.phase + state.time * 0.05) * 0.11 + t * 0.20;
          const twist = 0.62 + 0.38 * (Math.cos(t * 3.8 + profile.phase - state.time * 0.075) * 0.5 + 0.5);
          samples.push({
            t,
            x: originX + Math.cos(angle) * radius + state.pointer[0] * height * 0.024 * t * profile.depth,
            y: originY + Math.sin(angle) * radius * 0.91 + state.pointer[1] * height * 0.024 * t * profile.depth,
            width: height * (0.008 + profile.width * Math.pow(t, 0.80) * twist),
            fold: Math.sin(t * 4.2 + profile.phase - state.time * 0.09),
          });
        }
        for (let index = 0; index < samples.length; index++) {
          const before = samples[Math.max(0, index - 1)];
          const after = samples[Math.min(samples.length - 1, index + 1)];
          const dx = after.x - before.x;
          const dy = after.y - before.y;
          const distance = Math.hypot(dx, dy) || 1;
          Object.assign(samples[index], { tx: dx / distance, ty: dy / distance, nx: -dy / distance, ny: dx / distance });
        }

        // One continuous material fill follows the smooth silhouette. Its
        // representative normal gives the satin a broad, uninterrupted light.
        const left = samples.map(sample => surfacePoint(sample, -1));
        const right = samples.map(sample => surfacePoint(sample, 1));
        const midpoint = samples[20];
        const material = context.createLinearGradient(midpoint.x - midpoint.nx * midpoint.width,
          midpoint.y - midpoint.ny * midpoint.width, midpoint.x + midpoint.nx * midpoint.width,
          midpoint.y + midpoint.ny * midpoint.width);
        const palette = palettes[profile.tone];
        const illumination = (0.78 + 0.14 * Math.sin(state.time * 0.07 + profile.phase)) * profile.depth;
        stops.forEach((stop, shade) => {
          const [red, green, blue] = surfacePalettes[profile.tone][shade];
          const r = Math.round(9 + (red - 9) * illumination);
          const g = Math.round(22 + (green - 22) * illumination);
          const b = Math.round(20 + (blue - 20) * illumination);
          material.addColorStop(stop, `rgb(${r}, ${g}, ${b})`);
        });
        context.beginPath();
        trace(left); trace([...right].reverse(), false); context.closePath();
        context.fillStyle = material;
        context.fill();

        const end = samples.at(-1);
        const detail = context.createLinearGradient(originX, originY, end.x, end.y);
        detail.addColorStop(0, 'rgba(170, 199, 188, 0)');
        detail.addColorStop(0.13, 'rgba(170, 199, 188, 0.06)');
        detail.addColorStop(0.40, 'rgba(175, 207, 194, 0.17)');
        detail.addColorStop(1, 'rgba(145, 183, 190, 0.08)');
        context.strokeStyle = detail;
        context.lineWidth = Math.max(0.65, height / 1500);
        for (const across of contours) {
          context.beginPath();
          trace(samples.map(sample => surfacePoint(sample, across)));
          context.stroke();
        }

        // Continuous narrow shoulders make the bevel legible at any resolution.
        const shoulder = context.createLinearGradient(originX, originY, end.x, end.y);
        shoulder.addColorStop(0, 'rgba(183, 213, 199, 0)');
        shoulder.addColorStop(0.10, 'rgba(183, 213, 199, 0.04)');
        shoulder.addColorStop(0.38, `rgba(${palette[4]}, 0.56)`);
        shoulder.addColorStop(1, `rgba(${palette[4]}, 0.28)`);
        context.strokeStyle = shoulder;
        for (const across of [-0.22, 0.93]) {
          context.beginPath();
          trace(samples.map(sample => surfacePoint(sample, across)));
          context.lineWidth = Math.max(1.0, height / 1100);
          context.stroke();
        }
      }

      // The center remains a continuous recess, with no panel-shaped boundary.
      const apertureRadius = height * 0.225 * apertureScale;
      const aperture = context.createRadialGradient(originX, originY, 0, originX, originY, apertureRadius);
      aperture.addColorStop(0, 'rgba(8, 12, 11, 1)');
      aperture.addColorStop(0.53, 'rgba(8, 12, 11, 0.99)');
      aperture.addColorStop(1, 'rgba(8, 12, 11, 0)');
      context.fillStyle = aperture;
      context.fillRect(originX - apertureRadius, originY - apertureRadius, apertureRadius * 2, apertureRadius * 2);

      const readingWidth = Math.min(height * 0.46, width * 0.48);
      const readingHeight = height * 0.35;
      context.save();
      context.translate(originX, originY + height * 0.32);
      context.scale(readingWidth, readingHeight);
      const reading = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      reading.addColorStop(0, 'rgba(8, 12, 11, 0.99)');
      reading.addColorStop(0.44, 'rgba(8, 12, 11, 0.94)');
      reading.addColorStop(0.72, 'rgba(8, 12, 11, 0.73)');
      reading.addColorStop(1, 'rgba(8, 12, 11, 0)');
      context.fillStyle = reading;
      context.fillRect(-1, -1, 2, 2);
      context.restore();
    },
    destroy() {
      if (atmosphere) { atmosphere.width = 1; atmosphere.height = 1; }
      atmosphere = null;
      atmosphereContext = null;
    },
  };
}

/**
 * A viewport field with externally controlled activity. Coordinates supplied
 * to setOrigin use the DOM convention (0, 0 at the upper left).
 */
export function createBackground(canvas) {
  const noop = () => {};
  const inert = { setActive: noop, setPointer: noop, setOrigin: noop, setReducedMotion: noop, resize: noop, destroy: noop };
  if (!canvas?.getContext || typeof window === 'undefined') return inert;

  const originalBackground = canvas.style.background;
  const originalRenderer = canvas.getAttribute('data-renderer');
  const originalActive = canvas.getAttribute('data-active');
  canvas.style.background = STATIC_BACKGROUND;
  const state = { time: 8.5, pointer: [0, 0], origin: [0.5, 0.34] };
  let renderer = createWebGLRenderer(canvas) || createCanvasRenderer(canvas);
  let desiredActive = false;
  let reducedMotion = false;
  let contextLost = false;
  let destroyed = false;
  let frame = 0;
  let lastDraw = 0;
  let lastTime = 0;
  let mobile = false;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  canvas.dataset.renderer = renderer?.type || 'static';
  canvas.dataset.active = 'false';

  function draw() {
    if (destroyed || contextLost) return;
    try { renderer?.draw(state); } catch {
      // A decorative surface must never interrupt the contact form or identity.
      renderer?.destroy();
      renderer = null;
      canvas.dataset.renderer = 'static';
      stop();
    }
  }

  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    lastDraw = 0;
    lastTime = 0;
    canvas.dataset.active = 'false';
  }

  function canAnimate() {
    return desiredActive && !reducedMotion && !document.hidden && !contextLost
      && !destroyed && renderer && renderer.type !== 'static';
  }

  function tick(timestamp) {
    frame = 0;
    if (!canAnimate()) { lastDraw = 0; lastTime = 0; canvas.dataset.active = 'false'; return; }
    const interval = 1000 / (mobile || renderer.type === 'canvas2d' ? 30 : 45);
    if (!lastDraw) { lastDraw = timestamp; lastTime = timestamp; }
    const elapsed = timestamp - lastDraw;
    if (elapsed >= interval) {
      // Resuming never incorporates the time spent paused or in another tab.
      state.time += Math.min((timestamp - lastTime) / 1000, 0.08);
      lastTime = timestamp;
      lastDraw = timestamp - (elapsed % interval);
      draw();
    }
    if (canAnimate()) frame = window.requestAnimationFrame(tick);
  }

  function syncActivity() {
    if (canAnimate()) {
      canvas.dataset.active = 'true';
      if (!frame) frame = window.requestAnimationFrame(tick);
    } else stop();
  }

  function resize() {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, finite(bounds.width, 0) || window.innerWidth || 1);
    const nextHeight = Math.max(1, finite(bounds.height, 0) || window.innerHeight || 1);
    mobile = nextWidth <= 700 || window.matchMedia?.('(pointer: coarse)').matches === true;
    // A finite pixel budget also protects ultra-wide and 4K displays.
    const maximum = mobile ? 1 : 1.5;
    const budgetRatio = Math.sqrt(2_800_000 / (nextWidth * nextHeight));
    const nextRatio = Math.min(maximum, Math.max(0.5, finite(window.devicePixelRatio, 1)), budgetRatio);
    if (width !== nextWidth || height !== nextHeight || pixelRatio !== nextRatio) {
      width = nextWidth; height = nextHeight; pixelRatio = nextRatio;
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));
    }
    draw();
  }

  function onContextLost(event) {
    event.preventDefault();
    contextLost = true;
    canvas.dataset.renderer = 'static';
    stop();
  }

  function onContextRestored() {
    if (destroyed) return;
    contextLost = false;
    renderer?.destroy();
    renderer = createWebGLRenderer(canvas);
    canvas.dataset.renderer = renderer?.type || 'static';
    resize();
    syncActivity();
  }

  function onVisibilityChange() {
    if (!document.hidden) draw();
    syncActivity();
  }

  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', onVisibilityChange);
  resize();

  return {
    setActive(active) {
      if (destroyed) return;
      desiredActive = Boolean(active);
      syncActivity();
    },
    setPointer(x, y) {
      if (destroyed) return;
      state.pointer = reducedMotion ? [0, 0] : [clamp(finite(x, 0), -1, 1), clamp(finite(y, 0), -1, 1)];
      if (!canAnimate()) draw();
    },
    setOrigin(x, y) {
      if (destroyed) return;
      state.origin = [clamp(finite(x, 0.5), 0, 1), clamp(finite(y, 0.34), 0, 1)];
      draw();
    },
    setReducedMotion(reduced) {
      if (destroyed) return;
      reducedMotion = Boolean(reduced);
      if (reducedMotion) state.pointer = [0, 0];
      syncActivity();
      draw();
    },
    resize,
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      renderer?.destroy();
      renderer = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.style.background = originalBackground;
      if (originalRenderer === null) canvas.removeAttribute('data-renderer');
      else canvas.setAttribute('data-renderer', originalRenderer);
      if (originalActive === null) canvas.removeAttribute('data-active');
      else canvas.setAttribute('data-active', originalActive);
    },
  };
}
