// SPDX-License-Identifier: 0BSD
// Sparse cursor "plexus" for raw WebGL2: CPU selection of the K nodes nearest
// the pointer ray (K = 5 of <= 64), at most 2 links per node (nearest-first,
// no duplicates), per-link progress (grow 0.1 s, retract 0.06 s, linear), drawn
// as GL_LINES with additive blending. Kit original, Twenty Nine Eleven (2026),
// written from igloo.inc's documented behaviour (research-igloo-techniques.md 3.5).
//
// Split in two: createPlexusLogic() is pure JS (unit-testable in Node, reusable
// by the Canvas2D fallback); createPlexusRenderer() owns the GL side.
// Zero allocations per frame after construction.

export function createPlexusLogic({
  maxNodes = 64, k = 5, maxLinksPerNode = 2,
  growSec = 0.1, retractSec = 0.06, minMove = 0.05, hysteresis = 0.9,
} = {}) {
  const sel = new Int32Array(k).fill(-1);       // selected node indices
  const selD = new Float32Array(k);
  const cand = new Int32Array(k), candD = new Float32Array(k);
  const pairs = new Float32Array((k * (k - 1)) / 2 * 3); // [dist, a, b] triples
  const degree = new Uint8Array(maxNodes);
  // Link table keyed by a*maxNodes+b (a<b). progress/target per slot.
  const maxLinks = k * maxLinksPerNode;           // upper bound of simultaneous targets
  const slots = maxLinks * 3;                     // room for retracting links
  const linkKey = new Int32Array(slots).fill(-1);
  const linkP = new Float32Array(slots), linkT = new Uint8Array(slots);
  const last = { ox: NaN, oy: NaN, oz: NaN, dx: 0, dy: 0, dz: 0 };

  // Squared distance from point p to the ray o + t d (t >= 0, d normalised).
  function rayDist2(px, py, pz, o, d) {
    const vx = px - o[0], vy = py - o[1], vz = pz - o[2];
    const t = Math.max(0, vx * d[0] + vy * d[1] + vz * d[2]);
    const ex = vx - d[0] * t, ey = vy - d[1] * t, ez = vz - d[2] * t;
    return ex * ex + ey * ey + ez * ez;
  }

  // nodes: Float32Array xyz * n (world). o, d: ray origin/direction (world, d unit).
  // Returns true when the selection changed.
  function select(nodes, n, o, d) {
    // Only re-select when the ray moved enough (world units at the node depth ~ origin move + dir move).
    const moved = Math.hypot(o[0] - last.ox, o[1] - last.oy, o[2] - last.oz) + Math.hypot(d[0] - last.dx, d[1] - last.dy, d[2] - last.dz) * 3;
    if (!(moved > minMove) && sel[0] !== -1) return false;
    last.ox = o[0]; last.oy = o[1]; last.oz = o[2]; last.dx = d[0]; last.dy = d[1]; last.dz = d[2];
    candD.fill(Infinity); cand.fill(-1);
    for (let i = 0; i < n; i++) {                 // partial insertion sort, O(n k)
      const dd = rayDist2(nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2], o, d);
      if (dd >= candD[k - 1]) continue;
      let j = k - 1;
      while (j > 0 && candD[j - 1] > dd) { candD[j] = candD[j - 1]; cand[j] = cand[j - 1]; j--; }
      candD[j] = dd; cand[j] = i;
    }
    // Hysteresis: keep the old set unless the new set is clearly closer overall
    // (prevents links flickering when two nodes are equidistant).
    let oldSum = 0, newSum = 0, valid = sel[0] !== -1;
    for (let j = 0; j < k; j++) {
      newSum += candD[j];
      if (valid) { const i = sel[j]; oldSum += i < 0 || i >= n ? Infinity : rayDist2(nodes[i * 3], nodes[i * 3 + 1], nodes[i * 3 + 2], o, d); }
    }
    if (valid && newSum >= oldSum * hysteresis) return false;
    sel.set(cand); selD.set(candD);
    return true;
  }

  // Greedy nearest-first linking among the selected nodes, <= maxLinksPerNode each.
  function relink(nodes) {
    let m = 0;
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
      const ia = sel[a], ib = sel[b];
      if (ia < 0 || ib < 0) continue;
      const dx = nodes[ia * 3] - nodes[ib * 3], dy = nodes[ia * 3 + 1] - nodes[ib * 3 + 1], dz = nodes[ia * 3 + 2] - nodes[ib * 3 + 2];
      pairs[m * 3] = dx * dx + dy * dy + dz * dz; pairs[m * 3 + 1] = Math.min(ia, ib); pairs[m * 3 + 2] = Math.max(ia, ib); m++;
    }
    for (let i = 1; i < m; i++) {                 // insertion sort by distance (m <= 10)
      const d0 = pairs[i * 3], a0 = pairs[i * 3 + 1], b0 = pairs[i * 3 + 2];
      let j = i - 1;
      while (j >= 0 && pairs[j * 3] > d0) { pairs[(j + 1) * 3] = pairs[j * 3]; pairs[(j + 1) * 3 + 1] = pairs[j * 3 + 1]; pairs[(j + 1) * 3 + 2] = pairs[j * 3 + 2]; j--; }
      pairs[(j + 1) * 3] = d0; pairs[(j + 1) * 3 + 1] = a0; pairs[(j + 1) * 3 + 2] = b0;
    }
    degree.fill(0);
    for (let s = 0; s < slots; s++) linkT[s] = 0; // everything retracts unless re-chosen
    for (let i = 0; i < m; i++) {
      const a = pairs[i * 3 + 1], b = pairs[i * 3 + 2];
      if (degree[a] >= maxLinksPerNode || degree[b] >= maxLinksPerNode) continue;
      degree[a]++; degree[b]++;
      const key = a * maxNodes + b;
      let s = linkKey.indexOf(key);
      if (s < 0) { s = linkKey.indexOf(-1); if (s < 0) s = linkP.indexOf(Math.min(...linkP)); linkKey[s] = key; linkP[s] = 0; }
      linkT[s] = 1;
    }
  }

  function update(nodes, n, rayO, rayD, dtSec) {
    if (select(nodes, n, rayO, rayD)) relink(nodes);
    for (let s = 0; s < slots; s++) {
      if (linkKey[s] < 0) continue;
      linkP[s] = linkT[s] ? Math.min(1, linkP[s] + dtSec / growSec) : Math.max(0, linkP[s] - dtSec / retractSec);
      if (!linkT[s] && linkP[s] <= 0) linkKey[s] = -1;
    }
  }

  // Writes [ax,ay,az,alpha, ex,ey,ez,alpha] per live link into out (Float32Array).
  // The segment grows from a toward b: end = mix(a, b, progress).
  function writeVertices(nodes, out, alpha = 0.25) {
    let v = 0;
    for (let s = 0; s < slots; s++) {
      const key = linkKey[s];
      if (key < 0) continue;
      const a = (key / maxNodes) | 0, b = key % maxNodes, p = linkP[s];
      const ax = nodes[a * 3], ay = nodes[a * 3 + 1], az = nodes[a * 3 + 2];
      out[v++] = ax; out[v++] = ay; out[v++] = az; out[v++] = alpha;
      out[v++] = ax + (nodes[b * 3] - ax) * p; out[v++] = ay + (nodes[b * 3 + 1] - ay) * p; out[v++] = az + (nodes[b * 3 + 2] - az) * p; out[v++] = alpha;
    }
    return v / 4; // vertex count
  }

  return { update, writeVertices, selected: sel, selectedDist2: selD, links: { key: linkKey, progress: linkP, target: linkT }, maxVertices: slots * 2 };
}

