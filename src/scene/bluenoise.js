// SPDX-License-Identifier: 0BSD
// Blue-noise dither texture loader (lifted from the Twenty Nine Eleven kit,
// 06-bluenoise/bluenoise.js; generator removed). The texture is Christoph
// Peters' CC0 64x64 RGB blue noise (see public/third-party-notices.txt).

// Load a PNG (e.g. Vite: import bnUrl from './LDR_RGB1_0.png?url'). Uses
// createImageBitmap with colorSpaceConversion:'none' so the browser does not
// colour-manage the noise values (an embedded gAMA/iCCP chunk would skew them).
export async function loadBlueNoise(gl, url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  setNoiseParams(gl);
  const size = bmp.width;
  bmp.close?.();
  return { texture: tex, size };
}

function setNoiseParams(gl) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
}

// Per-frame offset: uniform ints in [0, size). Do NOT reuse one offset for two
// effects in the same frame; use another channel or offset (Peters' advice).
export function blueNoiseOffset(size, out = [0, 0]) {
  out[0] = (Math.random() * size) | 0; out[1] = (Math.random() * size) | 0;
  return out;
}
