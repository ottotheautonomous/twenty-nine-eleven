// Pure parts of src/sparkle.js (node --test): the nearness law, the one envelope and its exact reversal, the level table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cubicBezier } from 'motion';
import { nearness, envelope as envelopeWith, levelFor } from './sparkle.js';

const siteEase = cubicBezier(0.22, 1, 0.36, 1), envelope = (p) => envelopeWith(p, siteEase);

test('nearness: smoothstep of the weighted distance outside the button', () => {
  assert.equal(nearness(0, 0, 150), 1);
  assert.equal(nearness(150, 0, 150), 0);
  assert.equal(nearness(0, 150 / 3.6, 150), 0);
  // the spec's check values at 1440x900: the rows' bottom edge (dy 30), the promise's top edge (dy 28), 75 px to the side
  assert.ok(Math.abs(nearness(0, 30, 150) - 0.19) < 0.005);
  assert.ok(Math.abs(nearness(0, 28, 150) - 0.25) < 0.005);
  assert.ok(Math.abs(nearness(75, 0, 150) - 0.5) < 1e-9);
  // the counts they give at level 1: round(30 n^1.25) = 4 on the rows, 5 on the promise, 13 at 75 px
  assert.equal(Math.round(30 * nearness(0, 30, 150) ** 1.25), 4);
  assert.equal(Math.round(30 * nearness(0, 28, 150) ** 1.25), 5);
  assert.equal(Math.round(30 * nearness(75, 0, 150) ** 1.25), 13);
  let last = 1;
  for (let d = 0; d <= 160; d += 4) { const v = nearness(d, 0, 150); assert.ok(v <= last + 1e-12); last = v; }
});

test('envelope: spark then settle, ends on the settled grain', () => {
  const e0 = envelope(0), es = envelope(0.08 / 0.6), e1 = envelope(1);
  assert.deepEqual([e0.alpha, e0.size, e0.glint, e0.glide], [0, 0.6, 0, 0]);
  assert.ok(Math.abs(es.alpha - 2) < 1e-9 && Math.abs(es.size - 1.2) < 1e-9 && Math.abs(es.glint - 1) < 1e-9);
  assert.ok(Math.abs(e1.alpha - 1) < 1e-9 && Math.abs(e1.size - 1) < 1e-9 && Math.abs(e1.glint) < 1e-9 && Math.abs(e1.glide - 1) < 1e-9);
});

test('envelope: a retirement is the birth played exactly backwards (E_retire(t) == E_birth(TB - t))', () => {
  // the grain's phase moves by dt / TB either way; simulate both at 60 Hz and compare frame by frame
  const TB = 0.6, dt = 1 / 60, birth = [], retire = [];
  for (let p = 0, i = 0; i <= 36; i++, p = Math.min(1, p + dt / TB)) birth.push({ ...envelope(p) });
  for (let p = 1, i = 0; i <= 36; i++, p = Math.max(0, p - dt / TB)) retire.push({ ...envelope(p) });
  for (let i = 0; i <= 36; i++) for (const k of ['alpha', 'size', 'glint', 'glide']) assert.ok(Math.abs(retire[i][k] - birth[36 - i][k]) < 1e-9, `${k} @${i}`);
});

test('envelope: the settle uses the site ease [0.22, 1, 0.36, 1] (Motion\'s cubicBezier, within 1e-3 of exact)', () => {
  const S = 0.08 / 0.6;
  const X = (t) => 3 * (1 - t) ** 2 * t * 0.22 + 3 * (1 - t) * t * t * 0.36 + t ** 3, Y = (t) => 3 * (1 - t) ** 2 * t + 3 * (1 - t) * t * t + t ** 3;
  const exact = (x) => { let lo = 0, hi = 1; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (X(m) < x) lo = m; else hi = m; } return Y((lo + hi) / 2); };
  for (let i = 0; i <= 20; i++) {
    const q = i / 20, e = envelope(S + q * (1 - S));
    assert.ok(Math.abs(e.glide - siteEase(q)) < 1e-12, `q ${q}`);
    assert.ok(Math.abs(e.glide - exact(q)) < 1e-3, `q ${q}: ${e.glide} vs exact ${exact(q)}`);
  }
});

test('levelFor: the governor and tier table', () => {
  assert.equal(levelFor({ type: 'static', tier: 'static' }), 0);
  assert.equal(levelFor({ type: 'webgl2', tier: 'xe', steps: 0 }), 1);
  assert.equal(levelFor({ type: 'webgl2', tier: 'xe', steps: 1 }), 0.6);
  assert.equal(levelFor({ type: 'webgl2', tier: 'xe', steps: 2 }), 0.6);
  assert.equal(levelFor({ type: 'webgl2', tier: 'xe', steps: 3 }), 0);
  assert.equal(levelFor({ type: 'webgl2', tier: 'uhd', steps: 0 }), 1);
  assert.equal(levelFor({ type: 'canvas2d', tier: 'c2d', sprites: 3000 }), 0.5);
  assert.equal(levelFor({ type: 'canvas2d', tier: 'c2d', sprites: 2000 }), 0);
  assert.equal(levelFor({ type: 'webgl2', tier: 'iphone', steps: 0 }), 0.6);
  assert.equal(levelFor({ type: 'webgl2', tier: 'android', steps: 0 }), 0.6);
  assert.equal(levelFor({ type: 'webgl2', tier: 'android', steps: 1 }), 0);
});
