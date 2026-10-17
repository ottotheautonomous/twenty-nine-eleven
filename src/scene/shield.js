// The perimeter shield (?shield=1): a completely separate 3D spherical elastic grid object enveloping the cage at R = 1.045.
// Built as an equiangular Cube-Sphere quad mesh (1,538 welded vertices, 3,072 quad grid lines, 3,072 facet triangles) with
// Hookean neighbor-spring + anchor-spring physics and propagating spherical shockwaves, so pointer impacts and skims warp,
// compress, and ripple the spherical grid like a Geometry Wars stage grid wrapped around a 3D sphere.
import { createProgram } from './gl.js';
import { projectPx } from './camera.js';

const R_SHIELD = 1.045;
const N_FACE = 16;   // 16x16 quads per cube face -> 1,536 quad cells, 1,538 welded vertices, 3,072 grid lines

function buildCubeSphere(N = N_FACE, radius = R_SHIELD) {
  const keyMap = new Map();
  const pos0 = [];
  const nrm0 = [];
  function getVert(cx, cy, cz) {
    const k = `${Math.round(cx * 1e4)},${Math.round(cy * 1e4)},${Math.round(cz * 1e4)}`;
    let idx = keyMap.get(k);
    if (idx !== undefined) return idx;
    const ax = Math.tan((Math.PI / 4) * cx), ay = Math.tan((Math.PI / 4) * cy), az = Math.tan((Math.PI / 4) * cz);
    const inv = 1 / (Math.hypot(ax, ay, az) || 1);
    const nx = ax * inv, ny = ay * inv, nz = az * inv;
    idx = pos0.length / 3;
    keyMap.set(k, idx);
    nrm0.push(nx, ny, nz);
    pos0.push(nx * radius, ny * radius, nz * radius);
    return idx;
  }

  const faces = [
    (u, v) => [1, v, -u],  (u, v) => [-1, v, u],
    (u, v) => [u, 1, v],   (u, v) => [u, -1, -v],
    (u, v) => [u, v, 1],   (u, v) => [-u, v, -1],
  ];
  const edgeSet = new Set();
  const lines = [];
  const tris = [];
  function addEdge(a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b), ek = lo * 65536 + hi;
    if (edgeSet.has(ek)) return;
    edgeSet.add(ek);
    lines.push(lo, hi);
  }

  for (const face of faces) {
    const grid = Array.from({ length: N + 1 }, () => new Uint16Array(N + 1));
    for (let j = 0; j <= N; j++) {
      const v = (2 * j) / N - 1;
      for (let i = 0; i <= N; i++) {
        const u = (2 * i) / N - 1;
        const [cx, cy, cz] = face(u, v);
        grid[j][i] = getVert(cx, cy, cz);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const v00 = grid[j][i], v10 = grid[j][i + 1], v11 = grid[j + 1][i + 1], v01 = grid[j + 1][i];
        addEdge(v00, v10); addEdge(v10, v11); addEdge(v11, v01); addEdge(v01, v00);
        tris.push(v00, v10, v11, v00, v11, v01);
      }
    }
  }

  const V = pos0.length / 3;
  const nbr = new Int32Array(V * 4).fill(-1);
  const nbrCount = new Uint8Array(V);
  for (let e = 0; e < lines.length; e += 2) {
    const a = lines[e], b = lines[e + 1];
    if (nbrCount[a] < 4) nbr[a * 4 + nbrCount[a]++] = b;
    if (nbrCount[b] < 4) nbr[b * 4 + nbrCount[b]++] = a;
  }

  return {
    V,
    pos0: new Float32Array(pos0),
    nrm0: new Float32Array(nrm0),
    lines: new Uint16Array(lines),
    tris: new Uint16Array(tris),
    nbr,
    nbrCount,
  };
}

