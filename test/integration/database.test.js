import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, resetDb } from '../helpers/testDb.js';

let db;

before(() => {
  db = createTestDb();
});
after(() => db.$disconnect());
beforeEach(() => resetDb(db));

test('a Run can be written and read back with its default status', async () => {
  const created = await db.run.create({ data: { request: "Summarise Bob's email" } });
  const found = await db.run.findUnique({ where: { id: created.id } });
  assert.equal(found.request, "Summarise Bob's email");
  assert.equal(found.status, 'planning');
});

test('resetDb empties application tables between tests', async () => {
  await db.run.create({ data: { request: 'x' } });
  await resetDb(db);
  assert.equal(await db.run.count(), 0);
});

test('an invalid status is rejected by the database layer', async () => {
  await assert.rejects(() => db.run.create({ data: { request: 'x', status: 'bogus' } }));
});
