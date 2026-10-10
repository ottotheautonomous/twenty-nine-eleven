// The ember: drawn last into the HDR target, scissored to its box. Its coverage is THIS frame's alpha of the particles NEARER than it
// (the ember's box of the scene, copied into uPrevHdr before this pass), opened by the trail (a tear lets the warmth out). A front strut
// dims the core and the back half of the halo; the halo's front half is the glow in the air between the camera and the strut and is
// never cut. Particles behind the ember never touch it.
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
uniform vec2 uOcc;            // the most a front strut takes from the core, from the halo
out vec4 o;
void main() {
  vec2 d = (gl_FragCoord.xy - uEmberPx) / uEmberR;
  float r2 = dot(d, d);
  if (r2 > 9.0) discard;
  float core = exp(-r2 * 90.0);
  float halo = 0.25 / (1.0 + 40.0 * r2);
  vec3 tint = mix(mix(uEmberCol, uEmberHot, core), uEmberHot, 0.5 * uWarmMix) * (uLevel * (1.0 + uFlicker * sin(60.0 * uTime)));
  // front coverage over ~1.5 px (centre + a rotated 4-tap on the LINEAR target): a penumbra, not a per-pixel stair-step
  vec2 uv = gl_FragCoord.xy * uInvRes, t1 = vec2(1.25, 0.6) * uInvRes, t2 = vec2(-0.6, 1.25) * uInvRes;
  float cv = 0.36 * texture(uPrevHdr, uv).a + 0.16 * (texture(uPrevHdr, uv + t1).a + texture(uPrevHdr, uv - t1).a
           + texture(uPrevHdr, uv + t2).a + texture(uPrevHdr, uv - t2).a);
  float k = 1.0 - exp(-3.0 * clamp(cv, 0.0, 1.0) * (1.0 - 0.8 * texture(uTrail, uv).r));
  o = vec4(tint * (3.0 * core * (1.0 - uOcc.x * k) + halo * (1.0 - uOcc.y * k)), 0.0);
}
