// Uses a tiny app with deliberately failing routes to check the error handler
// and the "database down" behaviour of the health check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createApp } from '../../src/app.js';
import { AppError, createErrorHandler } from '../../src/http/errors.js';
import { startServer } from '../helpers/server.js';

test('unexpected errors become a generic 500 and are logged, not leaked', async () => {
  const logged = [];
  const app = express();
  app.get('/boom', () => {
    throw new Error('secret connection string postgres://user:pw@host/db');
  });
  app.use(createErrorHandler({ error: (...a) => logged.push(a) }));

  const server = await startServer(app);
  try {
    const res = await fetch(`${server.baseUrl}/boom`);
    const text = await res.text();
    assert.equal(res.status, 500);
    assert.equal(JSON.parse(text).error.code, 'internal_error');
    assert.doesNotMatch(text, /secret|postgres|at .*\.js/);
    assert.equal(logged.length, 1, 'the real error is kept in the server log');
  } finally {
    await server.close();
  }
});

test('AppError keeps its status and code', async () => {
  const app = express();
  app.get('/teapot', () => {
    throw new AppError(418, 'teapot', 'short and stout');
  });
  app.use(createErrorHandler({ error() {} }));

  const server = await startServer(app);
  try {
    const res = await fetch(`${server.baseUrl}/teapot`);
    assert.equal(res.status, 418);
    assert.deepEqual(await res.json(), { error: { code: 'teapot', message: 'short and stout' } });
  } finally {
    await server.close();
  }
});

test('health returns 503 when the database is unreachable', async () => {
  const brokenDb = {
    $queryRaw: async () => {
      throw new Error('connection refused');
    },
  };
  const server = await startServer(createApp({ db: brokenDb, logger: { error() {} } }));
  try {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: 'degraded', database: 'unreachable' });
  } finally {
    await server.close();
  }
});
