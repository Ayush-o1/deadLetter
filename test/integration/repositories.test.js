// One contract, two implementations: the in-memory repository and the Prisma
// repository must behave identically for everything the run service relies on.
import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPrismaRunRepository } from '../../src/db/runRepository.js';
import { InMemoryRunRepository } from '../../src/runtime/memoryRepository.js';
import { createTestDb, resetDb } from '../helpers/testDb.js';

let n = 0;
const run = (over = {}) => ({
  id: `run-${String(++n).padStart(3, '0')}`,
  request: 'Summarise the thing',
  status: 'completed',
  createdAt: new Date(Date.UTC(2026, 10, 5, 12, 0, n)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 10, 5, 12, 0, n)).toISOString(),
  finishedAt: null,
  plan: { version: 1, steps: [{ id: 'a', op: 'show', value: { lit: 'x' } }] },
  planPreview: [{ id: 'a', depth: 0, kind: 'show', text: 'Show you "x"' }],
  error: null,
  results: [],
  provenance: { nodes: [] },
  events: [{ at: '2026-11-05T12:00:00.000Z', type: 'created' }],
  version: 1,
  ...over,
});
const step = (seq, over = {}) => ({
  seq,
  key: `s${seq}#`,
  stepId: `s${seq}`,
  iteration: [],
  op: 'call',
  tool: 'send_email',
  state: 'done',
  control: [],
  args: [],
  policy: {
    decision: 'allow',
    ruleId: 'allowed_destination_trusted',
    decidedBy: 'engine',
    outcome: 'executed',
  },
  result: null,
  error: null,
  ...over,
});

let db;
before(() => {
  db = createTestDb();
});
after(() => db.$disconnect());

