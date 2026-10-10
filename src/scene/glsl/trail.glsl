// SPDX-License-Identifier: 0BSD
// Cursor scan-trail ping-pong (fragment, GLSL ES 3.00), the input that
// lattice.glsl quantizes. Kit original, Twenty Nine Eleven (2026), written from
// the igloo.inc "mouse frost" behaviour in research-igloo-techniques.md 3.4:
// grow by 4-neighbour max, line splat prev->current, decay .985 per 60 Hz frame,
// R = value, G = rim (leading edge), B = smoothed rim.
// Target: RGBA16F at 1/4-1/5 of canvas resolution, LINEAR filtering.
// JS each frame: uRadius = 0.05 * smoothstep(0.1, 1.0, pointerVelocity) (in
// units of height; zero when still, so a resting cursor paints nothing);
// uDecay = pow(0.985, ratio); reset uA = uB after >150 ms idle or a jump > 0.3.
in vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uA, uB;         // previous / current pointer, UV
uniform float uRadius;       // see above
uniform float uAspect;       // width / height
uniform float uDecay;        // pow(0.985, ratio)
uniform float uGrow;         // max-dilation share this frame: 1 - 0.65^ratio (0.35 per 60 Hz frame)
uniform float uRatio;        // frame time / (1/60 s): the splat scales with it so 120 Hz paints like 60 Hz
uniform float uTime;
uniform vec3 uSeal;          // the resync front: centre (UV, y up) and radius (height units); the trail is cleared behind it
uniform float uHead;         // 1 = the new paint is a leading edge (G/B channels); 0 on a press frame
uniform float uSealK;        // fraction cleared this frame: 1 - (1 - 0.35 * amp)^ratio; 0 = none
out vec4 o;
float capsule(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy), s = textureSize(uPrev, 0);
  // organic creep: tiny time-varying offset instead of igloo's flow texture
  vec2 px = 1.0 / vec2(s);
  vec2 drift = vec2(sin(vUv.y * 23.0 + uTime * 0.7), cos(vUv.x * 19.0 - uTime * 0.6)) * px * 0.5;
  vec4 prev = texture(uPrev, vUv + drift);
  float n = max(max(texelFetch(uPrev, clamp(c + ivec2(1, 0), ivec2(0), s - 1), 0).r,
                    texelFetch(uPrev, clamp(c - ivec2(1, 0), ivec2(0), s - 1), 0).r),
                max(texelFetch(uPrev, clamp(c + ivec2(0, 1), ivec2(0), s - 1), 0).r,
                    texelFetch(uPrev, clamp(c - ivec2(0, 1), ivec2(0), s - 1), 0).r));
  float grown = mix(prev.r, max(prev.r, n), uGrow);
  vec2 asp = vec2(uAspect, 1.0);
  float k = clamp(1.0 - capsule(vUv * asp, uA * asp, uB * asp) / max(uRadius, 1e-5), 0.0, 1.0);
  k = uRadius > 1e-5 ? k * k * k * min(1.0, uRatio) : 0.0;
  float v = min((grown + k) * uDecay, 1.0);
  if (uSealK > 0.0) v *= 1.0 - uSealK * (1.0 - smoothstep(uSeal.z - 0.06, uSeal.z, length((vUv - uSeal.xy) * asp)));   // the seal is literal
  float rim = max(v - prev.r, 0.0) * uHead;
  o = vec4(v, rim, (prev.b + rim) * 0.9, 1.0);
}