export function createShieldModel() {
  const mesh = buildCubeSphere();
  const { V, pos0, nrm0, nbr, nbrCount } = mesh;
  const pos = new Float32Array(pos0);
  const vel = new Float32Array(V * 3);
  const force = new Float32Array(V * 3);
  const vboData = new Float32Array(V * 6);   // x, y, z, strain, waveGlow, heat
  for (let i = 0; i < V; i++) {
    vboData[i * 6] = pos0[i * 3];
    vboData[i * 6 + 1] = pos0[i * 3 + 1];
    vboData[i * 6 + 2] = pos0[i * 3 + 2];
  }

  const waves = [];   // { nx, ny, nz, t, dur, amp, speed, exit }
  let on = false, wasIn = false, lastInAt = -10, lastOutAt = -10;
  let ptrWorld = [0, 0, 1], ptrActive = 0, lastRho = 9, lastTapT = 1;

  function spawnWave(nx, ny, nz, amp, exit = false) {
    if (waves.length >= 6) waves.shift();
    waves.push({
      nx, ny, nz,
      t: 0,
      dur: exit ? 0.95 : 1.35,
      amp,
      speed: exit ? 2.4 : 2.65,
      exit,
    });
    // Immediate Geometry Wars crater blast around the 3D impact point:
    // radial dent inward + strong tangential push away from the impact epicenter.
    const blastR = exit ? 0.45 : 0.62;
    const radialKick = (exit ? 0.045 : -0.085) * amp;
    const tangKick = (exit ? -0.055 : 0.115) * amp;
    for (let i = 0; i < V; i++) {
      const ix = nrm0[i * 3], iy = nrm0[i * 3 + 1], iz = nrm0[i * 3 + 2];
      const dot = Math.max(-1, Math.min(1, ix * nx + iy * ny + iz * nz));
      const theta = Math.acos(dot);
      if (theta >= blastR) continue;
      const u = theta / blastR;
      // Tangent vector pointing away from impact point along sphere surface:
      let tx = ix - nx * dot, ty = iy - ny * dot, tz = iz - nz * dot;
      const tl = Math.hypot(tx, ty, tz);
      if (tl > 1e-5) { tx /= tl; ty /= tl; tz /= tl; }
      const radEnv = Math.cos(u * Math.PI * 0.5) ** 2;
      const tanEnv = Math.sin(u * Math.PI) * (1 - 0.35 * u);
      vel[i * 3]     += ix * radialKick * radEnv + tx * tangKick * tanEnv;
      vel[i * 3 + 1] += iy * radialKick * radEnv + ty * tangKick * tanEnv;
      vel[i * 3 + 2] += iz * radialKick * radEnv + tz * tangKick * tanEnv;
    }
  }

  function worldPointOnSphere(cam, dx, dy) {
    const r2 = dx * dx + dy * dy;
    const cl = r2 > 1 ? 1 / Math.sqrt(r2) : 1;
    const sx = dx * cl, sy = dy * cl, sz = Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy));
    const R = cam.right, U = cam.up, F = cam.forward;
    const wx = R[0] * sx + U[0] * sy - F[0] * sz;
    const wy = R[1] * sx + U[1] * sy - F[1] * sz;
    const wz = R[2] * sx + U[2] * sy - F[2] * sz;
    const l = Math.hypot(wx, wy, wz) || 1;
    return [wx / l, wy / l, wz / l];
  }

  function reset() {
    pos.set(pos0);
    vel.fill(0);
    waves.length = 0;
    wasIn = false; ptrActive = 0; lastRho = 9;
    for (let i = 0; i < V; i++) {
      vboData[i * 6] = pos0[i * 3];
      vboData[i * 6 + 1] = pos0[i * 3 + 1];
      vboData[i * 6 + 2] = pos0[i * 3 + 2];
      vboData[i * 6 + 3] = 0;
      vboData[i * 6 + 4] = 0;
      vboData[i * 6 + 5] = 0;
    }
  }

  function step(dt, model, cam, view, u) {
    if (!on) return;
    const s = model.state;
    const sh = cam.shellPx;
    const px = (model.pointerRaw[0] * 0.5 + 0.5) * view.width;
    const py = (model.pointerRaw[1] * 0.5 + 0.5) * view.height;
    const dx = (px - sh.x) / Math.max(1, sh.r), dy = (py - sh.y) / Math.max(1, sh.r);
    const rho = Math.hypot(dx, dy);
    const canInteract = s.simulate && s.inScene && !s.modal && !s.still && u.u_motion.value > 0;
    const inside = canInteract && rho <= 1.05;

    if (canInteract) {
      ptrWorld = worldPointOnSphere(cam, dx, dy);
      const targetAct = rho <= 1.18 ? Math.max(0, 1 - Math.max(0, rho - 0.95) / 0.25) : 0;
      ptrActive += (targetAct - ptrActive) * Math.min(1, dt * 14);
    } else {
      ptrActive *= Math.max(0, 1 - dt * 8);
    }

    // 1. Perimeter entry & exit impact detection
    if (inside && !wasIn && lastRho > 1.01 && s.time - lastInAt > 0.32) {
      lastInAt = s.time;
      const amp = Math.min(1.35, 0.75 + Math.min(1, s.rawSpeed / 1.6) * 0.60);
      spawnWave(ptrWorld[0], ptrWorld[1], ptrWorld[2], amp, false);
    } else if (!inside && wasIn && canInteract && rho > 1.06 && s.time - lastOutAt > 0.35) {
      lastOutAt = s.time;
      const amp = Math.min(0.85, 0.45 + Math.min(1, s.rawSpeed / 1.8) * 0.40);
      spawnWave(ptrWorld[0], ptrWorld[1], ptrWorld[2], amp, true);
    }
    wasIn = inside;
    lastRho = inside ? Math.min(rho, 1.0) : rho;

    // Also trigger a wave on touch tap (u_tapT jumping near 0)
    const tapT = u.u_tapT.value;
    if (tapT < 0.15 && lastTapT >= 0.15 && canInteract) {
      spawnWave(u.u_tapX.value || ptrWorld[0], u.u_tapY.value || ptrWorld[1], u.u_tapZ.value || ptrWorld[2], 1.15, false);
    }
    lastTapT = tapT;

    // 2. Advance active spherical shockwaves
    for (let w = waves.length - 1; w >= 0; w--) {
      waves[w].t += dt;
      if (waves[w].t >= waves[w].dur) waves.splice(w, 1);
    }

    // 3. Substepped Hookean spring-mass lattice + wave ring forces + continuous cursor wake
    const substeps = 2;
    const kNbr = 0.20;      // Geometry Wars neighbor spring coupling
    const kTan = 0.052;     // tangential restoring spring to rest lattice node
    const kRad = 0.095;     // radial restoring spring to sphere surface
    const damp = Math.pow(0.84, dt * 60 / substeps);
    const skimAmp = inside && s.rawSpeed > 0.04 ? Math.min(0.032, s.rawSpeed * 0.016) : 0;
    const pvX = s.probeVel[0], pvY = s.probeVel[1], pvZ = s.probeVel[2];

    for (let stepIdx = 0; stepIdx < substeps; stepIdx++) {
      force.fill(0);
      // Neighbor spring coupling
      for (let i = 0; i < V; i++) {
        const i3 = i * 3, cnt = nbrCount[i];
        const pxI = pos[i3], pyI = pos[i3 + 1], pzI = pos[i3 + 2];
        const p0xI = pos0[i3], p0yI = pos0[i3 + 1], p0zI = pos0[i3 + 2];
        let fx = 0, fy = 0, fz = 0;
        for (let k = 0; k < cnt; k++) {
          const j3 = nbr[i * 4 + k] * 3;
          const ddx = (pos[j3] - pxI) - (pos0[j3] - p0xI);
          const ddy = (pos[j3 + 1] - pyI) - (pos0[j3 + 1] - p0yI);
          const ddz = (pos[j3 + 2] - pzI) - (pos0[j3 + 2] - p0zI);
          fx += ddx * kNbr; fy += ddy * kNbr; fz += ddz * kNbr;
        }
        // Restoring spring decomposed into radial + tangential
        const nx = nrm0[i3], ny = nrm0[i3 + 1], nz = nrm0[i3 + 2];
        const ox = pxI - p0xI, oy = pyI - p0yI, oz = pzI - p0zI;
        const oRad = ox * nx + oy * ny + oz * nz;
        const tx = ox - nx * oRad, ty = oy - ny * oRad, tz = oz - nz * oRad;
        fx -= nx * oRad * kRad + tx * kTan;
        fy -= ny * oRad * kRad + ty * kTan;
        fz -= nz * oRad * kRad + tz * kTan;
        force[i3] = fx; force[i3 + 1] = fy; force[i3 + 2] = fz;
      }

      // Travelling wave ring impulses & continuous pointer wake (applied on first substep)
      if (stepIdx === 0 && (waves.length > 0 || skimAmp > 0)) {
        for (let i = 0; i < V; i++) {
          const i3 = i * 3;
          const nx = nrm0[i3], ny = nrm0[i3 + 1], nz = nrm0[i3 + 2];
          for (let w = 0; w < waves.length; w++) {
            const wv = waves[w];
            const front = wv.t * wv.speed;
            const env = Math.pow(Math.max(0, 1 - wv.t / wv.dur), 1.35) * wv.amp;
            const dot = Math.max(-1, Math.min(1, nx * wv.nx + ny * wv.ny + nz * wv.nz));
            const theta = Math.acos(dot);
            const diff = theta - front;
            if (Math.abs(diff) < 0.28) {
              let tx = nx - wv.nx * dot, ty = ny - wv.ny * dot, tz = nz - wv.nz * dot;
              const tl = Math.hypot(tx, ty, tz);
              if (tl > 1e-5) { tx /= tl; ty /= tl; tz /= tl; }
              const phase = (diff / 0.28) * Math.PI;
              const g = Math.cos(phase * 0.5) ** 2;
              const tanPush = -Math.sin(phase) * g * 0.018 * env;
              const radPush = Math.cos(phase) * g * 0.011 * env;
              force[i3]     += tx * tanPush + nx * radPush;
              force[i3 + 1] += ty * tanPush + ny * radPush;
              force[i3 + 2] += tz * tanPush + nz * radPush;
            }
          }
          if (skimAmp > 0) {
            const dotP = nx * ptrWorld[0] + ny * ptrWorld[1] + nz * ptrWorld[2];
            if (dotP > 0.88) {
              const w = ((dotP - 0.88) / 0.12) ** 2;
              // Project pointer velocity onto tangent plane + gentle radial press
              const vn = pvX * nx + pvY * ny + pvZ * nz;
              const vtx = pvX - nx * vn, vty = pvY - ny * vn, vtz = pvZ - nz * vn;
              force[i3]     += vtx * 0.18 * w - nx * skimAmp * 0.45 * w;
              force[i3 + 1] += vty * 0.18 * w - ny * skimAmp * 0.45 * w;
              force[i3 + 2] += vtz * 0.18 * w - nz * skimAmp * 0.45 * w;
            }
          }
        }
      }

      for (let i = 0; i < V * 3; i++) {
        vel[i] = (vel[i] + force[i]) * damp;
        pos[i] += vel[i];
      }
    }

    // 4. Pack VBO data: (x, y, z, strain, waveGlow, heat)
    for (let i = 0; i < V; i++) {
      const i3 = i * 3, i6 = i * 6;
      const pxI = pos[i3], pyI = pos[i3 + 1], pzI = pos[i3 + 2];
      const ox = pxI - pos0[i3], oy = pyI - pos0[i3 + 1], oz = pzI - pos0[i3 + 2];
      const disp = Math.hypot(ox, oy, oz);
      const spd = Math.hypot(vel[i3], vel[i3 + 1], vel[i3 + 2]);
      const strain = Math.min(1.5, disp * 13.5 + spd * 28.0);

      const nx = nrm0[i3], ny = nrm0[i3 + 1], nz = nrm0[i3 + 2];
      let wGlow = 0, heat = 0;
      for (let w = 0; w < waves.length; w++) {
        const wv = waves[w];
        const front = wv.t * wv.speed;
        const env = Math.pow(Math.max(0, 1 - wv.t / wv.dur), 1.25) * wv.amp;
        const dot = Math.max(-1, Math.min(1, nx * wv.nx + ny * wv.ny + nz * wv.nz));
        const theta = Math.acos(dot);
        const crest = Math.exp(-(((theta - front) / 0.22) ** 2)) * env;
        const wake = theta <= front ? Math.exp(-(((front - theta) / 0.65) ** 2)) * 0.35 * env : 0;
        wGlow = Math.max(wGlow, crest + wake);
        if (wv.t < 0.38 && theta < 0.55) {
          heat = Math.max(heat, (1 - wv.t / 0.38) * Math.exp(-((theta / 0.30) ** 2)) * wv.amp);
        }
      }
      if (ptrActive > 0.01) {
        const dotP = nx * ptrWorld[0] + ny * ptrWorld[1] + nz * ptrWorld[2];
        if (dotP > 0.82) {
          const aura = ((dotP - 0.82) / 0.18) ** 2 * ptrActive * 0.45;
          wGlow = Math.max(wGlow, aura);
        }
      }

      vboData[i6]     = pxI;
      vboData[i6 + 1] = pyI;
      vboData[i6 + 2] = pzI;
      vboData[i6 + 3] = strain;
      vboData[i6 + 4] = wGlow;
      vboData[i6 + 5] = heat;
    }
  }

  return {
    mesh,
    vboData,
    waves,
    get on() { return on; },
    set on(v) { on = Boolean(v); if (!on) reset(); },
    step,
    reset,
    triggerImpact(nx, ny, nz, amp = 1.0) { spawnWave(nx, ny, nz, amp, false); },
  };
}

