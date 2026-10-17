// The ember: drawn last into the HDR target, scissored to its box. Its coverage is THIS frame's alpha of the particles NEARER than it
// (the ember's box of the scene, copied into uPrevHdr before this pass), opened by the trail (a tear lets the warmth out). Particles
// behind the ember never touch it.
// The amber eclipse (TUNE-ADDENDUM §4): the struts may visibly eclipse the light; the light never breaks into lobes, never shows dark
// grit, and what the dust takes comes back as amber. The coverage is optical density x each grain's bead gain (RENDER_FS), so the
// beads block and the faint tube body barely does. Three layers: the white core (uOcc.x), the gold body inside the cage (uOcc.y) and
// the outer haze, the air in front of the struts (uOcc.z, light, so the glow stays one shape). The light seen through dust shifts
// from white-hot to the ember tone at the same luminance (uRedden). keep (uOcc.w): ONE coverage value for the whole core (9 taps about
// its centre) caps what the core as a whole can lose, a floor one strand never reaches (two struts crossing, a scatter cloud).
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
uniform vec4 uOcc;            // the most a saturated front strand takes from (core, gold body, outer haze); keep (the whole core's floor)
uniform float uRedden;        // share of the shift from white-hot to the ember tone at full coverage
uniform vec4 uLayer;          // DEPTH-SPEC §3: (coreK, body B, body K, body tint toward hot)
uniform vec2 uHazeOff;        // DEPTH-SPEC §3: haze/body centre offset from the core (HDR px): the glow trails the heart
uniform vec2 uLife;           // DEPTH-SPEC §3: (core luminance x, body radius x): the slow inner life
out vec4 o;
const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
float cover(vec2 uv) { return texture(uPrevHdr, uv).a; }
void main() {
  vec2 d = (gl_FragCoord.xy - uEmberPx) / uEmberR;
  float r2 = dot(d, d);
  if (r2 > 9.0) discard;
  float core = exp(-r2 * uLayer.x) * uLife.x;
  vec2 dh = (gl_FragCoord.xy - uEmberPx - uHazeOff) / uEmberR;
  float h2 = dot(dh, dh), b2 = h2 / max(1e-4, uLife.y * uLife.y);
  float body = uLayer.y * exp(-uLayer.z * b2), haze = 0.25 / (1.0 + 40.0 * h2);
  vec3 glowCol = mix(uEmberCol, uEmberHot, uLayer.w * body / max(body + haze, 1e-4));   // body warmer than the haze: a 3D temperature gradient
  vec3 tint = mix(mix(glowCol, uEmberHot, core), uEmberHot, 0.5 * uWarmMix) * (uLevel * (1.0 + uFlicker * sin(60.0 * uTime)));
  // front coverage over ~1.5 px (centre + a rotated 4-tap on the LINEAR target): grain-sharp, never a core-scale band (that band is
  // the low-frequency notch the owner rejected)
  vec2 uv = gl_FragCoord.xy * uInvRes, t1 = vec2(1.25, 0.6) * uInvRes, t2 = vec2(-0.6, 1.25) * uInvRes;
  float cv = 0.36 * cover(uv) + 0.16 * (cover(uv + t1) + cover(uv - t1) + cover(uv + t2) + cover(uv - t2));
  float k = 1.0 - exp(-3.0 * clamp(cv, 0.0, 1.0) * (1.0 - 0.8 * texture(uTrail, uv).r));
  float kc = k;
  if (r2 < 0.09 && uOcc.w > 0.0) {   // keep: one value for the whole core (centre + 8 taps at 0.6 of its 1/e radius); core-only, so no seam
    vec2 c0 = uEmberPx * uInvRes; float rc = 0.6 * uEmberR * inversesqrt(uLayer.x);
    float cw = 0.2 * cover(c0);
    for (int i = 0; i < 8; i++) { float a = 0.7853982 * float(i); cw += 0.1 * cover(c0 + rc * vec2(cos(a), sin(a)) * uInvRes); }
    float kw = 1.0 - exp(-3.0 * clamp(cw, 0.0, 1.0) * (1.0 - 0.8 * texture(uTrail, c0).r));
    kc *= (1.0 - uOcc.w) / max(uOcc.x * kw, 1.0 - uOcc.w);
  }
  vec3 dusk = uEmberCol * (dot(tint, Y) / max(dot(uEmberCol, Y), 1e-4));   // the ember tone at the same luminance
  o = vec4(mix(tint, dusk, uRedden * kc) * (3.0 * core * (1.0 - uOcc.x * kc))
         + mix(tint, dusk, uRedden * k) * (body * (1.0 - uOcc.y * k))
         + tint * (haze * (1.0 - uOcc.z * k)), 0.0);
}
