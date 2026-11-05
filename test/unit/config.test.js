import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

const valid = { DATABASE_URL: 'postgresql://localhost:5432/x' };

test('applies defaults', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg, {
    nodeEnv: 'development',
    port: 3000,
    databaseUrl: 'postgresql://localhost:5432/x',
  });
});

test('reads and coerces PORT', () => {
  assert.equal(loadConfig({ ...valid, PORT: '8080' }).port, 8080);
});

test('rejects an out-of-range or non-numeric PORT', () => {
  assert.throws(() => loadConfig({ ...valid, PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ ...valid, PORT: 'abc' }), /PORT/);
});

test('rejects a missing DATABASE_URL', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
});

test('rejects a DATABASE_URL that is not a postgres URL', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://x/y' }), /postgresql/);
});

test('rejects an unknown NODE_ENV', () => {
  assert.throws(() => loadConfig({ ...valid, NODE_ENV: 'staging' }), /NODE_ENV/);
});

test('reports every problem at once', () => {
  assert.throws(
    () => loadConfig({ PORT: 'abc' }),
    (err) => /PORT/.test(err.message) && /DATABASE_URL/.test(err.message),
  );
});