// Ray from the pointer through the camera. ndcX/ndcY in -1..1, invViewProj
// column-major Float32Array(16). Writes into o and d (length-3 arrays).
export function pointerRay(ndcX, ndcY, invViewProj, o, d) {
  const m = invViewProj;
  const unproject = (z, out) => {
    const x = m[0] * ndcX + m[4] * ndcY + m[8] * z + m[12];
    const y = m[1] * ndcX + m[5] * ndcY + m[9] * z + m[13];
    const zz = m[2] * ndcX + m[6] * ndcY + m[10] * z + m[14];
    const w = m[3] * ndcX + m[7] * ndcY + m[11] * z + m[15];
    out[0] = x / w; out[1] = y / w; out[2] = zz / w;
  };
  const far = [0, 0, 0];
  unproject(-1, o); unproject(1, far);
  const dx = far[0] - o[0], dy = far[1] - o[1], dz = far[2] - o[2], l = Math.hypot(dx, dy, dz) || 1;
  d[0] = dx / l; d[1] = dy / l; d[2] = dz / l;
}

const LINE_VS = `
layout(location = 0) in vec4 aPosAlpha;
uniform mat4 uViewProj;
out float vA;
void main() { vA = aPosAlpha.w; gl_Position = uViewProj * vec4(aPosAlpha.xyz, 1.0); }`;
const LINE_FS = `
in float vA;
uniform vec3 uColor;   // white, or the accent
out vec4 o;
void main() { o = vec4(uColor * vA, vA); }   // premultiplied, blend ONE, ONE`;

export function createPlexusRenderer(gl, caps, createProgram, logic) {
  const prog = createProgram(gl, caps, LINE_VS, LINE_FS);
  const data = new Float32Array(logic.maxVertices * 4);
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.bindVertexArray(null);
  // Note: gl.lineWidth > 1 is ignored on ANGLE/D3D, Metal and most mobiles
  // (ALIASED_LINE_WIDTH_RANGE is [1,1]); for thicker links draw quads.
  function draw(nodes, viewProj, color = [1, 1, 1], alpha = 0.25) {
    if (!prog.ready()) return 0;
    const count = logic.writeVertices(nodes, data, alpha);
    if (!count) return 0;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(prog.uniforms.uViewProj, false, viewProj);
    gl.uniform3fv(prog.uniforms.uColor, color);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 4);
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE); gl.disable(gl.DEPTH_TEST);   // altered: alpha untouched (coverage)
    gl.drawArrays(gl.LINES, 0, count);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    return count;
  }
  return { draw, program: prog };
}
