import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

const valid = { DATABASE_URL: 'postgresql://localhost:5432/x' };

test('applies defaults', () => {
  const cfg = loadConfig(valid);
  assert.deepEqual(cfg, {
    nodeEnv: 'development',
    port: 3000,
    host: '127.0.0.1',
    allowedHosts: ['localhost', '127.0.0.1', '[::1]'],
    databaseUrl: 'postgresql://localhost:5432/x',
    model: {
      provider: 'mock',
      baseUrl: undefined,
      apiKey: undefined,
      plannerModel: undefined,
      quarantineModel: undefined,
    },
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

test('a live model provider needs a base URL and a planner model', () => {
  assert.throws(
    () => loadConfig({ ...valid, MODEL_PROVIDER: 'openai_compatible' }),
    /MODEL_BASE_URL/,
  );
  const cfg = loadConfig({
    ...valid,
    MODEL_PROVIDER: 'openai_compatible',
    MODEL_BASE_URL: 'http://localhost:11434/v1',
    PLANNER_MODEL: 'some-model',
  });
  assert.equal(cfg.model.provider, 'openai_compatible');
  assert.equal(cfg.model.apiKey, undefined, 'a key is optional (local servers)');
});

test('an unknown model provider is rejected', () => {
  assert.throws(() => loadConfig({ ...valid, MODEL_PROVIDER: 'magic' }), /MODEL_PROVIDER/);
});

test('allowed hosts: loopback by default, plus HOST and ALLOWED_HOSTS, never a wildcard', () => {
  assert.deepEqual(loadConfig({ ...valid, HOST: '0.0.0.0' }).allowedHosts, [
    'localhost',
    '127.0.0.1',
    '[::1]',
  ]);
  assert.deepEqual(
    loadConfig({ ...valid, HOST: '192.168.1.5', ALLOWED_HOSTS: 'dl.lan, dl.local ' }).allowedHosts,
    ['localhost', '127.0.0.1', '[::1]', '192.168.1.5', 'dl.lan', 'dl.local'],
  );
});
