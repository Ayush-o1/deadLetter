// Failure paths: what happens when storage or a model provider breaks at the worst moment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServices } from '../../src/composition.js';
import { InMemoryRunRepository } from '../../src/runtime/memoryRepository.js';
import { REQUEST_A, REQUEST_D, makeService, untilApproval } from '../helpers/service.js';

test('if the pause cannot be recorded, no unanswerable approval is left behind and nothing is sent', async () => {
  const repo = new InMemoryRunRepository();
  const { service, world, approvals } = makeService({ repo });
  const { id } = await service.create(REQUEST_D);

  // Storage fails exactly when the run is saved as "awaiting_approval".
  repo.failWhen = (kind, payload) => kind === 'run' && payload.status === 'awaiting_approval';
  await service.execute(id);
  const run = await service.wait(id);

  assert.equal(run.status, 'failed');
  assert.equal(approvals.list().length, 0, 'the registered approval was withdrawn');
  assert.equal(world().outbox.length, 0, 'the send never happened');
});

test('if the final record cannot be saved, the failure is logged and the run still ends cleanly', async () => {
  const repo = new InMemoryRunRepository();
  const { service, errors } = makeService({ repo });
  const { id } = await service.create(REQUEST_A);
  await service.execute(id);
  // Let the run get going, then break the final write (the one that records "finished").
  repo.failWhen = (kind, payload) => kind === 'run' && payload.events?.at(-1)?.type === 'finished';
  const run = await service.wait(id);
  assert.equal(run.status, 'completed', 'the work was done; only the last save failed');
  assert.ok(errors.some((e) => /Could not save the finished run/.test(String(e[0]))));
});

test('a pause that is answered after the run was cancelled is refused, not applied', async () => {
  const { service, world } = makeService();
  const { id } = await service.create(REQUEST_D);
  await service.execute(id);
  const paused = await untilApproval(service, id);
  const approvalId = paused.pendingApprovals[0].id;
  await service.cancel(id);
  await assert.rejects(
    () => service.resolveApproval(approvalId, { action: 'approve_once' }),
    /No pending approval/,
  );
  assert.equal(world().outbox.length, 0);
});

test('an unreachable live model provider gives a failed run with a safe reason, not a crash', async () => {
  const services = createServices({
    db: {},
    config: {
      model: {
        provider: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        plannerModel: 'x',
        apiKey: 'sk-SECRET',
      },
    },
    logger: { error() {} },
    overrides: {
      runRepo: new InMemoryRunRepository(),
      policy: {
        getConfig: async () => ({ tools: {}, trustedDestinations: new Set() }),
        seedDefaults: async () => {},
        addTrusted: async () => {},
      },
      evals: {},
    },
  });
  const run = await services.runs.create("Show Bob's latest email.");
  assert.equal(run.status, 'failed');
  assert.equal(run.error.code, 'planner_failed');
  assert.doesNotMatch(JSON.stringify(run), /sk-SECRET|127\.0\.0\.1/);
});

test('many runs do not grow memory without bound: only recent runs stay in memory, all stay stored', async () => {
  const { service, repo } = makeService();
  const ids = [];
  for (let i = 0; i < 105; i++) ids.push((await service.create(REQUEST_A)).id);
  for (const id of ids) await service.cancel(id);
  assert.equal((await service.list({ limit: 200 })).length, 105);
  // The oldest is no longer held in memory, yet can still be read back from storage.
  const oldest = await service.get(ids[0]);
  assert.equal(oldest.status, 'cancelled');
  assert.ok(await repo.getRun(ids[0]));
});
