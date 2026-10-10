// Composite: HDR scene + bloom -> ACES -> sRGB -> haze, slate lift, highlight tint toward the ember, vignette,
// dim, chromatic aberration (entrance/modal only, masked to the disc), blue-noise dither. Extends the kit's grade.glsl.
in vec2 vUv;
uniform sampler2D uScene, uBloom, uBlue;
uniform ivec2 uBlueOffset;
uniform float uBloomIntensity, uExposure;
uniform vec3 uInk, uHaze, uSlate, uAccent;   // sRGB floats
uniform float uLift, uHighlightTint, uVignette, uDither;
uniform vec3 uShell;                         // shell centre (px, y up) and radius (px), output space
uniform vec2 uHazeLean;                      // the haze leans with the probe (px)
uniform float uGuardY, uGuardFeather;        // lower limb (px, y up); bloom fades to 0 within the feather below it
uniform float uDim, uCA;
out vec4 o;
vec3 acesFit(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 q = (px - uShell.xy) / max(uShell.z, 1.0);
  float rr = length(q);
  vec3 scene;
  if (uCA > 0.001) {
    vec2 dir = q * uCA * 0.004 * smoothstep(0.3, 1.2, rr);
    scene = vec3(texture(uScene, vUv + dir).r, texture(uScene, vUv).g, texture(uScene, vUv - dir).b);
  } else scene = texture(uScene, vUv).rgb;
  float guard = 1.0 - smoothstep(0.0, uGuardFeather, uGuardY - px.y);
  vec3 bloom = texture(uBloom, vUv).rgb * uBloomIntensity * guard;
  vec3 hdr = max(scene + bloom, 0.0) * uExposure;
  vec3 c = toSRGB(acesFit(hdr));
  vec2 qh = (px - (uShell.xy + uHazeLean)) / max(uShell.z, 1.0);
  c += (uHaze - uInk) * (1.0 - smoothstep(0.0, 2.2, length(qh)));
  vec3 lift = uSlate * uLift; c = lift + (1.0 - lift) * c;
  float l = lumaOf(c);
  vec3 tinted = l * uAccent / max(lumaOf(uAccent), 1e-4);
  c = mix(c, tinted, smoothstep(0.55, 1.0, l) * uHighlightTint);
  vec2 v = vUv - 0.5; c *= 1.0 - uVignette * smoothstep(0.2, 0.8, dot(v, v) * 2.0);
  c *= 1.0 - 0.5 * uDim;
  ivec2 bs = textureSize(uBlue, 0);
  vec3 bn = texelFetch(uBlue, (ivec2(px) + uBlueOffset) & (bs - 1), 0).rgb;
  c += (bn - 0.5) * (uDither / 255.0);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}
