const MAX_BODY_BYTES = 16_384;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 5_000;
const RECIPIENT = 'contact@twentynineeleven.net';
const SENDER = 'enquiry@twentynineeleven.net';
const DEFAULT_ORIGINS = [
  'https://ottotheautonomous.github.io',
  'https://michaeljameshofer.github.io',
  'https://twentynineeleven.net',
  'https://www.twentynineeleven.net',
];

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
  const { name, email, message, website = '', requestId } = payload;
  if ([name, email, message, website, requestId].some((value) => typeof value !== 'string')) {
    return null;
  }
  // A populated hidden field is rejected without sending mail or claiming delivery.
  if (website.trim()) return null;

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const cleanMessage = message.trim();
  if (
    !cleanName || cleanName.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(cleanName) ||
    !cleanEmail || cleanEmail.length > MAX_EMAIL_LENGTH ||
    !/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(cleanEmail) ||
    /[\u0000-\u001f\u007f]/.test(cleanEmail) ||
    cleanMessage.length < 10 || cleanMessage.length > MAX_MESSAGE_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleanMessage) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  ) {
    return null;
  }
  return { name: cleanName, email: cleanEmail, message: cleanMessage, requestId };
}

export default {
  async fetch(request, env) {
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
    if (typeof env.EMAIL?.send !== 'function' || typeof env.RATE_LIMITER?.limit !== 'function') {
      return response(503, { error: 'Contact delivery is temporarily unavailable. Please try again later.' }, origin);
    }

    // Cloudflare supplies CF-Connecting-IP at the edge. Missing values share a conservative bucket.
    // This binding is shared across Worker isolates, unlike an in-memory JavaScript counter.
    try {
      const result = await env.RATE_LIMITER.limit({
        key: `contact:${request.headers.get('cf-connecting-ip') || 'unknown'}`,
      });
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

    try {
      const sent = await env.EMAIL.send({
        to: RECIPIENT,
        from: { email: SENDER, name: 'twenty nine eleven' },
        replyTo: { email: payload.email, name: payload.name },
        subject: 'A new enquiry for twenty nine eleven',
        text: [
          `Name: ${payload.name}`,
          `Email: ${payload.email}`,
          '',
          payload.message,
          '',
          `Submission reference: ${payload.requestId}`,
        ].join('\n'),
      });
      // A resolved send with a message ID confirms Email Service accepted the message.
      // It does not guarantee inbox placement; no contact contents are logged or stored by this Worker.
      if (typeof sent?.messageId !== 'string' || !sent.messageId) throw new Error('Delivery not confirmed');
      return response(200, { ok: true }, origin);
    } catch {
      return response(503, { error: 'Your message could not be sent. Please try again later.' }, origin);
    }
  },
};
