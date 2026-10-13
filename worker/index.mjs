const MAX_BODY_BYTES = 16_384;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 5_000;
const DEFAULT_ORIGINS = [
  'https://ottotheautonomous.github.io',
  'https://michaeljameshofer.github.io',
  'https://twentynineeleven.net',
  'https://www.twentynineeleven.net',
];

// Names are stored and shown to the owner: no controls (C0/C1 incl. NEL), no format/bidi/zero-width characters (except the
// joiners U+200C/U+200D that Persian, Indic and emoji names need), no line/paragraph separators and no address specials, so a
// name can neither pose as an address nor hide, reorder or forge text. The database function re-checks a subset of this rule.
const BAD_NAME = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}"<>\\]/u;
// A plain addr-spec only (no quoted local parts, comments, commas or multiple addresses).
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/;

// Enquiries are stored in the owner's private Supabase database through one server-only database function,
// public.submit_enquiry (supabase/migrations/20261013120000_contact_intake.sql). The URL and the secret key exist only as
// Cloudflare Worker secrets; the key is sent to nothing but this project's own Data API.
const SUPABASE_URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;   // a project URL and nothing else
const SUPABASE_KEY_RE = /^sb_secret_[\x21-\x7e]{16,}$/;               // the current secret-key format; legacy JWT keys (eyJ...) are refused
const SUPABASE_UA = 'twentynineeleven-contact-worker/1';              // Supabase refuses secret keys sent with browser-like user agents
const SUPABASE_ATTEMPT_MS = 4_000;                                    // per request
const SUPABASE_BUDGET_MS = 12_000;                                    // from the start of the visitor's request: the page gives up at 15 s
const SUPABASE_RETRY_MIN_MS = 1_500;                                  // retry only if at least this much of the budget is left

function supabaseConfigured(env) {
  return SUPABASE_URL_RE.test(env.SUPABASE_URL ?? '') && SUPABASE_KEY_RE.test(env.SUPABASE_SECRET_KEY ?? '');
}

// One POST to one database function. Only the given body is sent: no header, cookie or address from the visitor's request.
async function rpc(env, fn, body, deadline) {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json', 'User-Agent': SUPABASE_UA },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1, Math.min(SUPABASE_ATTEMPT_MS, deadline - Date.now()))),
  });
  // The body is never read or logged: a PostgREST error can quote the row it refused.
  try { await res.body?.cancel(); } catch {}
  return res.status;
}

// Stores one validated enquiry: 'stored' (2xx: stored now, or already stored under this request id), 'busy' (429) or 'failed'.
// The database keeps the first enquiry per request id and ignores copies, so the one automatic retry after a timeout or a
// 5xx can never create a duplicate. 540 means the project is paused: retrying cannot help.
async function storeEnquiry(env, payload, source, startedAt) {
  const deadline = startedAt + SUPABASE_BUDGET_MS;
  const body = {
    p_request_id: payload.requestId.toLowerCase(),
    p_name: payload.name,
    p_email: payload.email,
    p_message: payload.message,
    p_source: source,
  };
  for (let attempt = 1; ; attempt++) {
    let status = 0;   // 0 = network error or timeout
    try { status = await rpc(env, 'submit_enquiry', body, deadline); } catch {}
    if (status >= 200 && status < 300) return 'stored';
    console.error(`contact: supabase submit_enquiry status ${status}`);   // the status only: never a body, key or enquiry field
    if (status === 429) return 'busy';
    const transient = status === 0 || (status >= 500 && status !== 540);
    if (!transient || attempt >= 2 || deadline - Date.now() < SUPABASE_RETRY_MIN_MS) return 'failed';
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 300));
  }
}

