import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './index.mjs';

const ORIGIN = 'https://ottotheautonomous.github.io';
const valid = {
  name: 'Jane Example',
  email: 'jane@example.com',
  message: 'I would love to discuss a thoughtful new website.\nThank you.',
  website: '',
  requestId: '21f5d5dc-0896-4c55-9b85-fd756e532ea2',
};

function request(payload = valid, options = {}) {
  return new Request(options.url || 'https://contact.twentynineeleven.net/api/contact', {
    method: options.method || 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.10',
      ...options.headers,
    },
    ...(options.method && options.method !== 'POST' ? {} : {
      body: options.body === undefined ? JSON.stringify(payload) : options.body,
    }),
  });
}

function environment({ send, limit, ...overrides } = {}) {
  const sent = [];
  const keys = [];
  const env = {
    EMAIL: { send: send || (async (mail) => { sent.push(mail); return { messageId: 'accepted-id' }; }) },
    RATE_LIMITER: { limit: limit || (async ({ key }) => { keys.push(key); return { success: true }; }) },
    ...overrides,
  };
  return { env, sent, keys };
}

test('valid enquiry is delivered to the fixed contact inbox with visitor Reply-To', async () => {
  const { env, sent, keys } = environment();
  const res = await worker.fetch(request({ ...valid, to: 'attacker@example.com', from: 'spoof@example.com' }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'contact@twentynineeleven.net');
  assert.equal(sent[0].from.email, 'enquiry@twentynineeleven.net');
  assert.deepEqual(sent[0].replyTo, { email: valid.email, name: valid.name });
  assert.ok(sent[0].text.includes(valid.message));
  assert.ok(sent[0].text.includes(valid.requestId));
  assert.equal(sent[0].html, undefined);
  assert.deepEqual(keys, ['contact:192.0.2.10']);
});

test('success waits for the email binding to accept delivery', async () => {
  let accept;
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const { env } = environment({ send: () => { entered(); return new Promise((resolve) => { accept = resolve; }); } });
  let resolved = false;
  const result = worker.fetch(request(), env).then((res) => { resolved = true; return res; });
  await started;
  await Promise.resolve();
  assert.equal(resolved, false);
  accept({ messageId: 'real-acceptance' });
  assert.deepEqual(await (await result).json(), { ok: true });
});

test('email rejection never claims success or discloses provider diagnostics', async () => {
  const { env } = environment({ send: async () => { throw new Error('SECRET INTERNAL MAIL ERROR'); } });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.equal(body.includes('SECRET'), false);
  assert.equal(body.includes('ok'), false);
});

test('a missing acceptance ID does not produce a delivery confirmation', async () => {
  const { env } = environment({ send: async () => undefined });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).ok, undefined);
});

test('missing email or rate-limit bindings fail closed', async () => {
  for (const overrides of [{ EMAIL: undefined }, { RATE_LIMITER: undefined }]) {
    const { env, sent } = environment(overrides);
    const res = await worker.fetch(request(), env);
    assert.equal(res.status, 503);
    assert.equal(sent.length, 0);
  }
});

test('rate-limit rejection prevents delivery and supplies a retry interval', async () => {
  const { env, sent } = environment({ limit: async () => ({ success: false }) });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(sent.length, 0);
});

test('rate-limit binding outages fail closed', async () => {
  const { env, sent } = environment({ limit: async () => { throw new Error('unavailable'); } });
  const res = await worker.fetch(request(), env);
  assert.equal(res.status, 503);
  assert.equal(sent.length, 0);
});

test('untrusted, lookalike and missing origins cannot invoke email delivery', async () => {
  for (const origin of ['https://evil.example', 'https://ottotheautonomous.github.io.evil.example', 'null', '']) {
    const { env, sent, keys } = environment();
    const res = await worker.fetch(request(valid, { headers: { Origin: origin } }), env);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
    assert.equal(sent.length, 0);
    assert.equal(keys.length, 0);
  }
});

test('both production site origins are allowed', async () => {
  for (const origin of ['https://twentynineeleven.net', 'https://www.twentynineeleven.net']) {
    const { env } = environment();
    const res = await worker.fetch(request(valid, { headers: { Origin: origin } }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), origin);
  }
});

test('explicit deployment origins replace the defaults', async () => {
  const { env, sent } = environment({ ALLOWED_ORIGINS: ' https://MichaelJamesHofer.github.io ' });
  assert.equal((await worker.fetch(request(), env)).status, 403);
  assert.equal((await worker.fetch(request(valid, { headers: { Origin: 'https://MichaelJamesHofer.github.io' } }), env)).status, 200);
  assert.equal(sent.length, 1);
});

test('valid CORS preflight succeeds without invoking delivery or the rate limiter', async () => {
  const { env, sent, keys } = environment();
  const res = await worker.fetch(request(null, {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(sent.length, 0);
  assert.equal(keys.length, 0);
});

test('preflight for other methods or headers is rejected', async () => {
  for (const headers of [
    { 'Access-Control-Request-Method': 'DELETE' },
    { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' },
  ]) {
    const { env, sent } = environment();
    const res = await worker.fetch(request(null, { method: 'OPTIONS', headers }), env);
    assert.equal(res.status, 403);
    assert.equal(sent.length, 0);
  }
});

test('wrong path, wrong method and non-JSON content cannot send an enquiry', async () => {
  for (const [options, status] of [
    [{ url: 'https://contact.twentynineeleven.net/' }, 404],
    [{ method: 'GET' }, 405],
    [{ headers: { 'Content-Type': 'text/plain' } }, 415],
  ]) {
    const { env, sent } = environment();
    assert.equal((await worker.fetch(request(valid, options), env)).status, status);
    assert.equal(sent.length, 0);
  }
});

test('oversized advertised bodies are rejected before invoking bindings', async () => {
  const { env, sent, keys } = environment();
  const res = await worker.fetch(request(valid, { headers: { 'Content-Length': '16385' } }), env);
  assert.equal(res.status, 413);
  assert.equal(sent.length, 0);
  assert.equal(keys.length, 0);
});

test('streamed oversized bodies are capped even without Content-Length', async () => {
  const { env, sent } = environment();
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
  assert.equal(sent.length, 0);
});

test('malformed JSON and invalid UTF-8 are rejected safely', async () => {
  for (const body of ['{"name":', new Uint8Array([0xff, 0xfe])]) {
    const { env, sent } = environment();
    assert.equal((await worker.fetch(request(null, { body }), env)).status, 400);
    assert.equal(sent.length, 0);
  }
});

test('invalid contact details, header injection, honeypots and missing references prevent sending', async () => {
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
    const { env, sent } = environment();
    assert.equal((await worker.fetch(request(payload), env)).status, 400);
    assert.equal(sent.length, 0);
  }
});

test('Unicode and HTML-like message text stay plain text and surrounding whitespace is trimmed', async () => {
  const { env, sent } = environment();
  const res = await worker.fetch(request({ ...valid, name: '  Renée Example  ', message: '  <script>alert(1)</script> — café\n第二行  ' }), env);
  assert.equal(res.status, 200);
  assert.equal(sent[0].replyTo.name, 'Renée Example');
  assert.ok(sent[0].text.includes('<script>alert(1)</script> — café\n第二行'));
  assert.equal(sent[0].html, undefined);
});
