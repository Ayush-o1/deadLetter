// A local service with no login must not be usable from a hostile web page open in
// the same browser (DNS rebinding and cross-site requests).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createApp } from '../../src/app.js';
import { localOnly } from '../../src/http/middleware/localOnly.js';
import { startServer } from '../helpers/server.js';

let server;
before(async () => {
  const app = createApp({ db: { $queryRaw: async () => 1 }, logger: { error() {} } });
  server = await startServer(app);
});
after(() => server.close());

/** A request with exactly the headers given, including Host (fetch will not let us set it). */
function raw(headers, { method = 'GET', path = '/api/health' } = {}) {
  const { port } = new URL(server.baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () =>
        resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}
const here = () => new URL(server.baseUrl).host;

test('requests to the loopback names are served', async () => {
  for (const host of [
    here(),
    `localhost:${new URL(server.baseUrl).port}`,
    `LOCALHOST:${new URL(server.baseUrl).port}`,
  ]) {
    assert.equal((await raw({ host })).status, 200, host);
  }
});

test('DNS rebinding: a hostile domain pointed at 127.0.0.1 is refused', async () => {
  for (const host of [
    'evil.example',
    'evil.example:3000',
    `127.0.0.1.evil.example:${new URL(server.baseUrl).port}`,
    'attacker.test',
  ]) {
    const res = await raw({ host });
    assert.equal(res.status, 403, host);
    assert.equal(res.body.error.code, 'forbidden_host');
  }
});

test('a missing Host header is refused', async () => {
  const { port } = new URL(server.baseUrl);
  const status = await new Promise((resolve) => {
    // HTTP/1.0 allows no Host header at all.
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/health', setHost: false, headers: {} },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.end();
  });
  // Node's own parser rejects it (400) before our check runs; either way it is refused.
  assert.ok([400, 403].includes(status), `status ${status}`);
});

test('cross-site requests: a foreign Origin is refused, on reads and on writes', async () => {
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
    const res = await raw(
      { host: here(), origin: 'https://evil.example', 'content-type': 'application/json' },
      { method, path: '/api/runs' },
    );
    assert.equal(res.status, 403, method);
    assert.equal(res.body.error.code, 'forbidden_origin');
  }
  assert.equal(
    (await raw({ host: here(), origin: 'null' })).status,
    403,
    'the opaque "null" origin is refused',
  );
  assert.equal((await raw({ host: here(), origin: 'not a url' })).status, 403);
});

test('our own origin is accepted, and so is a request with no Origin (curl, tests)', async () => {
  assert.equal((await raw({ host: here(), origin: `http://${here()}` })).status, 200);
  assert.equal((await raw({ host: here() })).status, 200);
});

test('a port-mismatched Origin on the same host is refused (another local app)', async () => {
  const res = await raw({ host: here(), origin: 'http://127.0.0.1:9' });
  assert.equal(res.status, 403);
});

test('extra allowed hosts can be configured, and still nothing else', async () => {
  const app = express();
  app.use(localOnly({ allowedHosts: ['dl.lan'] }));
  app.get('/ok', (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code }));
  const s = await startServer(app);
  try {
    const { port } = new URL(s.baseUrl);
    const get = (host) =>
      new Promise((resolve) =>
        http.get(
          { host: '127.0.0.1', port, path: '/ok', headers: { host } },
          (res) => (res.resume(), resolve(res.statusCode)),
        ),
      );
    assert.equal(await get(`dl.lan:${port}`), 200);
    assert.equal(
      await get(`localhost:${port}`),
      403,
      'the default names only apply when no list is given',
    );
  } finally {
    await s.close();
  }
});