// The host of the allow-listed page the enquiry came from (e.g. www.twentynineeleven.net), or null if it is not a plain host.
function sourceHost(origin) {
  try {
    const host = new URL(origin).hostname;
    return /^[a-z0-9.-]{1,100}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

// One rate-limit bucket per IPv4 address and per IPv6 /64 (a single host can rotate through its whole /64).
export function ipKey(ip) {
  if (!ip) return 'contact:unknown';
  if (!ip.includes(':')) return `contact:${ip}`;
  const mapped = ip.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);   // ::ffff:1.2.3.4 and 64:ff9b::1.2.3.4 are one IPv4 host each
  if (mapped) return `contact:${mapped[1]}`;
  const [h, t = ''] = ip.toLowerCase().split('::');
  const head = h.split(':').filter(Boolean), tail = t.split(':').filter(Boolean);
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return `contact:${full.slice(0, 4).map((x) => x.padStart(4, '0')).join(':')}::/64`;
}

function allowedOrigins(env) {
  // Optional comma-separated deployment setting; never accept an origin from the request body.
  return new Set(
    (env.ALLOWED_ORIGINS || DEFAULT_ORIGINS.join(','))
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function response(status, data, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...extraHeaders,
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(data === null ? null : JSON.stringify(data), { status, headers });
}

async function readJson(request) {
  const advertisedLength = request.headers.get('content-length');
  if (advertisedLength && Number(advertisedLength) > MAX_BODY_BYTES) {
    throw new RangeError('Body too large');
  }
  if (!request.body) throw new SyntaxError('Body missing');

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function validate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  // The hidden field is hp_ref (a neutral name password managers do not autofill); "website" is still read from older pages.
  const { name, email, message, hp_ref: trap = payload.website ?? '', requestId, turnstile = '' } = payload;
  if ([name, email, message, trap, requestId, turnstile].some((value) => typeof value !== 'string')) {
    return null;
  }
  // A populated hidden field is rejected without storing anything or claiming delivery.
  if (trap.trim() || turnstile.length > 2048) return null;

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const cleanMessage = message.trim();
  if (
    !cleanName || cleanName.length > MAX_NAME_LENGTH || BAD_NAME.test(cleanName) ||
    !cleanEmail || cleanEmail.length > MAX_EMAIL_LENGTH || !EMAIL.test(cleanEmail) ||
    cleanMessage.length < 10 || cleanMessage.length > MAX_MESSAGE_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleanMessage) ||
    // A lone surrogate (possible through a JSON \ud800 escape) is not text the database can store.
    !cleanName.isWellFormed() || !cleanEmail.isWellFormed() || !cleanMessage.isWellFormed() ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    return null;
  }
  return { name: cleanName, email: cleanEmail, message: cleanMessage, requestId, turnstile };
}

// Cloudflare Turnstile, enforced whenever TURNSTILE_SECRET is configured (wrangler secret put TURNSTILE_SECRET). The token is
// single-use and verified server-side; the action must be "contact" and, if TURNSTILE_HOSTNAMES is set, the hostname must match.
// No idempotency_key: the Worker never retries, and a key the browser chose would let one solved token be replayed.
async function verifyTurnstile(env, token, ip) {
  if (!token) return false;
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || undefined }),
    signal: AbortSignal.timeout(8000),
  }).then((r) => r.json());
  if (result?.success !== true) return false;
  if (result.action !== 'contact') return false;
  const hosts = (env.TURNSTILE_HOSTNAMES || '').split(',').map((h) => h.trim()).filter(Boolean);
  return !hosts.length || hosts.includes(result.hostname);
}

