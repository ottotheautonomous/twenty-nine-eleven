import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import worker from './index.mjs';

const ORIGIN = 'https://ottotheautonomous.github.io';
const SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const TEST_KEY = 'sb_secret_TEST.ONLY.not.a.real.key.0000';    // placeholder (dots: no real key looks like this); the real key exists only as a Cloudflare secret
const RPC = `${SUPABASE_URL}/rest/v1/rpc/submit_enquiry`;
const KEEPALIVE = `${SUPABASE_URL}/rest/v1/rpc/contact_keepalive`;
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const LEAK = 'Failing row contains SECRETROW';                 // what a PostgREST error body could quote
const valid = {
  name: 'Jane Example',
  email: 'jane@example.com',
  message: 'I would love to discuss a thoughtful new website.\nThank you.',
  website: '',
  requestId: '21f5d5dc-0896-4c55-9b85-fd756e532ea2',
};

// Every test runs with console output captured and with fetch restored afterwards. Whatever a test did, no console line may
// contain the key, a database body or any field of the enquiry.
const realFetch = globalThis.fetch;
const realConsole = { ...console };
let logged = [];
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = (...args) => { logged.push(args.map(String).join(' ')); };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(console, realConsole);
  for (const line of logged) {
    for (const secret of [TEST_KEY, 'SECRETROW', valid.name, valid.email, 'thoughtful new website', valid.requestId]) {
      assert.equal(line.includes(secret), false, `console output leaked ${secret}: ${line}`);
    }
  }
});

function request(payload = valid, options = {}) {
  return new Request(options.url || 'https://contact.twentynineeleven.net/api/contact', {
    method: options.method || 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.10',
      Cookie: 'visitor=1',
      ...options.headers,
    },
    ...(options.method && options.method !== 'POST' ? {} : {
      body: options.body === undefined ? JSON.stringify(payload) : options.body,
    }),
  });
}

