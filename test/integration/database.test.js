import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, resetDb } from '../helpers/testDb.js';

let db;

before(() => {
  db = createTestDb();
});
after(() => db.$disconnect());
beforeEach(() => resetDb(db));

const row = (id) => ({
  id,
  request: "Summarise Bob's email",
  status: 'planned',
  createdAt: new Date(),
  updatedAt: new Date(),
  planPreview: [],
  results: [],
  events: [],
  version: 0,
});

test('a Run can be written and read back', async () => {
  await db.run.create({ data: row('r1') });
  const found = await db.run.findUnique({ where: { id: 'r1' } });
  assert.equal(found.request, "Summarise Bob's email");
  assert.equal(found.status, 'planned');
});

test('resetDb empties every application table', async () => {
  await db.run.create({ data: row('r1') });
  await db.trustedDestination.create({ data: { destination: 'a@b.co' } });
  await resetDb(db);
  assert.equal(await db.run.count(), 0);
  assert.equal(await db.trustedDestination.count(), 0);
});

test('an invalid status is rejected by the database layer', async () => {
  await assert.rejects(() => db.run.create({ data: { ...row('r2'), status: 'bogus' } }));
});
