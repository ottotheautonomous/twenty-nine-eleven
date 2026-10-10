// Cloudflare Turnstile: an invisible bot check for the contact form. Inert unless VITE_TURNSTILE_SITE_KEY is set at build
// (the site key is public; the secret lives only in the Worker). Cloudflare's script loads when the contact panel first
// opens, never with the page. The widget runs in execute mode and only shows itself if Cloudflare needs an interaction.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const turnstileEnabled = Boolean(SITE_KEY);

let loading = null, widget = null, container = null, pending = null;

function load() {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const script = document.createElement('script');
    script.src = SCRIPT; script.async = true; script.defer = true;
    const fail = () => { loading = null; script.remove(); reject(new Error('turnstile')); };   // the next send fetches it afresh
    script.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : fail()), { once: true });
    script.addEventListener('error', fail, { once: true });
    document.head.append(script);
  });
  return loading;
}

function settle(fn, value) { const p = pending; pending = null; p?.[fn](value); }

function render(ts) {
  if (widget !== null) return;
  widget = ts.render(container, {
    sitekey: SITE_KEY, action: 'contact', execution: 'execute', appearance: 'interaction-only', theme: 'dark', size: container.parentElement.clientWidth >= 300 ? 'flexible' : 'compact',   // flexible needs 300px; a 320px phone gets compact
    callback: (token) => settle('resolve', token),
    'error-callback': () => { settle('reject', new Error('turnstile')); return true; },
    'expired-callback': () => ts.reset(widget),
  });
}

// Called when the contact panel opens: fetch Cloudflare's script and render the (hidden) widget ahead of the first send.
export function prepareTurnstile(element) {
  if (!SITE_KEY || !element) return;
  container = element;
  load().then(render).catch(() => {});
}

// A fresh single-use token for one submission. Rejects with a message the form shows as its status.
export async function turnstileToken() {
  if (!SITE_KEY) return '';
  const failure = new Error('We could not verify this browser. Please try again. Your message is still here.');
  let ts;
  try { ts = await Promise.race([load(), new Promise((_, reject) => setTimeout(reject, 10000))]); } catch { throw failure; }   // a hung script cannot hold the form on Sending…
  if (!container) throw failure;
  render(ts);
  settle('reject', failure);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle('reject', failure), 30000);
    pending = { resolve: (t) => { clearTimeout(timer); resolve(t); }, reject: () => { clearTimeout(timer); reject(failure); } };
    try { ts.reset(widget); ts.execute(container); } catch { settle('reject', failure); }
  });
}