// The Worker's only outbound requests are the Supabase RPC and Turnstile's siteverify; anything else throws, so no test can
// reach the network. `supabase` scripts the RPC answers in order (the last one repeats): a status code, an Error to throw, a
// Response, or a function of the call. `stored` holds the RPC bodies the stub accepted with a 2xx.
function environment({ limit, supabase = [204], turnstile, ...overrides } = {}) {
  const stored = [];
  const keys = [];
  const calls = [];
  const verifications = [];
  const script = [...supabase];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === TURNSTILE) {
      verifications.push(JSON.parse(init.body));
      if (turnstile instanceof Error) throw turnstile;
      return new Response(JSON.stringify(turnstile ?? { success: false }));
    }
    if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/`)) {
      const call = { url, init, body: JSON.parse(init.body) };
      calls.push(call);
      const step = script.length > 1 ? script.shift() : script[0];
      const answer = typeof step === 'function' ? await step(call) : step;
      if (answer instanceof Error) throw answer;
      const res = answer instanceof Response ? answer
        : new Response(answer === 204 ? null : JSON.stringify({ code: '23514', details: LEAK }), { status: answer });
      if (res.status >= 200 && res.status < 300 && url === RPC) stored.push(call.body);
      return res;
    }
    throw new Error(`unexpected outbound request to ${url}`);
  };
  const env = {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY: TEST_KEY,
    RATE_LIMITER: { limit: limit || (async ({ key }) => { keys.push(key); return { success: true }; }) },
    ...overrides,
  };
  return { env, stored, keys, calls, verifications };
}

// Runs fn with AbortSignal.timeout recording the requested milliseconds and firing after 5 ms instead (on a ref'd timer: Node's
// own timeout timer is unref'd and would let the test runner see an idle event loop), and with a clock the test can move forward.
async function withTimers(fn) {
  const realTimeout = AbortSignal.timeout;
  const realNow = Date.now;
  const requested = [];
  const clock = { skew: 0 };
  AbortSignal.timeout = (ms) => {
    requested.push(ms);
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), 5);
    return controller.signal;
  };
  Date.now = () => realNow() + clock.skew;
  try { return await fn({ requested, clock }); } finally { AbortSignal.timeout = realTimeout; Date.now = realNow; }
}

const hangs = (call) => new Promise((_, reject) => call.init.signal.addEventListener('abort', () => reject(call.init.signal.reason)));

test('valid enquiry is stored through the one database function with only the validated fields', async () => {
  const { env, stored, keys } = environment();
  const res = await worker.fetch(request({ ...valid, to: 'attacker@example.com', from: 'spoof@example.com', p_source: 'x' }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(stored, [{
    p_request_id: valid.requestId,
    p_name: valid.name,
    p_email: valid.email,
    p_message: valid.message,
    p_source: 'ottotheautonomous.github.io',
  }]);
  assert.deepEqual(keys, ['contact:192.0.2.10']);
});

test('success waits for the database to confirm the enquiry is stored', async () => {
  let accept;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const { env } = environment({ supabase: [() => { entered(); return new Promise((resolve) => { accept = resolve; }); }] });
  let resolved = false;
  const result = worker.fetch(request(), env).then((res) => { resolved = true; return res; });
  await started;
  await Promise.resolve();
  assert.equal(resolved, false);
  accept(204);
  assert.deepEqual(await (await result).json(), { ok: true });
});

test('database rejection never claims success or discloses database diagnostics', async () => {
  const { env, calls } = environment({ supabase: [400] });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.equal(body.includes('SECRET'), false);
  assert.equal(body.includes('ok'), false);
  assert.equal(calls.length, 1);
});

test('a redirect from the database URL is not followed and does not count as stored', async () => {
  const { env, calls, stored } = environment({ supabase: [new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } })] });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(stored.length, 0);
});

test('missing database configuration or rate-limit binding fail closed before the rate limiter', async () => {
  for (const overrides of [
    { SUPABASE_URL: undefined },
    { SUPABASE_URL: '' },
    { SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' },
    { SUPABASE_URL: 'https://evil.example' },
    { SUPABASE_URL: 'https://abcdefghijklmnopqrs.supabase.co' },
    { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co.evil.example' },
    { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co/rest/v1' },
    { SUPABASE_URL: ' https://abcdefghijklmnopqrst.supabase.co' },
    { SUPABASE_SECRET_KEY: undefined },
    { SUPABASE_SECRET_KEY: '' },
    { SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiJ9.TEST.ONLY.not.a.real.legacy.key' },
    { SUPABASE_SECRET_KEY: 'sb_publishable_TEST.ONLY.not.a.real.key.00' },
    { SUPABASE_SECRET_KEY: 'sb_secret_short' },
    { SUPABASE_SECRET_KEY: 'sb_secret_test only not a real key 0000' },
    { RATE_LIMITER: undefined },
  ]) {
    const { env, calls, keys } = environment(overrides);
    const res = await worker.fetch(request(), env);
    assert.equal(res.status, 503, JSON.stringify(overrides));
    assert.equal((await res.json()).error, 'Contact delivery is temporarily unavailable. Please try again later.');
    assert.equal(calls.length, 0);
    assert.equal(keys.length, 0);
  }
  // A trailing slash on the project URL is tolerated and never doubled.
  const { env, calls } = environment({ SUPABASE_URL: `${SUPABASE_URL}/` });
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(calls[0].url, RPC);
});

test('rate-limit rejection prevents storage and supplies a retry interval', async () => {
  const { env, calls } = environment({ limit: async () => ({ success: false }) });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(calls.length, 0);
});

test('rate-limit binding outages fail closed', async () => {
  const { env, calls } = environment({ limit: async () => { throw new Error('unavailable'); } });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  assert.equal(calls.length, 0);
});

test('untrusted, lookalike and missing origins cannot reach the database', async () => {
  for (const origin of ['https://evil.example', 'https://ottotheautonomous.github.io.evil.example', 'null', '']) {
    const { env, calls, keys } = environment();
    const res = await worker.fetch(request(valid, { headers: { Origin: origin } }), env);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(calls.length, 0);
    assert.equal(keys.length, 0);
  }
});

test('both production site origins are allowed and recorded as the source host', async () => {
  for (const [origin, host] of [['https://twentynineeleven.net', 'twentynineeleven.net'], ['https://www.twentynineeleven.net', 'www.twentynineeleven.net']]) {
    const { env, stored } = environment();
    const res = await worker.fetch(request(valid, { headers: { Origin: origin } }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
    assert.equal(stored[0].p_source, host);
  }
});

test('explicit deployment origins replace the defaults; a source that is not a plain host is stored as null', async () => {
  const { env, stored } = environment({ ALLOWED_ORIGINS: ' https://MichaelJamesHofer.github.io , http://127.0.0.1:5173 ' });
  assert.equal((await worker.fetch(request(), env)).status, 403);
  assert.equal((await worker.fetch(request(valid, { headers: { Origin: 'https://MichaelJamesHofer.github.io' } }), env)).status, 200);
  assert.equal((await worker.fetch(request(valid, { headers: { Origin: 'http://127.0.0.1:5173' } }), env)).status, 200);
  assert.deepEqual(stored.map((row) => row.p_source), ['michaeljameshofer.github.io', '127.0.0.1']);
  const odd = environment({ ALLOWED_ORIGINS: 'http://[::1]:5173,not a url' });
  assert.equal((await worker.fetch(request(valid, { headers: { Origin: 'http://[::1]:5173' } }), odd.env)).status, 200);
  assert.equal((await worker.fetch(request(valid, { headers: { Origin: 'not a url' } }), odd.env)).status, 200);
  assert.deepEqual(odd.stored.map((row) => row.p_source), [null, null]);
});

test('valid CORS preflight succeeds without touching the database or the rate limiter', async () => {
  const { env, calls, keys } = environment();
  const res = await worker.fetch(request(null, {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(calls.length, 0);
  assert.equal(keys.length, 0);
});

test('preflight for other methods or headers is rejected', async () => {
  for (const headers of [
    { 'Access-Control-Request-Method': 'DELETE' },
    { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' },
  ]) {
    const { env, calls } = environment();
    const res = await worker.fetch(request(null, { method: 'OPTIONS', headers }), env);
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  }
});

test('wrong path, wrong method and non-JSON content cannot store an enquiry', async () => {
  for (const [options, status] of [
    [{ url: 'https://contact.twentynineeleven.net/' }, 404],
    [{ method: 'GET' }, 405],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
  ]) {
    const { env, calls } = environment();
    assert.equal((await worker.fetch(request(valid, options), env)).status, status);
    assert.equal(calls.length, 0);
  }
});

test('oversized advertised bodies are rejected before invoking bindings', async () => {
  const { env, calls, keys } = environment();
  const res = await worker.fetch(request(valid, { headers: { 'Content-Length': '16385' } }), env);
  assert.equal(res.status, 413);
  assert.equal(calls.length, 0);
  assert.equal(keys.length, 0);
});

test('streamed oversized bodies are capped even without Content-Length', async () => {
  const { env, calls } = environment();
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10_000));
      controller.enqueue(new Uint8Array(10_000));
    },
    cancel() { cancelled = true; },
  });
  const req = new Request('https://contact.twentynineeleven.net/api/contact', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 413);
  assert.equal(cancelled, true);
  assert.equal(calls.length, 0);
});

test('malformed JSON and invalid UTF-8 are rejected safely', async () => {
  for (const body of ['{"name":', new Uint8Array([0xff, 0xfe])]) {
    const { env, calls } = environment();
    assert.equal((await worker.fetch(request(null, { body }), env)).status, 400);
    assert.equal(calls.length, 0);
  }
});

test('invalid contact details, header injection, honeypots and missing references are never stored', async () => {
  const invalid = [
    null,
    [],
    { ...valid, name: '' },
    { ...valid, name: 'x'.repeat(121) },
    { ...valid, name: 'Jane\r\nBcc: attacker@example.com' },
    { ...valid, email: 'not-an-email' },
    { ...valid, email: 'jane@example.com\r\nBcc: attacker@example.com' },
    { ...valid, email: 'x'.repeat(250) + '@example.com' },
    { ...valid, message: ' ' },
    { ...valid, message: 'x'.repeat(5_001) },
    { ...valid, message: 'contains\u0000null' },
    { ...valid, website: 'https://spam.example' },
    { ...valid, website: 1 },
    { ...valid, requestId: undefined },
    { ...valid, requestId: 'not-a-uuid' },
  ];
  for (const payload of invalid) {
    const { env, calls } = environment();
    assert.equal((await worker.fetch(request(payload), env)).status, 400);
    assert.equal(calls.length, 0);
  }
});

test('lone surrogates in name, email or message are refused as invalid input, without a database call', async () => {
  for (const payload of [
    { ...valid, name: 'Jane \ud800 Example' },
    { ...valid, email: 'jane\udfff@example.com' },
    { ...valid, message: 'A message with a broken \udc00 character in it.' },
  ]) {
    const { env, calls } = environment();
    const res = await worker.fetch(request(payload), env);
    assert.equal(res.status, 400);
    assert.equal(calls.length, 0);
  }
  // Properly paired surrogates (emoji) are fine.
  const { env, stored } = environment();
  assert.equal((await worker.fetch(request({ ...valid, name: 'Sam 😀', message: '😀😀😀😀😀' }), env)).status, 200);
  assert.equal(stored[0].p_message, '😀😀😀😀😀');
});

test('Unicode and HTML-like message text stay plain text and surrounding whitespace is trimmed', async () => {
  const { env, stored } = environment();
  const res = await worker.fetch(request({ ...valid, name: '  Renée Example  ', message: '  <script>alert(1)</script> — café\n第二行  ' }), env);
  assert.equal(res.status, 200);
  assert.equal(stored[0].p_name, 'Renée Example');
  assert.equal(stored[0].p_message, '<script>alert(1)</script> — café\n第二行');
});

test('IPv6 visitors share one rate-limit bucket per /64; IPv4 keys are unchanged', async () => {
  const { ipKey } = await import('./index.mjs');
  assert.equal(ipKey('192.0.2.10'), 'contact:192.0.2.10');
  assert.equal(ipKey('2001:db8::1'), ipKey('2001:db8::2'));
  assert.equal(ipKey('2001:db8::1'), ipKey('2001:db8:0:0:ffff::9'));
  assert.notEqual(ipKey('2001:db8::1'), ipKey('2001:db8:1::1'));
  assert.equal(ipKey(null), 'contact:unknown');
  assert.equal(ipKey('::ffff:192.0.2.10'), 'contact:192.0.2.10');
  assert.notEqual(ipKey('::ffff:192.0.2.10'), ipKey('::ffff:198.51.100.7'));
  assert.equal(ipKey('64:ff9b::198.51.100.7'), 'contact:198.51.100.7');
});

test('a global cap refuses storage when every visitor together exceeds it', async () => {
  const { env, calls } = environment({ GLOBAL_LIMITER: { limit: async () => ({ success: false }) } });
  const result = await worker.fetch(request(), env);
  assert.equal(result.status, 503);
  assert.equal(calls.length, 0);
});

test('junk and unverified requests do not spend the global cap, so they cannot lock real visitors out', async () => {
  let spent = 0;
  const GLOBAL_LIMITER = { limit: async () => ({ success: ++spent <= 1 }) };
  for (const body of [{}, { ...valid, email: 'nope' }, { ...valid, hp_ref: 'x' }]) {
    const { env, calls } = environment({ GLOBAL_LIMITER });
    assert.equal((await worker.fetch(request(body), env)).status, 400);
    assert.equal(calls.length, 0);
  }
  { const { env, calls } = environment({ GLOBAL_LIMITER, TURNSTILE_SECRET: 'secret' }); assert.equal((await worker.fetch(request(), env)).status, 403); assert.equal(calls.length, 0); }
  assert.equal(spent, 0);
  const { env, stored } = environment({ GLOBAL_LIMITER });
  assert.equal((await worker.fetch(request(), env)).status, 200);
  assert.equal(stored.length, 1);
});

test('names that could pose as an address or hide text, and non-plain emails, are rejected', async () => {
  const badNames = ['Bank Support" <security@bank.example>, x', 'ceo<at>example', 'Jane\u2028Email: forged@example.com', 'Jane\u0085x', 'Jane\u202eevil', 'Back\\slash'];
  const badEmails = ['a,b@evil.example', '"x"(c)@evil.example', 'x@evil.example,victim.example', 'x@evil', 'x y@evil.example'];
  for (const name of badNames) {
    const { env, calls } = environment();
    assert.equal((await worker.fetch(request({ ...valid, name }), env)).status, 400, name);
    assert.equal(calls.length, 0);
  }
  for (const email of badEmails) {
    const { env, calls } = environment();
    assert.equal((await worker.fetch(request({ ...valid, email }), env)).status, 400, email);
    assert.equal(calls.length, 0);
  }
  for (const name of ["Siobhán O'Brien-Ng", 'Zoë', 'José Martínez', '张伟', 'علی\u200cرضا', 'ශ්\u200dරී', 'Sam 👨\u200d👩\u200d👧', 'Smith, John']) {
    const { env, stored } = environment();
    assert.equal((await worker.fetch(request({ ...valid, name }), env)).status, 200, name);
    assert.equal(stored[0].p_name, name);
  }
  for (const email of ['ivan@xn--e1afmkfd.xn--p1ai', 'li@example.xn--fiqs8s', 'a+tag@mail.example.co.uk']) {
    const { env, stored } = environment();
    assert.equal((await worker.fetch(request({ ...valid, email }), env)).status, 200, email);
    assert.equal(stored.length, 1);
  }
  for (const name of ['Jane\u202eevil', 'Jane\u200eX', 'Jane\ufeffX', 'Jane\u2028X', 'Jane\u{e0041}X']) {
    const { env, calls } = environment();
    assert.equal((await worker.fetch(request({ ...valid, name }), env)).status, 400, JSON.stringify(name));
    assert.equal(calls.length, 0);
  }
});

test('the renamed honeypot (hp_ref) is rejected when filled, and older pages sending website still work', async () => {
  {
    const { env, calls } = environment();
    const { website, ...rest } = valid;
    assert.equal((await worker.fetch(request({ ...rest, hp_ref: 'https://spam.example' }), env)).status, 400);
    assert.equal(calls.length, 0);
  }
  {
    const { env, stored } = environment();
    const { website, ...rest } = valid;
    assert.equal((await worker.fetch(request({ ...rest, hp_ref: '' }), env)).status, 200);
    assert.equal(stored.length, 1);
  }
});

test('Turnstile: enforced only when the secret is configured; verified server-side with action and hostname', async () => {
  const withSecret = { TURNSTILE_SECRET: 'secret' };
  const allowHost = { TURNSTILE_SECRET: 'secret', TURNSTILE_HOSTNAMES: 'ottotheautonomous.github.io' };
  // no secret: no verification, stored
  { const { env, stored, verifications } = environment({ turnstile: { success: true } }); assert.equal((await worker.fetch(request(), env)).status, 200); assert.equal(stored.length, 1); assert.equal(verifications.length, 0); }
  // secret, missing token: refused without calling Cloudflare
  { const { env, calls, verifications } = environment(withSecret); assert.equal((await worker.fetch(request(), env)).status, 403); assert.equal(calls.length, 0); assert.equal(verifications.length, 0); }
  // secret, Cloudflare says no
  { const { env, calls } = environment({ ...withSecret, turnstile: { success: false, 'error-codes': ['invalid-input-response'] } }); assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, 403); assert.equal(calls.length, 0); }
  // secret, wrong action
  { const { env, calls } = environment({ ...withSecret, turnstile: { success: true, action: 'login', hostname: 'ottotheautonomous.github.io' } }); assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, 403); assert.equal(calls.length, 0); }
  // secret, Cloudflare reports no action: refused (the action must be exactly "contact")
  { const { env, calls } = environment({ ...withSecret, turnstile: { success: true, hostname: 'ottotheautonomous.github.io' } }); assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, 403); assert.equal(calls.length, 0); }
  // secret, hostname not allowed
  { const { env, calls } = environment({ ...allowHost, turnstile: { success: true, action: 'contact', hostname: 'evil.example' } }); assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, 403); assert.equal(calls.length, 0); }
  // secret, valid token: stored; secret and token sent to siteverify, no browser-chosen idempotency key (it would let a solved token be replayed)
  { const { env, stored, calls, verifications } = environment({ ...allowHost, turnstile: { success: true, action: 'contact', hostname: 'ottotheautonomous.github.io' } });
    assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, 200); assert.equal(stored.length, 1);
    assert.equal(verifications[0].secret, 'secret'); assert.equal(verifications[0].response, 'tok'); assert.equal(verifications[0].idempotency_key, undefined);
    assert.equal('turnstile' in calls[0].body, false); assert.equal(JSON.stringify(calls[0].body).includes('tok'), false); }
  // Cloudflare unreachable: 503, nothing stored
  { const { env, calls } = environment({ ...withSecret, turnstile: new TypeError('network') }); assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, 503); assert.equal(calls.length, 0); }
  // oversized token rejected as invalid input
  { const { env, calls } = environment(withSecret); assert.equal((await worker.fetch(request({ ...valid, turnstile: 'x'.repeat(2049) }), env)).status, 400); assert.equal(calls.length, 0); }
});

// ---- The Supabase call itself ----

test('the RPC request: one POST to the project URL, three fixed headers, nothing forwarded from the visitor', async () => {
  const { env, calls } = environment();
  const upper = '21F5D5DC-0896-4C55-9B85-FD756E532EA2';
  const res = await worker.fetch(request({ ...valid, requestId: upper }, { headers: { Authorization: 'Bearer visitor', 'X-Forwarded-For': '203.0.113.9' } }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  const { url, init, body } = calls[0];
  assert.equal(url, RPC);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'manual');
  assert.ok(init.signal instanceof AbortSignal);
  const headers = new Headers(init.headers);
  assert.deepEqual([...headers.keys()].sort(), ['apikey', 'content-type', 'user-agent']);
  assert.equal(headers.get('apikey'), TEST_KEY);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('user-agent'), 'twentynineeleven-contact-worker/1');
  assert.deepEqual(Object.keys(body).sort(), ['p_email', 'p_message', 'p_name', 'p_request_id', 'p_source']);
  assert.equal(body.p_request_id, upper.toLowerCase());
  assert.equal(body.p_source, 'ottotheautonomous.github.io');
  assert.equal(JSON.stringify(init).includes('192.0.2.10'), false);
});

test('any 2xx from the database means stored', async () => {
  for (const status of [204, 200, 201]) {
    const { env, calls } = environment({ supabase: [status] });
    const res = await worker.fetch(request(), env);
    assert.equal(res.status, 200, String(status));
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(calls.length, 1);
  }
});

test('definite failures (400, 401, 403, 404, 409, 540, 302) answer 503 after exactly one call, without Retry-After', async () => {
  for (const status of [400, 401, 403, 404, 409, 540, 302]) {
    const { env, calls, stored } = environment({ supabase: [status] });
    const res = await worker.fetch(request(), env);
    assert.equal(res.status, 503, String(status));
    assert.equal(res.headers.get('retry-after'), null);
    const body = await res.json();
    assert.deepEqual(body, { error: 'Your message could not be sent. Please try again later.' });
    assert.equal(calls.length, 1, String(status));
    assert.equal(stored.length, 0);
  }
  assert.ok(logged.includes('contact: supabase submit_enquiry status 540'));
});

test('a database 429 answers 503 with Retry-After and is not retried', async () => {
  const { env, calls } = environment({ supabase: [429] });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal((await res.json()).error, 'Contact delivery is temporarily unavailable. Please try again later.');
  assert.equal(calls.length, 1);
});

test('transient failures are retried once with the same request id, inside the time budget', async () => {
  for (const [script, status, count] of [
    [[500, 204], 200, 2],
    [[503, 204], 200, 2],
    [[502, 502], 503, 2],
    [[new TypeError('network'), 204], 200, 2],
    [[new TypeError('network'), new TypeError('network')], 503, 2],
  ]) {
    const { env, calls } = environment({ supabase: script });
    const res = await worker.fetch(request(), env);
    assert.equal(res.status, status, JSON.stringify(script.map(String)));
    assert.equal(calls.length, count);
    assert.equal(calls[1].body.p_request_id, calls[0].body.p_request_id);
    assert.equal(calls[1].init.body, calls[0].init.body);
  }
});

test('each attempt has its own timeout; a hanging database is abandoned, retried once, then answered with 503', async () => {
  await withTimers(async ({ requested }) => {
    const { env, calls } = environment({ supabase: [hangs] });
    const res = await worker.fetch(request(), env);
    assert.equal(res.status, 503);
    assert.equal(calls.length, 2);
    assert.equal(requested.length, 2);
    for (const ms of requested) assert.ok(ms >= 1 && ms <= 4_000, String(ms));
    assert.equal(requested[0], 4_000);
  });
  await withTimers(async () => {
    const { env, calls } = environment({ supabase: [hangs, 204] });
    assert.equal((await worker.fetch(request(), env)).status, 200);
    assert.equal(calls.length, 2);
  });
});

test('the retry respects the 12 s budget: no retry when little is left, and a shorter timeout when some is', async () => {
  await withTimers(async ({ clock, requested }) => {
    const { env, calls } = environment({ supabase: [() => { clock.skew += 11_000; return 500; }, 204] });
    assert.equal((await worker.fetch(request(), env)).status, 503);
    assert.equal(calls.length, 1);
    assert.deepEqual(requested, [4_000]);
  });
  await withTimers(async ({ clock, requested }) => {
    const { env, calls } = environment({ supabase: [() => { clock.skew += 9_000; return 500; }, 204] });
    assert.equal((await worker.fetch(request(), env)).status, 200);
    assert.equal(calls.length, 2);
    assert.equal(requested[0], 4_000);
    assert.ok(requested[1] > 0 && requested[1] <= 3_000, String(requested[1]));
  });
  // Time already spent on the bot check counts against the same budget (requested[0] is Turnstile's own 8 s timeout).
  for (const [spent, status, count] of [[9_000, 200, 2], [11_000, 503, 1]]) {
    await withTimers(async ({ clock, requested }) => {
      const { env, calls } = environment({
        TURNSTILE_SECRET: 'secret',
        turnstile: { success: true, action: 'contact', hostname: 'ottotheautonomous.github.io' },
        supabase: [500, 204],
      });
      const stub = globalThis.fetch;
      globalThis.fetch = async (url, init) => { if (String(url) === TURNSTILE) clock.skew += spent; return stub(url, init); };
      assert.equal((await worker.fetch(request({ ...valid, turnstile: 'tok' }), env)).status, status, String(spent));
      assert.equal(calls.length, count);
      assert.equal(requested[0], 8_000);
      assert.ok(requested[1] > 0 && requested[1] <= 12_000 - spent, String(requested[1]));
    });
  }
});

test('the database response body is cancelled unread and never reaches the visitor', async () => {
  for (const status of [400, 200]) {
    let cancelled = false;
    const leaky = () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify({ details: LEAK, key: TEST_KEY }))); },
      cancel() { cancelled = true; },
    }), { status, headers: { 'Content-Type': 'application/json' } });
    const { env } = environment({ supabase: [leaky] });
    const res = await worker.fetch(request(), env);
    const text = await res.text();
    assert.equal(res.status, status === 200 ? 200 : 503);
    assert.equal(cancelled, true, String(status));
    for (const secret of ['SECRETROW', TEST_KEY, valid.email]) assert.equal(text.includes(secret), false);
    for (const [, value] of res.headers) assert.equal(value.includes(TEST_KEY), false);
  }
});

test('failures log the status code only: never the key, the database body or the enquiry', async () => {
  const { env } = environment({ supabase: [500, 400] });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  assert.deepEqual(logged, ['contact: supabase submit_enquiry status 500', 'contact: supabase submit_enquiry status 400']);
  // (the afterEach hook also checks every console line of every test for the key, the body and the enquiry fields)
});

test('scheduled keep-alive: one POST of {} to contact_keepalive with the same three headers; failures throw', async () => {
  {
    const { env, calls } = environment({ supabase: [204] });
    await worker.scheduled({ cron: '17 3,11,19 * * *', scheduledTime: Date.now() }, env);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, KEEPALIVE);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.redirect, 'manual');
    assert.deepEqual(calls[0].body, {});
    const headers = new Headers(calls[0].init.headers);
    assert.deepEqual([...headers.keys()].sort(), ['apikey', 'content-type', 'user-agent']);
    assert.equal(headers.get('apikey'), TEST_KEY);
  }
  for (const [script, message] of [[[500], 'contact: keepalive status 500'], [[401], 'contact: keepalive status 401'], [[new TypeError(`fetch failed for ${KEEPALIVE}`)], 'contact: keepalive status 0']]) {
    const { env, calls } = environment({ supabase: script });
    await assert.rejects(worker.scheduled({}, env), (error) => error.message === message && !error.message.includes(TEST_KEY) && !error.message.includes('supabase.co'));
    assert.equal(calls.length, 1);
  }
  for (const overrides of [{ SUPABASE_URL: undefined }, { SUPABASE_SECRET_KEY: 'eyJ.legacy.jwt' }]) {
    const { env, calls } = environment(overrides);
    await assert.rejects(worker.scheduled({}, env), /not configured/);
    assert.equal(calls.length, 0);
  }
  await withTimers(async ({ requested }) => {
    const { env } = environment({ supabase: [hangs] });
    await assert.rejects(worker.scheduled({}, env), /keepalive status 0/);
    assert.equal(requested.length, 1);
    assert.ok(requested[0] > 3_900 && requested[0] <= 4_000, String(requested[0]));
  });
});
