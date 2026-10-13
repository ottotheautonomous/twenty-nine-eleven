import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';

// Security headers GitHub Pages cannot send, as meta tags in the BUILT page only (the dev server injects inline styles a CSP would
// block). The inline script's hash is computed from the page itself, and the contact endpoint's origin comes from the same setting
// the form uses, so neither can drift. frame-ancestors cannot be set from a meta tag: src/main.js refuses to run framed.
function securityHeaders() {
  let contact = '', turnstile = '';
  return {
    name: 'security-headers',
    apply: 'build',
    configResolved({ env }) {   // the same resolved settings the bundle is built with
      contact = new URL(env.VITE_CONTACT_ENDPOINT || 'https://twenty-nine-eleven-contact.twentynineeleven.workers.dev/api/contact').origin;
      turnstile = env.VITE_TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : '';   // Cloudflare's bot check: its script and frame, only when configured
    },
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
        .map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
      const csp = [
        "default-src 'none'",
        `script-src 'self' ${hashes.join(' ')}${turnstile}`,
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self' ${contact}`,
        `form-action ${contact}`,
        "base-uri 'none'",
        "object-src 'none'",
        ...(turnstile ? [`frame-src${turnstile}`] : []),
        "manifest-src 'self'",
      ].join('; ');
      return html.replace('<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${csp}" />\n  <meta name="referrer" content="strict-origin-when-cross-origin" />`);
    },
  };
}

export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [securityHeaders()],
});
