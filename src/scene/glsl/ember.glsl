// The ember: drawn last into the HDR target, scissored to its box. It reads the previous frame's
// coverage (HDR alpha) and the trail, so a tear in the lattice lets the warmth out.
in vec2 vUv;
uniform sampler2D uPrevHdr, uTrail;
uniform vec2 uEmberPx;        // ember centre, HDR px (y up)
uniform float uEmberR;        // halo radius, HDR px
uniform vec3 uEmberCol, uEmberHot;
uniform float uLevel;         // u_ember · gestures · tear · breath (computed on the CPU)
uniform float uFlicker;       // 0.08·(1 − u_build) during ignition, then 0
uniform float uWarmMix;       // u_warm: colour toward the hot tone
uniform float uTime;
uniform vec2 uInvRes;
out vec4 o;
void main() {
  vec2 d = (gl_FragCoord.xy - uEmberPx) / uEmberR;
  float r2 = dot(d, d);
  if (r2 > 9.0) discard;
  float core = exp(-r2 * 90.0);
  float halo = 0.25 / (1.0 + 40.0 * r2);
  vec3 c = mix(mix(uEmberCol, uEmberHot, core), uEmberHot, 0.5 * uWarmMix) * (3.0 * core + halo);
  c *= uLevel * (1.0 + uFlicker * sin(60.0 * uTime));
  float cover = clamp(texelFetch(uPrevHdr, ivec2(gl_FragCoord.xy), 0).a, 0.0, 1.0)
              * (1.0 - 0.8 * texture(uTrail, gl_FragCoord.xy * uInvRes).r);
  c *= exp(-3.0 * cover);
  o = vec4(c, 0.0);
}
