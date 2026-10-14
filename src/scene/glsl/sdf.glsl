// ====================================================================
// Analytic SDF for the Sentinel lattice (GLSL ES 3.00). Lifted from the
// Twenty Nine Eleven kit, 03-sdf/sdf.glsl, with the shape table replaced.
//
// Part A - Inigo Quilez primitives, formulas from
//   https://iquilezles.org/articles/distfunctions/ and https://iquilezles.org/articles/smin/
//   License: MIT, Copyright (c) 2013 Inigo Quilez (see public/third-party-notices.txt).
// Part B - kit original (SPDX-License-Identifier: 0BSD): geodesic great-circle
//   lattice and gradients.
// ====================================================================

// ---------------- Part A: Inigo Quilez (MIT) ------------------------
float sdSphere(vec3 p, float r) { return length(p) - r; }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
float opUnion(float a, float b) { return min(a, b); }
float smin(float a, float b, float k) {
  k *= 4.0;
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * (1.0 / 4.0);
}

// ---------------- Part B: kit original (0BSD) -----------------------
// Icosahedral symmetry axes. Great circles perpendicular to:
//   5-fold axes (6)  -> icosidodecahedral net
//   3-fold axes (10) -> 10 circles, hexagon-rich net
const vec3 AX5[6] = vec3[6](
  vec3(0.0, 0.85065081, 0.52573111), vec3(0.0, -0.85065081, 0.52573111),
  vec3(0.52573111, 0.0, 0.85065081), vec3(-0.52573111, 0.0, 0.85065081),
  vec3(0.85065081, 0.52573111, 0.0), vec3(-0.85065081, 0.52573111, 0.0));
const vec3 AX3[10] = vec3[10](
  vec3(0.57735027, 0.57735027, 0.57735027), vec3(-0.57735027, 0.57735027, 0.57735027),
  vec3(0.57735027, -0.57735027, 0.57735027), vec3(0.57735027, 0.57735027, -0.57735027),
  vec3(0.0, 0.35682209, 0.93417236), vec3(0.0, -0.35682209, 0.93417236),
  vec3(0.93417236, 0.0, 0.35682209), vec3(-0.93417236, 0.0, 0.35682209),
  vec3(0.35682209, 0.93417236, 0.0), vec3(-0.35682209, 0.93417236, 0.0));

// Distance to a tube of radius r around the great circle (radius R, normal n).
float sdGreatCircle(vec3 p, float pl2, vec3 n, float R, float r) {
  float h = dot(p, n);
  return length(vec2(sqrt(max(pl2 - h * h, 0.0)) - R, h)) - r;
}
// Geodesic lattice: union of great-circle tubes. set 0 = 6 circles, 1 = 10 circles.
float sdGeodesic(vec3 p, float R, float r, int set) {
  float pl2 = dot(p, p);
  float d = 1e9;
  if (set == 0) for (int i = 0; i < 6; i++) d = min(d, sdGreatCircle(p, pl2, AX5[i], R, r));
  else for (int i = 0; i < 10; i++) d = min(d, sdGreatCircle(p, pl2, AX3[i], R, r));
  return d;
}

// Shape table. 0 = ten great circles (icosahedral 3-fold axes), 1 = six (5-fold axes). Nothing else exists.
uniform mat3 uLatticeRotT;          // transpose of shape.js's tilt matrix: world -> lattice frame
uniform int uShape;                 // 0 (default) or 1 (fallback)
float sdfShape(int id, vec3 p) {
  vec3 q = uLatticeRotT * p;
  if (id == 1) return sdGeodesic(q, 1.0, 0.03, 0);   // = LATTICE.tube (constants.js) = TUBE_JITTER x 4/3
  return sdGeodesic(q, 1.0, 0.03, 1);
}
float sdfScene(vec3 p) { return sdfShape(uShape, p); }

// Tetrahedral gradient (4 evaluations). The loop starts at a uniform that is
// always 0, so compilers cannot unroll it and inline sdfScene four times.
uniform int uSdfZero;
vec3 sdfGradientTetra(vec3 p, float h) {
  vec3 n = vec3(0.0);
  for (int i = uSdfZero; i < 4; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += e * sdfScene(p + e * h);
  }
  return n / (h * 4.0 * 0.5773 * 0.5773);
}
