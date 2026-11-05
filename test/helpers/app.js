// A complete application on the test database: real Prisma repositories, mock
// models, real HTTP server. Used by the API tests.
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { createServices } from '../../src/composition.js';
import { createTestDb, resetDb } from './testDb.js';
import { startServer } from './server.js';

export async function makeApp({ overrides = {}, reset = true, db: existingDb } = {}) {
  const db = existingDb ?? createTestDb();
  if (reset) await resetDb(db);
  const services = createServices({
    db,
    config: { model: { provider: 'mock' } },
    logger: { error() {} },
    overrides,
  });
  await services.start();
  const server = await startServer(
    createApp({
      db,
      services,
      publicDir: fileURLToPath(new URL('../../public', import.meta.url)),
      logger: { error() {} },
    }),
  );

  const call = async (method, path, body) => {
    const res = await fetch(`${server.baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers };
  };

  return {
    db,
    services,
    baseUrl: server.baseUrl,
    api: {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      put: (p, b) => call('PUT', p, b),
      delete: (p, b) => call('DELETE', p, b),
    },
    async close({ keepDb = false } = {}) {
      await server.close();
      if (!existingDb && !keepDb) await db.$disconnect();
    },
  };
}

/** Poll until `check(value)` is true (or time out with the last value in the message). */
export async function waitFor(fetchValue, check, { tries = 200, delayMs = 10 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fetchValue();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`condition not met; last value: ${JSON.stringify(last)?.slice(0, 300)}`);
}
