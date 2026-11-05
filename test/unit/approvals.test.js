import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalError, ApprovalManager } from '../../src/runtime/approvals.js';

const card = (actions = ['approve_once', 'approve_and_trust', 'edit_destination', 'reject']) => ({
  actions,
});
const request = (m, runId = 'r1') =>
  m.request({ runId, stepId: 's1', tool: 'send_email', card: card() });
const settled = async (promise) =>
  Promise.race([
    promise.then((v) => ({ done: true, v })),
    new Promise((r) => setImmediate(() => r({ done: false }))),
  ]);

test('a pending approval holds the caller until it is answered', async () => {
  const m = new ApprovalManager();
  const p = request(m);
  assert.equal((await settled(p)).done, false, 'still waiting');
  assert.equal(m.list().length, 1);
  const [{ id }] = m.list();
  m.resolve(id, { action: 'approve_once' });
  assert.deepEqual(await p, { action: 'approve_once', destination: undefined });
  assert.equal(m.list().length, 0);
});

test('an approval can be answered only once', async () => {
  const m = new ApprovalManager();
  const p = request(m);
  const [{ id }] = m.list();
  m.resolve(id, { action: 'reject' });
  await p;
  assert.throws(
    () => m.resolve(id, { action: 'approve_once' }),
    (e) => e instanceof ApprovalError && e.code === 'not_pending',
  );
});

test('unknown ids, unknown actions and actions not offered are rejected without resolving', async () => {
  const m = new ApprovalManager();
  const p = m.request({
    runId: 'r1',
    stepId: 's1',
    tool: 'delete_file',
    card: card(['approve_once', 'reject']),
  });
  const [{ id }] = m.list();
  assert.throws(() => m.resolve('nope', { action: 'reject' }), /No pending/);
  assert.throws(() => m.resolve(id, { action: 'allow' }), /Unknown approval action/);
  assert.throws(() => m.resolve(id, undefined), /Unknown approval action/);
  assert.throws(() => m.resolve(id, { action: 'approve_and_trust' }), /not available/);
  assert.equal((await settled(p)).done, false, 'bad answers do not release the run');
  m.resolve(id, { action: 'reject' });
  await p;
});

test('editing needs a destination', async () => {
  const m = new ApprovalManager();
  const p = request(m);
  const [{ id }] = m.list();
  assert.throws(() => m.resolve(id, { action: 'edit_destination' }), /Enter a destination/);
  assert.throws(
    () => m.resolve(id, { action: 'edit_destination', destination: '   ' }),
    /Enter a destination/,
  );
  m.resolve(id, { action: 'edit_destination', destination: 'new@example.com' });
  assert.deepEqual(await p, { action: 'edit_destination', destination: 'new@example.com' });
});

test('cancelling a run answers its pending approvals with "cancel" and leaves other runs alone', async () => {
  const m = new ApprovalManager();
  const a = request(m, 'r1');
  const b = request(m, 'r2');
  m.cancelRun('r1');
  assert.equal((await a).action, 'cancel');
  assert.equal((await settled(b)).done, false);
  assert.equal(m.list('r2').length, 1);
  assert.equal(m.list('r1').length, 0);
});

test('listing exposes the card but not the internal resolver', () => {
  const m = new ApprovalManager();
  request(m);
  const [item] = m.list();
  assert.deepEqual(Object.keys(item).sort(), [
    'card',
    'createdAt',
    'id',
    'runId',
    'stepId',
    'tool',
  ]);
});

test('change notifications fire for requests and answers', async () => {
  const events = [];
  const m = new ApprovalManager({ onChange: (e) => events.push(e.type) });
  const p = request(m);
  m.resolve(m.list()[0].id, { action: 'reject' });
  await p;
  assert.deepEqual(events, ['approval_requested', 'approval_resolved']);
});