export default {
  async fetch(request, env) {
    const startedAt = Date.now();
    if (new URL(request.url).pathname !== '/api/contact') {
      return response(404, { error: 'Not found.' }, null);
    }

    const origin = request.headers.get('origin');
    if (!origin || !allowedOrigins(env).has(origin)) {
      return response(403, { error: 'This request is not allowed.' }, null);
    }

    if (request.method === 'OPTIONS') {
      const requestedMethod = request.headers.get('access-control-request-method');
      const requestedHeaders = (request.headers.get('access-control-request-headers') || '')
        .toLowerCase().split(',').map((header) => header.trim()).filter(Boolean);
      if (requestedMethod !== 'POST' || requestedHeaders.some((header) => header !== 'content-type')) {
        return response(403, { error: 'This request is not allowed.' }, origin);
      }
      return response(204, null, origin, {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }

    if (request.method !== 'POST') {
      return response(405, { error: 'Please submit the contact form.' }, origin, {
        Allow: 'POST, OPTIONS',
      });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
      return response(415, { error: 'Please submit the contact form.' }, origin);
    }
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
      return response(413, { error: 'Your message is too long.' }, origin);
    }
    if (!supabaseConfigured(env) || typeof env.RATE_LIMITER?.limit !== 'function') {
      return response(503, { error: 'Contact delivery is temporarily unavailable. Please try again later.' }, origin);
    }

    // Cloudflare supplies CF-Connecting-IP at the edge. Missing values share a conservative bucket.
    // This binding is shared across Worker isolates, unlike an in-memory JavaScript counter.
    try {
      const result = await env.RATE_LIMITER.limit({ key: ipKey(request.headers.get('cf-connecting-ip')) });
      if (result?.success !== true) {
        return response(429, { error: 'Please wait a minute before trying again.' }, origin, {
          'Retry-After': '60',
        });
      }
    } catch {
      return response(503, { error: 'Contact delivery is temporarily unavailable. Please try again later.' }, origin);
    }

    let payload;
    try {
      payload = validate(await readJson(request));
    } catch (error) {
      return response(error instanceof RangeError ? 413 : 400, {
        error: error instanceof RangeError ? 'Your message is too long.' : 'Please check your contact details and message.',
      }, origin);
    }
    if (!payload) {
      return response(400, { error: 'Please check your contact details and message.' }, origin);
    }
    if (env.TURNSTILE_SECRET) {
      let human = false;
      try {
        human = await verifyTurnstile(env, payload.turnstile, request.headers.get('cf-connecting-ip'));
      } catch {
        return response(503, { error: 'Contact delivery is temporarily unavailable. Please try again later.' }, origin);
      }
      if (!human) {
        return response(403, { error: 'We could not verify this browser. Please try again. Your message is still here.' }, origin);
      }
    }

    // A shared cap for each Cloudflare location (the binding counts per location), spent only by enquiries that passed
    // validation and the bot check, so junk requests cannot use it up and lock real visitors out.
    if (env.GLOBAL_LIMITER) {
      let all;
      try { all = await env.GLOBAL_LIMITER.limit({ key: 'contact:all' }); } catch { all = null; }
      if (all?.success !== true) {
        return response(503, { error: 'Contact delivery is temporarily unavailable. Please try again later.' }, origin, { 'Retry-After': '60' });
      }
    }

    const outcome = await storeEnquiry(env, payload, sourceHost(origin), startedAt);
    // A 2xx from Supabase means the enquiry is stored (or was already stored under this request id).
    // The Worker never logs, returns or forwards enquiry contents; the only log line is the database call's status code.
    if (outcome === 'stored') return response(200, { ok: true }, origin);
    if (outcome === 'busy') {
      return response(503, { error: 'Contact delivery is temporarily unavailable. Please try again later.' }, origin, { 'Retry-After': '60' });
    }
    return response(503, { error: 'Your message could not be sent. Please try again later.' }, origin);
  },

  // Cron Trigger (wrangler.jsonc): stamps one non-personal row, so the Free project sees database activity and is not paused.
  // A failure throws, so the run shows as failed under the Worker's Cron Triggers in the Cloudflare dashboard.
  async scheduled(controller, env) {
    if (!supabaseConfigured(env)) throw new Error('contact: Supabase is not configured');
    let status = 0;
    try { status = await rpc(env, 'contact_keepalive', {}, Date.now() + SUPABASE_ATTEMPT_MS); } catch {}
    if (status < 200 || status >= 300) throw new Error(`contact: keepalive status ${status}`);
  },
};
