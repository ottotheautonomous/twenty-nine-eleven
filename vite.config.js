import { createHash } from 'node:crypto';
import { defineConfig, loadEnv } from 'vite';

// Security headers GitHub Pages cannot send, as meta tags in the BUILT page only (the dev server injects inline styles a CSP would
// block). The inline script's hash is computed from the page itself, and the contact endpoint's origin comes from the same setting
// the form uses, so neither can drift. frame-ancestors cannot be set from a meta tag: src/main.js refuses to run framed.
function securityHeaders(mode) {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const contact = new URL(env.VITE_CONTACT_ENDPOINT || 'https://contact.twentynineeleven.net/api/contact').origin;
  return {
    name: 'security-headers',
    apply: 'build',
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
        .map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
      const csp = [
        "default-src 'none'",
        `script-src 'self' ${hashes.join(' ')}`,
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self' ${contact}`,
        `form-action ${contact}`,
        "base-uri 'none'",
        "object-src 'none'",
        "manifest-src 'self'",
      ].join('; ');
      return html.replace('<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  <meta name="referrer" content="strict-origin-when-cross-origin" />`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: './',
  build: { target: 'es2022' },
  plugins: [securityHeaders(mode)],
}));
