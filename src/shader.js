// The Threshold: a hovering smoked-glass doorway with dawn behind it.
// One full-screen pass. The door is raymarched inside a bounding sphere, the
// floor and sky are analytic, and the light shaft is a short single-scatter
// march through a spot cone masked by the opening. Every animated input is a
// Motion-driven uniform (see scene-state.js).
export const VERTEX_SOURCE = `#version 300 es
precision highp float;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2  u_res, u_anchor;
uniform float u_anchorH, u_time, u_quality, u_debug;
uniform float u_yaw, u_pitch, u_lightX, u_lightY;
uniform float u_dawn, u_engage, u_reveal, u_rise, u_plan, u_pulse, u_idle, u_dolly, u_dim, u_motion;

const vec3  INK = vec3(0.0014, 0.0026, 0.0034);
const vec3  WARM = vec3(1.00, 0.72, 0.42), WARM_HI = vec3(1.00, 0.90, 0.74), COOL = vec3(0.55, 0.85, 0.82);
const vec3  GLOW = vec3(1.00, 0.62, 0.30);
const float FLOOR_Y = -0.66, CAM_D = 3.2, DEPTH = 0.11, OPEN = 0.285, ARCH_Y = 0.13;
const vec2  OUTER = vec2(0.37, 0.50);
const vec3  LAMP = vec3(0.0, -0.08, -1.7), CONE_AXIS = vec3(0.0, 0.1390, 0.9903), SPILL_AXIS = vec3(0.0, -0.2588, 0.9659);

mat2  rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdBox2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
float sdBox3(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }

float doorY() { return (u_rise - 1.0) * 0.35; }
// Opening profile in the door plane: a slot below ARCH_Y capped by a semicircle. Negative inside.
float opening2d(vec2 p) {
  p.x = abs(p.x);
  float arch = length(p - vec2(0.0, ARCH_Y)) - OPEN;
  float slot = max(p.x - OPEN, p.y - ARCH_Y);
  return min(arch, slot);
}
// Square and machined outside, arched inside, open at the foot.
float sdDoor(vec3 p) { p.y -= doorY(); return max(sdBox3(p, vec3(OUTER, DEPTH), 0.012), -opening2d(p.xy)); }
vec3 doorNormal(vec3 p) {
  const vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * sdDoor(p + e.xyy) + e.yyx * sdDoor(p + e.yyx) + e.yxy * sdDoor(p + e.yxy) + e.xxx * sdDoor(p + e.xxx));
}

float coneMask(vec3 P) { vec3 d = P - LAMP; float c = dot(d, CONE_AXIS) / max(length(d), 1e-4); return smoothstep(0.955, 0.992, c); }
// A wider, lower lobe that only lights the floor: light spilling through the doorway.
float spillMask(vec3 P) { vec3 d = P - LAMP; float c = dot(d, SPILL_AXIS) / max(length(d), 1e-4); return smoothstep(0.86, 0.985, c); }
// 1 where the segment P to L passes through the opening or around the door.
float planeMask(vec2 x) {
  x.y -= doorY();
  float through = 1.0 - smoothstep(-0.015, 0.01, opening2d(x));
  float around = smoothstep(0.0, 0.03, sdBox2(x, OUTER));
  return max(through, around);
}
float doorMask(vec3 P, vec3 L) {
  vec3 d = L - P; if (abs(d.z) < 1e-4) return 1.0;
  float t = -P.z / d.z; if (t < 0.0 || t > 1.0) return 1.0;
  return planeMask(P.xy + d.xy * t);
}
// Only the light that passes through the opening: the doorway's pool on the floor.
float throughMask(vec3 P, vec3 L) {
  vec3 d = L - P; if (abs(d.z) < 1e-4) return 0.0;
  float t = -P.z / d.z; if (t < 0.0 || t > 1.0) return 0.0;
  vec2 x = P.xy + d.xy * t; x.y -= doorY();
  return 1.0 - smoothstep(-0.02, 0.02, opening2d(x));
}
float dawnLevel() { return u_dawn * (1.0 - 0.6 * u_dim) * (1.0 + 0.35 * u_engage); }
float lampI(vec3 P) { vec3 d = P - LAMP; return dawnLevel() / (1.0 + 0.35 * dot(d, d)); }
float lightVis(vec3 P, int taps) {
  float v = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= taps) break;
    float a = float(i) * 1.5708 + 0.785;
    v += throughMask(P, LAMP + vec3(cos(a), sin(a), 0.0) * 0.16);
  }
  return v / float(taps);
}
vec3 sky(vec3 ro, vec3 rd) {
  float dawn = dawnLevel();
  vec3 col = INK + WARM * 0.012 * exp(-abs(rd.y + 0.02) * 16.0) * dawn;
  vec3 toL = normalize(LAMP - ro);
  float a = acos(clamp(dot(rd, toL), -1.0, 1.0));
  float core = exp(-a * a * 90.0) * 1.2, air = exp(-a * a * 9.0) * 0.02;
  float mask = 1.0;
  if (rd.z < -1e-4) {
    float t = -ro.z / rd.z;
    if (t > 0.0) mask = planeMask(ro.xy + rd.xy * t);
  }
  return col + (GLOW * core + WARM * air) * dawn * mix(0.10, 1.0, mask);
}
vec3 shadeFloor(vec3 P) {
  vec3 col = INK * 0.85;
  float lamp = lampI(P);
  float lv = lightVis(P, u_quality > 0.5 ? 4 : 2) * spillMask(P);
  vec3 toL = normalize(LAMP - P);
  col += WARM * lv * max(toL.y, 0.0) * lamp * 0.3;
  // The visitor light leaves a small cool pool, not a floodlight.
  vec2 under = P.xz - vec2(u_lightX, 1.15);
  float visitor = exp(-dot(under, under) / 0.45) * (0.4 + 0.6 * clamp(u_lightY + 0.4, 0.0, 1.0));
  col += COOL * visitor * 0.016;
  // The plan: a fine grid that only shows where light touches it.
  vec2 g = P.xz / 0.125;
  vec2 gf = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
  float line = 1.0 - min(min(gf.x, gf.y), 1.0);
  float reach = u_plan * 7.0;
  float reveal = 1.0 - smoothstep(reach - 1.2, reach, length(P.xz));
  float dawnReveal = u_dawn * 0.05 * exp(-0.6 * length(P.xz - vec2(0.0, -2.2)));
  col += vec3(0.55, 0.78, 0.76) * line * reveal * (0.0035 + 0.16 * lv * lamp + 0.035 * visitor + dawnReveal);
  float foot = sdBox2(P.xz, vec2(OUTER.x, DEPTH));
  col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.26, foot)) * u_rise;
  float ring = exp(-pow((length(P.xz) - u_pulse * 2.8) / 0.16, 2.0)) * pow(1.0 - u_pulse, 2.0) * u_motion;
  return col + WARM * ring * 0.10;
}
float haze(vec3 ro, vec3 rd, float tmax) {
  if (abs(rd.z) < 1e-4) return 0.0;
  float tz = -ro.z / rd.z; vec2 at = ro.xy + rd.xy * tz;
  if (at.y > 1.3 || at.y < -1.0 || abs(at.x) > 1.4) return 0.0;
  float ta = (1.7 - ro.z) / rd.z, tb = (-1.6 - ro.z) / rd.z;
  float t0 = max(min(ta, tb), 0.0), t1 = min(max(ta, tb), tmax);
  if (t1 <= t0) return 0.0;
  int n = u_quality > 0.5 ? 14 : 8;
  float dt = (t1 - t0) / float(n);
  float j = hash(gl_FragCoord.xy);
  float acc = 0.0;
  for (int i = 0; i < 14; i++) {
    if (i >= n) break;
    vec3 P = ro + rd * (t0 + (float(i) + j) * dt);
    acc += doorMask(P, LAMP) * coneMask(P) * lampI(P) * dt;
  }
  return acc * 0.085;
}
vec3 shadeDoor(vec3 P, vec3 N, vec3 rd) {
  float NdV = clamp(dot(N, -rd), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - NdV, 5.0);
  vec3 refl = sky(P, reflect(rd, N));
  vec3 V = vec3(u_lightX, u_lightY, 1.15) - P; float dv2 = dot(V, V); V *= inversesqrt(dv2);
  float ndh = max(dot(N, normalize(V - rd)), 0.0);
  float spec = (pow(ndh, 160.0) * 1.1 + pow(ndh, 14.0) * 0.06) / (1.0 + 0.8 * dv2);
  // One refracted path through the glass, with smoky absorption.
  vec3 rr = refract(rd, N, 1.0 / 1.45); vec3 q = P + rr * 0.004; float path = 0.0;
  for (int i = 0; i < 14; i++) {
    float d = sdDoor(q);
    if (d > 0.0005) break;
    float s = max(-d, 0.01); q += rr * s; path += s;
  }
  vec3 N2 = -doorNormal(q);
  vec3 rr2 = refract(rr, N2, 1.45);
  if (dot(rr2, rr2) < 0.5) rr2 = reflect(rr, N2);
  vec3 through = sky(q, rr2) * exp(-vec3(3.0, 2.1, 1.8) * path * (0.3 + 0.7 * u_reveal));
  vec3 toL = LAMP - P; float dl2 = dot(toL, toL); toL *= inversesqrt(dl2);
  float rim = max(dot(N, toL), 0.0) * coneMask(P) * u_dawn * (1.0 - 0.6 * u_dim) / (1.0 + 0.35 * dl2);
  float edge = pow(1.0 - NdV, 4.0);
  vec2 local = P.xy - vec2(0.0, doorY());
  float bleed = exp(-max(opening2d(local), 0.0) * 16.0) * (0.55 + 0.45 * smoothstep(0.0, -DEPTH, P.z));
  vec3 glass = mix(through, refl, F) + COOL * spec + WARM * rim * 0.9 + WARM_HI * edge * 0.06 * (0.3 + u_dawn)
    + GLOW * bleed * dawnLevel() * 0.10 * (1.0 - F);
  // Before it materialises, the door is drawn: edges and glints only.
  vec3 drawn = WARM_HI * edge * 0.22 + COOL * spec * 0.5;
  return mix(drawn, glass, u_reveal);
}
void main() {
  float yaw = (u_yaw + u_idle * 0.06 * sin(u_time * 0.37)) * u_motion;
  float pitch = -0.10 + (u_pitch + u_idle * 0.03 * sin(u_time * 0.23 + 1.0)) * u_motion;
  float dist = CAM_D + 0.6 * u_dolly;
  vec3 target = vec3(0.0, -0.02, 0.0);
  vec3 off = vec3(0.0, 0.0, dist); off.yz = rot(pitch) * off.yz; off.xz = rot(yaw) * off.xz;
  vec3 ro = target + off;
  vec3 fwd = normalize(target - ro), right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0))), up = cross(right, fwd);
  // Off-axis projection: the door lands on the DOM anchor at the anchor's height.
  vec2 ndc = (gl_FragCoord.xy - u_anchor) / (0.5 * u_res.y);
  float focal = 2.0 * CAM_D * (u_anchorH / u_res.y);
  vec3 rd = normalize(fwd * focal + right * ndc.x + up * ndc.y);
  float pixAng = 1.0 / (focal * 0.5 * u_res.y);

  bool hitsFloor = rd.y < -1e-4;
  float tFloor = hitsFloor ? (FLOOR_Y - ro.y) / rd.y : 1e9;
  vec3 c = vec3(0.0, doorY(), 0.0); vec3 oc = ro - c;
  float b = dot(oc, rd); float h = b * b - dot(oc, oc) + 0.49;
  float tDoor = -1.0, cover = 0.0; vec3 Pd = vec3(0.0), Nd = vec3(0.0, 0.0, 1.0);
  if (h > 0.0) {
    float s = sqrt(h); float t = max(-b - s, 0.0); float tEnd = min(-b + s, tFloor);
    float minD = 1e9, tMin = t;
    for (int i = 0; i < 56; i++) {
      vec3 p = ro + rd * t; float d = sdDoor(p); float dn = d / (t * pixAng);
      if (dn < minD) { minD = dn; tMin = t; }
      if (d < 0.0006 * t) { tDoor = t; break; }
      t += d * 0.92; if (t > tEnd) break;
    }
    if (tDoor > 0.0) { cover = 1.0; Pd = ro + rd * tDoor; }
    else if (minD < 1.0) { cover = 1.0 - smoothstep(0.0, 1.0, minD); Pd = ro + rd * tMin; }
    if (cover > 0.0) Nd = doorNormal(Pd);
  }
  // Floor shading uses derivatives, so evaluate it in uniform control flow.
  float tf = min(tFloor, 40.0);
  vec3 floorCol = shadeFloor(ro + rd * tf);
  vec3 skyCol = sky(ro, rd);
  vec3 bg = hitsFloor ? mix(floorCol, skyCol, 1.0 - exp(-0.030 * tf * tf)) : skyCol;
  vec3 col = (cover > 0.0) ? mix(bg, shadeDoor(Pd, Nd, rd), cover) : bg;
  float tHaze = (tDoor > 0.0) ? tDoor : tFloor;
  col += WARM * haze(ro, rd, tHaze) * (1.0 + 0.6 * pow(1.0 - u_pulse, 2.0) * u_motion);
  col *= 1.0 - 0.35 * u_dim;
  col = sqrt(1.0 - exp(-col * 1.4));
  col += (hash(gl_FragCoord.xy * 1.7) - 0.5) * (2.0 / 255.0);
  if (u_debug > 0.5) {
    if (u_debug < 1.5) col = Nd * 0.5 + 0.5;
    else if (u_debug < 2.5) col = vec3(doorMask(ro + rd * min(tHaze, 3.0), LAMP));
    else if (u_debug < 3.5) col = vec3(haze(ro, rd, tHaze) * 4.0);
    else col = sqrt(1.0 - exp(-floorCol * 1.4)) * (hitsFloor ? 1.0 : 0.0);
  }
  outColor = vec4(col, 1.0);
}`;

// WebGL1 path: the same shader, translated. Loops are already constant-bounded.
export function toGLSL1(source, stage) {
  let out = source.replace('#version 300 es\n', '');
  if (stage === 'vertex') {
    return `precision highp float;
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
  }
  out = out.replace('out vec4 outColor;\n', '');
  out = out.replace(/outColor/g, 'gl_FragColor');
  return `#extension GL_OES_standard_derivatives : enable\n${out}`;
}