for (const [name, make] of [
  ['in-memory repository', () => new InMemoryRunRepository()],
  ['Prisma repository', () => createPrismaRunRepository(db)],
]) {
  describe(name, () => {
    let repo;
    beforeEach(async () => {
      await resetDb(db);
      repo = make();
    });

    test('a run and its steps round-trip, in step order', async () => {
      const r = run({ finishedAt: '2026-11-05T12:05:00.000Z', error: { code: 'x', message: 'y' } });
      await repo.saveRun(r);
      await repo.saveStep(r.id, step(1));
      await repo.saveStep(r.id, step(0, { tool: 'read_email', op: 'call' }));
      const got = await repo.getRun(r.id);
      assert.deepEqual({ ...got, steps: undefined }, { ...r, steps: undefined });
      assert.deepEqual(
        got.steps.map((s) => s.seq),
        [0, 1],
      );
      assert.deepEqual(got.steps[1], step(1));
      assert.equal(await repo.getRun('nope'), undefined);
    });

    test('saving again updates in place (upsert) rather than duplicating', async () => {
      const r = run();
      await repo.saveRun(r);
      await repo.saveStep(r.id, step(0, { state: 'running' }));
      await repo.saveRun({ ...r, status: 'failed', version: 2 });
      await repo.saveStep(r.id, step(0, { state: 'done' }));
      const got = await repo.getRun(r.id);
      assert.equal(got.status, 'failed');
      assert.equal(got.version, 2);
      assert.equal(got.steps.length, 1);
      assert.equal(got.steps[0].state, 'done');
    });

    test('null and structured JSON survive: no plan, no provenance', async () => {
      const r = run({ plan: null, provenance: null, error: null, status: 'failed' });
      await repo.saveRun(r);
      const got = await repo.getRun(r.id);
      assert.equal(got.plan, null);
      assert.equal(got.provenance, null);
      assert.equal(got.error, null);
    });

    test('listRuns: newest first, with step counts and decision tallies', async () => {
      const a = run();
      const b = run({ request: 'Another task' });
      await repo.saveRun(a);
      await repo.saveRun(b);
      await repo.saveStep(b.id, step(0));
      await repo.saveStep(
        b.id,
        step(1, {
          policy: {
            decision: 'deny',
            ruleId: 'template_deny',
            decidedBy: 'engine',
            outcome: 'blocked',
          },
        }),
      );
      await repo.saveStep(b.id, step(2, { policy: null, op: 'show', tool: null }));
      const list = await repo.listRuns();
      assert.deepEqual(
        list.map((x) => x.id),
        [b.id, a.id],
      );
      assert.equal(list[0].stepCount, 3);
      assert.deepEqual(list[0].decisions, { allow: 1, ask: 0, deny: 1 });
      assert.deepEqual(list[1].decisions, { allow: 0, ask: 0, deny: 0 });
      assert.deepEqual(Object.keys(list[0]).sort(), [
        'createdAt',
        'decisions',
        'error',
        'finishedAt',
        'id',
        'request',
        'status',
        'stepCount',
        'version',
      ]);
    });

    test('listRuns filters: text, status, decision, rule, tool, who decided', async () => {
      const a = run({ request: 'Email Alice the report' });
      const b = run({ request: 'Delete the notes file', status: 'blocked' });
      const c = run({ request: 'email Bob', status: 'failed' });
      for (const r of [a, b, c]) await repo.saveRun(r);
      await repo.saveStep(a.id, step(0));
      await repo.saveStep(
        b.id,
        step(0, {
          tool: 'delete_file',
          policy: {
            decision: 'ask',
            ruleId: 'template_ask',
            decidedBy: 'user',
            outcome: 'blocked',
          },
        }),
      );
      await repo.saveStep(
        c.id,
        step(0, {
          tool: 'read_email',
          policy: {
            decision: 'allow',
            ruleId: 'allowed_by_rule',
            decidedBy: 'engine',
            outcome: 'executed',
          },
        }),
      );

      const ids = async (f) => (await repo.listRuns(f)).map((x) => x.id).sort();
      assert.deepEqual(
        await ids({ q: 'EMAIL' }),
        [a.id, c.id].sort(),
        'case-insensitive text search',
      );
      assert.deepEqual(await ids({ status: 'blocked' }), [b.id]);
      assert.deepEqual(await ids({ decision: 'ask' }), [b.id]);
      assert.deepEqual(await ids({ decision: 'allow' }), [a.id, c.id].sort());
      assert.deepEqual(await ids({ ruleId: 'template_ask' }), [b.id]);
      assert.deepEqual(await ids({ tool: 'read_email' }), [c.id]);
      assert.deepEqual(await ids({ decidedBy: 'user' }), [b.id]);
      // step-level conditions must hold on the same step
      assert.deepEqual(await ids({ decision: 'allow', tool: 'delete_file' }), []);
      assert.deepEqual(await ids({ decision: 'ask', tool: 'delete_file', status: 'blocked' }), [
        b.id,
      ]);
      assert.deepEqual(await ids({ q: 'nothing like this' }), []);
    });

    test('listRuns paginates and clamps limits', async () => {
      for (let i = 0; i < 5; i++) await repo.saveRun(run());
      const all = await repo.listRuns();
      assert.equal(all.length, 5);
      const page = await repo.listRuns({ limit: 2, offset: 1 });
      assert.deepEqual(
        page.map((x) => x.id),
        all.slice(1, 3).map((x) => x.id),
      );
      assert.equal((await repo.listRuns({ limit: 100000 })).length, 5);
      assert.equal((await repo.listRuns({ limit: -4 })).length >= 1, true);
    });

    test('listByStatus returns only runs in those states', async () => {
      const a = run({ status: 'running' });
      const b = run({ status: 'completed' });
      const c = run({ status: 'awaiting_approval' });
      for (const r of [a, b, c]) await repo.saveRun(r);
      const got = await repo.listByStatus(['running', 'awaiting_approval']);
      assert.deepEqual(got.map((x) => x.id).sort(), [a.id, c.id].sort());
    });
  });
}

test('Prisma repository: deleting a run removes its steps (cascade)', async () => {
  await resetDb(db);
  const repo = createPrismaRunRepository(db);
  const r = run();
  await repo.saveRun(r);
  await repo.saveStep(r.id, step(0));
  await db.run.delete({ where: { id: r.id } });
  assert.equal(await db.step.count(), 0);
});

test('Prisma repository: an unknown status is rejected by the database', async () => {
  await resetDb(db);
  await assert.rejects(() => createPrismaRunRepository(db).saveRun(run({ status: 'bogus' })));
});
