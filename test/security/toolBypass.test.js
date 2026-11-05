// Regression tests: a tool must be impossible to run without the policy gate's
// approval of exactly that call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolInvoker } from '../../src/core/tools/invoke.js';
import { UnauthorizedToolCall, mintAuthorization } from '../../src/core/policy/authorization.js';
import { createPolicyGate } from '../../src/core/policy/gate.js';
import { toolCatalog } from '../../src/core/tools/specs.js';
import { configWith, makeWorld } from '../helpers/values.js';

function setup() {
  const calls = [];
  const invoke = createToolInvoker({
    send_email: (args) => (calls.push(args), 'sent'),
    read_file: (args) => (calls.push(args), 'text'),
  });
  const w = makeWorld();
  const args = {
    to: w.typed('a@example.com'),
    subject: w.plainLiteral('s'),
    body: w.plainLiteral('b'),
  };
  return { calls, invoke, w, args };
}

test('calling a tool with no authorization is refused and the adapter never runs', async () => {
  const { calls, invoke, args } = setup();
  for (const token of [undefined, null, {}, 'allow', 42, { kind: 'tool-authorization' }, true]) {
    await assert.rejects(() => invoke('send_email', args, token), UnauthorizedToolCall);
  }
  assert.equal(calls.length, 0);
});

test('a forged token that looks like a real one is refused', async () => {
  const { calls, invoke, args } = setup();
  const lookalike = Object.freeze({ kind: 'tool-authorization' });
  await assert.rejects(() => invoke('send_email', args, lookalike), UnauthorizedToolCall);
  assert.equal(calls.length, 0);
});

test('a token for one tool cannot run another', async () => {
  const { calls, invoke, w, args } = setup();
  const token = mintAuthorization('read_file', { path: w.typed('a.txt') });
  await assert.rejects(() => invoke('send_email', args, token), /different tool/);
  assert.equal(calls.length, 0);
});

test('a token cannot be used with a swapped argument value (even an equal-looking one)', async () => {
  const { calls, invoke, w, args } = setup();
  const token = mintAuthorization('send_email', args);
  const swapped = { ...args, to: w.typed('a@example.com') }; // same text, different value
  await assert.rejects(() => invoke('send_email', swapped, token), /swapped/);
  const attacker = { ...args, to: w.typed('attacker@evil.example') };
  await assert.rejects(() => invoke('send_email', attacker, token), /swapped/);
  assert.equal(calls.length, 0);
});

test('a token cannot be used with extra or missing arguments', async () => {
  const { calls, invoke, w, args } = setup();
  const token = mintAuthorization('send_email', args);
  await assert.rejects(
    () => invoke('send_email', { ...args, cc: w.typed('x@y.z') }, token),
    /differ/,
  );
  const { body, ...missing } = args;
  assert.ok(body);
  await assert.rejects(() => invoke('send_email', missing, token), /differ/);
  assert.equal(calls.length, 0);
});

test('a token works once; replaying it is refused', async () => {
  const { calls, invoke, args } = setup();
  const token = mintAuthorization('send_email', args);
  assert.equal(await invoke('send_email', args, token), 'sent');
  await assert.rejects(() => invoke('send_email', args, token), /already used/);
  assert.equal(calls.length, 1);
});

test('a failed attempt does not use up a token', async () => {
  const { calls, invoke, args, w } = setup();
  const token = mintAuthorization('send_email', args);
  await assert.rejects(() => invoke('send_email', { ...args, to: w.typed('x@y.z') }, token));
  assert.equal(await invoke('send_email', args, token), 'sent');
  assert.equal(calls.length, 1);
});

test('adapters receive plain data only, never labelled values', async () => {
  const { calls, invoke, args } = setup();
  await invoke('send_email', args, mintAuthorization('send_email', args));
  assert.deepEqual(calls[0], { to: 'a@example.com', subject: 's', body: 'b' });
});

test('there is no adapter for a tool that was authorized but not registered', async () => {
  const { invoke, w } = setup();
  const args = { path: w.typed('x') };
  await assert.rejects(
    () => invoke('delete_file', args, mintAuthorization('delete_file', args)),
    /No adapter/,
  );
});

test('the adapter table cannot be changed after the invoker is created', async () => {
  const table = { read_file: () => 'ok' };
  const invoke = createToolInvoker(table);
  table.read_file = () => 'tampered';
  table.send_email = () => 'injected';
  const w = makeWorld();
  const args = { path: w.typed('x') };
  assert.equal(await invoke('read_file', args, mintAuthorization('read_file', args)), 'ok');
  await assert.rejects(
    () => invoke('send_email', args, mintAuthorization('send_email', args)),
    /No adapter/,
  );
});

test('the gate refuses an unrecognised answer from the approval layer', async () => {
  const w = makeWorld();
  const cfg = configWith();
  for (const answer of [
    undefined,
    null,
    {},
    { action: 'allow' },
    { action: 'APPROVE_ONCE' },
    'approve_once',
    { action: 'approve_and_trust' },
  ]) {
    const authorize = createPolicyGate({
      catalog: toolCatalog,
      store: w.store,
      getConfig: () => cfg,
      requestApproval: async () => answer,
    });
    // delete_file asks by default, so the approval layer is consulted. For
    // approve_and_trust there is no destination to trust, so that is refused too.
    const outcome = await authorize({
      stepId: 's1',
      tool: 'delete_file',
      args: { path: w.typed('a.txt') },
      control: [],
    });
    assert.equal(outcome.outcome, 'blocked', JSON.stringify(answer));
    assert.equal(outcome.authorization, undefined);
  }
});

test('a deny never reaches the approval layer', async () => {
  const w = makeWorld();
  let asked = false;
  const authorize = createPolicyGate({
    catalog: toolCatalog,
    store: w.store,
    getConfig: () => configWith(),
    requestApproval: async () => ((asked = true), { action: 'approve_once' }),
  });
  const outcome = await authorize({
    stepId: 's1',
    tool: 'send_email',
    args: {
      to: w.outsidePublic('x@evil.example'),
      subject: w.plainLiteral('s'),
      body: w.outsidePrivate('secret'),
    },
    control: [],
  });
  assert.equal(outcome.outcome, 'blocked');
  assert.equal(outcome.reason, 'denied');
  assert.equal(asked, false);
});
