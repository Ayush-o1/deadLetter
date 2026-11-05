import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../helpers/testDb.js';
import { startServer } from '../helpers/server.js';

const silentLogger = { error() {} };

let db;
let server;

before(async () => {
  db = createTestDb();
  server = await startServer(createApp({ db, logger: silentLogger }));
});

after(async () => {
  await server.close();
  await db.$disconnect();
});

test('GET /api/health reports the database as connected', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok', database: 'connected' });
});

test('unknown routes return a JSON 404, not HTML', async () => {
  const res = await fetch(`${server.baseUrl}/api/nope`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const body = await res.json();
  assert.equal(body.error.code, 'not_found');
});

test('malformed JSON bodies return 400 without internals', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, 'invalid_json');
});

test('oversized bodies are rejected with 413', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(200_000) }),
  });
  assert.equal(res.status, 413);
});

test('responses carry security headers and hide the framework', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(res.headers.get('content-security-policy'), /img-src 'self'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});
