import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPrismaPolicyRepository } from '../../src/db/policyRepository.js';
import { createPrismaEvalRepository } from '../../src/db/evalRepository.js';
import { evaluate } from '../../src/core/policy/engine.js';
import { toolCatalog as catalog } from '../../src/core/tools/specs.js';
import { createTestDb, resetDb } from '../helpers/testDb.js';
import { makeWorld } from '../helpers/values.js';

let db;
let repo;
const silent = { error() {} };
before(() => {
  db = createTestDb();
});
after(() => db.$disconnect());
beforeEach(async () => {
  await resetDb(db);
  repo = createPrismaPolicyRepository(db, catalog, silent);
});

test('seedDefaults writes a rule for every tool and never overwrites a choice', async () => {
  await repo.seedDefaults();
  const tools = await repo.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    catalog.names(),
  );
  assert.ok(tools.every((t) => t.configured && t.enabled === true));
  assert.equal(tools.find((t) => t.name === 'send_email').template, 'trusted_destination');
  assert.equal(tools.find((t) => t.name === 'delete_file').template, 'ask');

  await repo.setTool('read_file', { enabled: false, template: 'deny' });
  await repo.seedDefaults();
  const after = (await repo.listTools()).find((t) => t.name === 'read_file');
  assert.deepEqual([after.enabled, after.template], [false, 'deny']);
});

test('getConfig reflects stored rules and normalised trusted destinations', async () => {
  await repo.seedDefaults();
  await repo.setTool('send_email', { enabled: true, template: 'ask' });
  assert.equal(await repo.addTrusted('  Lead@Example.ORG '), 'lead@example.org');
  await repo.addTrusted('lead@example.org'); // duplicate is a no-op
  const config = await repo.getConfig();
  assert.equal(config.tools.send_email.template, 'ask');
  assert.deepEqual([...config.trustedDestinations], ['lead@example.org']);
  assert.equal((await repo.listTrusted()).length, 1);
  assert.equal(await repo.removeTrusted('LEAD@example.org'), true);
  assert.equal(await repo.removeTrusted('lead@example.org'), false);
});

test('setTool refuses unknown tools and invalid templates', async () => {
  assert.equal(await repo.setTool('wire_money', { enabled: true, template: 'allow' }), false);
  await assert.rejects(
    () => repo.setTool('read_file', { enabled: true, template: 'yolo' }),
    /template/,
  );
});

test('FAIL CLOSED: a tool whose row is missing asks, it is never allowed', async () => {
  await repo.seedDefaults();
  await db.toolSetting.delete({ where: { tool: 'read_file' } });
  const w = makeWorld();
  const decision = evaluate({
    tool: 'read_file',
    args: { path: w.typed('a.txt') },
    control: [],
    config: await repo.getConfig(),
    catalog,
  });
  assert.equal(decision.decision, 'ask');
  assert.equal(decision.ruleId, 'no_rule_configured');
  const listed = (await repo.listTools()).find((t) => t.name === 'read_file');
  assert.equal(listed.configured, false);
});

test('FAIL CLOSED: corrupted stored rules make every tool ask and drop trusted destinations', async () => {
  await repo.seedDefaults();
  await repo.addTrusted('lead@example.org');
  await db.$executeRawUnsafe(
    `UPDATE "ToolSetting" SET template = 'allow_everything' WHERE tool = 'send_email'`,
  );
  const config = await repo.getConfig();
  assert.deepEqual(Object.keys(config.tools), []);
  assert.equal(config.trustedDestinations.size, 0);
  const w = makeWorld();
  const d = evaluate({
    tool: 'read_file',
    args: { path: w.typed('a.txt') },
    control: [],
    config,
    catalog,
  });
  assert.equal(d.decision, 'ask');
});

test('evaluation reports are stored and listed newest first', async () => {
  const evals = createPrismaEvalRepository(db);
  const report = { meta: { scenarioSet: 'abc' }, summary: { none: {} }, scenarios: [] };
  const a = await evals.save(report);
  await new Promise((r) => setTimeout(r, 5));
  const b = await evals.save({ ...report, meta: { scenarioSet: 'def' } });
  assert.deepEqual(
    (await evals.list()).map((x) => x.id),
    [b.id, a.id],
  );
  assert.equal((await evals.get(a.id)).report.meta.scenarioSet, 'abc');
  assert.equal(await evals.get('00000000-0000-0000-0000-000000000000'), undefined);
});