const SHIELD_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aEnergy;   // x: strain, y: waveGlow, z: impactHeat
uniform mat4 uViewProj, uView;
uniform float uBuild, uPointScale;
out float vStrain, vGlow, vHeat, vViewZ, vFresnel;
void main() {
  vec3 wPos = aPos * (0.2 + 0.8 * uBuild);
  vec3 vN = normalize((uView * vec4(normalize(aPos), 0.0)).xyz);
  vViewZ = vN.z;
  vFresnel = pow(clamp(1.0 - abs(vN.z), 0.0, 1.0), 1.35);
  vStrain = aEnergy.x;
  vGlow = aEnergy.y;
  vHeat = aEnergy.z;
  gl_Position = uViewProj * vec4(wPos, 1.0);
  gl_PointSize = clamp((2.0 + 2.4 * min(1.0, vStrain + vGlow)) * uPointScale, 1.5, 9.0);
}`;

const SHIELD_FS = `
in float vStrain, vGlow, vHeat, vViewZ, vFresnel;
uniform float uMode;       // 0: membrane triangles, 1: warped grid lines, 2: intersection nodes
uniform float uBaseAlpha;
uniform vec3 uColRim, uColCyan, uColHot;
out vec4 o;
void main() {
  float front = mix(0.28, 1.0, smoothstep(-0.35, 0.25, vViewZ));
  float act = max(vStrain * 0.85, vGlow);
  if (uMode < 0.5) {
    // Pass 0: Translucent spherical facet membrane shimmer between warped grid struts
    float mem = (vGlow * 0.11 + vStrain * 0.06) * (0.35 + 0.65 * vFresnel) * front;
    if (mem < 0.002) discard;
    vec3 col = mix(uColCyan, uColHot, clamp(vHeat * 0.85, 0.0, 1.0));
    o = vec4(col * mem, 0.0);
    return;
  }
  if (uMode > 1.5) {
    // Pass 2: Grid vertex intersection sparks
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    float spark = (uBaseAlpha * 0.6 + act * 0.95) * (1.0 - smoothstep(0.3, 1.0, r2)) * front;
    if (spark < 0.003) discard;
    vec3 col = mix(mix(uColRim, uColCyan, clamp(vStrain, 0.0, 1.0)), uColHot, clamp(vHeat, 0.0, 1.0));
    o = vec4(col * spark, 0.0);
    return;
  }
  // Pass 1: Warped Geometry Wars spherical quad grid lines
  float lineA = (uBaseAlpha * (0.45 + 0.55 * vFresnel) + act * 1.15) * front;
  if (lineA < 0.002) discard;
  vec3 col = mix(uColRim, uColCyan, clamp(vGlow + 0.5 * vStrain, 0.0, 1.0));
  col = mix(col, uColHot, clamp(vHeat + max(0.0, vStrain - 0.75) * 0.5, 0.0, 1.0));
  o = vec4(col * lineA, 0.0);
}`;

export function createShieldRenderer(gl, caps, shieldModel, colors) {
  const program = createProgram(gl, caps, SHIELD_VS, SHIELD_FS);
  const { mesh, vboData } = shieldModel;
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  const eboLines = gl.createBuffer();
  const eboTris = gl.createBuffer();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vboData.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
  gl.bindVertexArray(null);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboTris);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.tris, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

  const colCyan = [0.22, 0.58, 0.98];   // linear HDR electric ice-cyan

  return {
    program,
    draw(cam, u, backing = 1) {
      if (!shieldModel.on || !program.ready() || u.u_build.value < 0.05) return;
      const p = program.uniforms;
      gl.useProgram(program.program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, vboData);

      gl.uniformMatrix4fv(p.uViewProj, false, cam.viewProj);
      gl.uniformMatrix4fv(p.uView, false, cam.view);
      gl.uniform1f(p.uBuild, u.u_build.value);
      gl.uniform1f(p.uPointScale, backing);
      gl.uniform1f(p.uBaseAlpha, 0.032 + 0.028 * u.u_engage.value);
      gl.uniform3fv(p.uColRim, colors.colLight);
      gl.uniform3fv(p.uColCyan, colCyan);
      gl.uniform3fv(p.uColHot, colors.hot);

      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);

      // 1. Translucent spherical facet membrane shimmer (when any wave or strain is active)
      gl.uniform1f(p.uMode, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboTris);
      gl.drawElements(gl.TRIANGLES, mesh.tris.length, gl.UNSIGNED_SHORT, 0);

      // 2. Warped Geometry Wars spherical quad grid lines
      gl.uniform1f(p.uMode, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eboLines);
      gl.drawElements(gl.LINES, mesh.lines.length, gl.UNSIGNED_SHORT, 0);

      // 3. Grid intersection vertex sparks
      gl.uniform1f(p.uMode, 2);
      gl.drawArrays(gl.POINTS, 0, mesh.V);

      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    },
    dispose() {
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(eboLines);
      gl.deleteBuffer(eboTris);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program.program);
    },
  };
}

export function drawShield2D(ctx, shieldModel, cam, u, W, H) {
  if (!shieldModel?.on || u.u_build.value < 0.05) return;
  const { mesh, vboData } = shieldModel;
  const { V, lines } = mesh;
  const VP = cam.viewProj, F = cam.forward;
  const px = new Float32Array(V * 2);
  const vz = new Float32Array(V);
  const p3 = [0, 0, 0], out = [0, 0, 0];
  const build = 0.2 + 0.8 * u.u_build.value;
  for (let i = 0; i < V; i++) {
    const i6 = i * 6;
    p3[0] = vboData[i6] * build; p3[1] = vboData[i6 + 1] * build; p3[2] = vboData[i6 + 2] * build;
    projectPx(VP, p3, W, H, out);
    px[i * 2] = out[0];
    px[i * 2 + 1] = H - out[1];
    vz[i] = -(p3[0] * F[0] + p3[1] * F[1] + p3[2] * F[2]);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = Math.max(1, (cam.scaleY || 1) * 0.9);
  const baseA = 0.04 + 0.03 * u.u_engage.value;
  for (let e = 0; e < lines.length; e += 2) {
    const a = lines[e], b = lines[e + 1];
    const a6 = a * 6, b6 = b * 6;
    const act = Math.max(vboData[a6 + 3], vboData[b6 + 3], vboData[a6 + 4], vboData[b6 + 4]);
    const zAvg = 0.5 * (vz[a] + vz[b]);
    const front = zAvg > 0 ? 1.0 : 0.3;
    const alpha = Math.min(0.85, (baseA + act * 0.65) * front);
    if (alpha < 0.025) continue;
    const heat = Math.max(vboData[a6 + 5], vboData[b6 + 5]);
    ctx.strokeStyle = heat > 0.25 ? `rgba(255,216,166,${alpha.toFixed(3)})` : `rgba(145,205,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(px[a * 2], px[a * 2 + 1]);
    ctx.lineTo(px[b * 2], px[b * 2 + 1]);
    ctx.stroke();
  }
  ctx.restore();
}
