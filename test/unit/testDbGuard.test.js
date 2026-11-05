import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTestDatabaseUrl } from '../helpers/testDb.js';

test('test helpers refuse a database whose name does not end in _test', () => {
  const saved = process.env.TEST_DATABASE_URL;
  try {
    process.env.TEST_DATABASE_URL = 'postgresql://localhost:5432/deadletter_dev';
    assert.throws(() => getTestDatabaseUrl(), /must end in _test/);
    process.env.TEST_DATABASE_URL = 'postgresql://localhost:5432/deadletter_test';
    assert.doesNotThrow(() => getTestDatabaseUrl());
  } finally {
    if (saved === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = saved;
  }
});
