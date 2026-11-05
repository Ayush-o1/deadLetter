import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY,
  PUBLIC,
  ProvenanceStore,
  TRUSTED,
  UNTRUSTED,
  createLabel,
  isValue,
  list,
  quarantineLabel,
  record,
  restricted,
  scalar,
} from '../../src/core/labels/index.js';

const emailBody = createLabel({
  integrity: UNTRUSTED,
  readers: restricted([]),
  sources: ['email:msg-2'],
});

test('a literal is trusted, public, and remembers its source', () => {
  const store = new ProvenanceStore();
  const v = store.literal('alice@example.com', { source: 'user_request' });
  assert.equal(v.label.integrity, TRUSTED);
  assert.equal(v.label.readers.kind, 'public');
  assert.deepEqual(v.label.sources, ['user_request']);
  assert.deepEqual(v.origin, { kind: 'literal', name: 'user_request' });
  assert.equal(v.id, 'v1');
});

test('a tool result carries exactly the label its adapter declared', () => {
  const store = new ProvenanceStore();
  const v = store.fromTool(scalar('Hello there', emailBody), { tool: 'read_email' });
  assert.deepEqual(v.label, emailBody);
  assert.equal(v.origin.name, 'read_email');
});

test('a summary made from an email inherits the email label (spec section 4)', () => {
  const store = new ProvenanceStore();
  const body = store.fromTool(scalar('long text', emailBody), { tool: 'read_email' });
  const summary = store.derive({
    data: 'short',
    parents: [body],
    op: 'quarantine:summarize',
    extra: quarantineLabel('summarize'),
  });
  assert.equal(summary.label.integrity, UNTRUSTED);
  assert.equal(summary.label.readers.kind, 'restricted');
  assert.deepEqual(summary.label.readers.principals, []);
  assert.deepEqual(summary.label.sources, ['email:msg-2', 'quarantine:summarize']);
  assert.deepEqual(summary.parents, [body.id]);
});

test('mixing a trusted value with an untrusted one gives an untrusted value', () => {
  const store = new ProvenanceStore();
  const typed = store.literal('Subject: ', { source: 'user_request' });
  const body = store.fromTool(scalar('x', emailBody), { tool: 'read_email' });
  const joined = store.derive({ data: 'Subject: x', parents: [typed, body], op: 'concat' });
  assert.equal(joined.label.integrity, UNTRUSTED);
});

test('there is no way to hand derive a weaker label: extra can only add restrictions', () => {
  const store = new ProvenanceStore();
  const body = store.fromTool(scalar('x', emailBody), { tool: 'read_email' });
  const trustedPublic = createLabel({ integrity: TRUSTED, readers: PUBLIC });
  const v = store.derive({ data: 'y', parents: [body], op: 'op', extra: trustedPublic });
  assert.equal(v.label.integrity, UNTRUSTED);
  assert.equal(v.label.readers.kind, 'restricted');
});

test('control context taints values created under it, and is recorded as a dependency', () => {
  const store = new ProvenanceStore();
  const condition = store.derive({
    data: true,
    parents: [store.fromTool(scalar('urgent!', emailBody), { tool: 'read_email' })],
    op: 'quarantine:is_urgent',
    extra: quarantineLabel('is_urgent'),
  });
  const recipient = store.literal('bob@example.com', {
    source: 'user_request',
    control: [condition],
  });
  assert.equal(recipient.label.integrity, UNTRUSTED);
  assert.deepEqual(recipient.controlDeps, [condition.id]);
  // The condition's confidentiality leaks through which branch ran, so it carries over.
  assert.equal(recipient.label.readers.kind, 'restricted');

  const fromTool = store.fromTool(scalar('data', createLabel({ integrity: TRUSTED })), {
    tool: 'read_file',
    control: [condition],
  });
  assert.equal(fromTool.label.integrity, UNTRUSTED);
});

test('records keep a label per field; the record itself is the join', () => {
  const store = new ProvenanceStore();
  const trustedPublic = createLabel({ integrity: TRUSTED, sources: ['contacts'] });
  const mail = store.fromTool(
    record({
      from: scalar('bob@example.com', createLabel({ integrity: UNTRUSTED, sources: ['email:1'] })),
      body: scalar('text', emailBody),
      note: scalar('n', trustedPublic),
    }),
    { tool: 'read_email' },
  );
  assert.equal(store.field(mail, 'note').label.integrity, TRUSTED, 'field keeps its own label');
  assert.equal(store.field(mail, 'body').label.readers.kind, 'restricted');
  assert.equal(store.field(mail, 'from').label.readers.kind, 'public');
  assert.equal(mail.label.integrity, UNTRUSTED, 'whole record is the join');
  assert.equal(mail.label.readers.kind, 'restricted');
  assert.deepEqual(mail.data, { from: 'bob@example.com', body: 'text', note: 'n' });
});

test('lists keep a label per item', () => {
  const store = new ProvenanceStore();
  const l = store.fromTool(
    list([scalar('a', createLabel({ integrity: TRUSTED })), scalar('b', emailBody)]),
    { tool: 'list_emails' },
  );
  const [first, second] = store.items(l);
  assert.equal(first.label.integrity, TRUSTED);
  assert.equal(second.label.integrity, UNTRUSTED);
  assert.equal(l.label.integrity, UNTRUSTED);
});

test('field() and items() reject wrong shapes and missing names', () => {
  const store = new ProvenanceStore();
  const s = store.literal('x', { source: 'user_request' });
  assert.throws(() => store.field(s, 'a'), /not a record/);
  assert.throws(() => store.items(s), /not a list/);
  const r = store.fromTool(record({ a: scalar(1, IDENTITY) }), { tool: 't' });
  assert.throws(() => store.field(r, 'missing'), /no field/);
  assert.throws(() => store.field(r, 'toString'), /no field/, 'inherited names are not fields');
});

test('a field named __proto__ is just a field and does not pollute anything', () => {
  const store = new ProvenanceStore();
  const spec = record(
    JSON.parse(
      '{"__proto__": {"kind":"scalar","data":"x","label":{"integrity":"trusted","readers":{"kind":"public"},"sources":[]}}}',
    ),
  );
  const r = store.fromTool(spec, { tool: 't' });
  assert.equal(store.field(r, '__proto__').data, 'x');
  assert.equal({}.kind, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('values are immutable, including their data', () => {
  const store = new ProvenanceStore();
  const v = store.fromTool(scalar({ nested: ['a'] }, emailBody), { tool: 't' });
  assert.throws(() => {
    v.label = IDENTITY;
  }, TypeError);
  assert.throws(() => {
    v.data.nested.push('b');
  }, TypeError);
  assert.throws(() => {
    v.parents.push('v99');
  }, TypeError);
});

test('input data is copied: changing the original afterwards has no effect', () => {
  const store = new ProvenanceStore();
  const original = { text: 'a' };
  const v = store.fromTool(scalar(original, emailBody), { tool: 't' });
  original.text = 'changed';
  assert.equal(v.data.text, 'a');
});

test('lookalike objects are not values, and foreign values are rejected', () => {
  const store = new ProvenanceStore();
  const forged = {
    id: 'v1',
    data: 'x',
    label: createLabel({ integrity: TRUSTED }),
    intrinsic: IDENTITY,
    parents: [],
    controlDeps: [],
  };
  assert.equal(isValue(forged), false);
  assert.throws(() => store.derive({ data: 'y', parents: [forged], op: 'op' }), /not a value/);

  const other = new ProvenanceStore();
  const foreign = other.literal('x', { source: 'user_request' });
  assert.equal(isValue(foreign), true);
  assert.throws(
    () => store.derive({ data: 'y', parents: [foreign], op: 'op' }),
    /not a value of this run/,
  );
  assert.throws(
    () => store.literal('x', { source: 'user_request', control: [forged] }),
    /not a value/,
  );
});

test('derive requires a parent; constants must use literal()', () => {
  const store = new ProvenanceStore();
  assert.throws(() => store.derive({ data: 'x', parents: [], op: 'op' }), /at least one parent/);
});

test('tool adapters cannot pass a malformed label', () => {
  const store = new ProvenanceStore();
  const bad = { integrity: 'sort-of', readers: PUBLIC, sources: [] };
  assert.throws(() => store.fromTool(scalar('x', bad), { tool: 't' }), /integrity/);
  assert.throws(() => store.fromTool({ kind: 'weird' }, { tool: 't' }), /scalar\(\)/);
});

test('a long chain stays untrusted from the untrusted root to the end', () => {
  const store = new ProvenanceStore();
  let v = store.fromTool(scalar('x', createLabel({ integrity: UNTRUSTED })), { tool: 't' });
  for (let i = 0; i < 200; i++) {
    const clean = store.literal(`c${i}`, { source: 'user_request' });
    v = store.derive({ data: i, parents: [clean, v], op: 'step' });
  }
  assert.equal(v.label.integrity, UNTRUSTED);
  assert.equal(store.ancestors(v.id).length, 400);
});

test('ancestors() includes control dependencies and is ordered by creation', () => {
  const store = new ProvenanceStore();
  const a = store.literal('a', { source: 'user_request' });
  const cond = store.fromTool(scalar(true, emailBody), { tool: 't' });
  const b = store.literal('b', { source: 'user_request', control: [cond] });
  const c = store.derive({ data: 'ab', parents: [a, b], op: 'concat' });
  assert.deepEqual(store.ancestors(c.id), [a.id, cond.id, b.id]);
  assert.throws(() => store.ancestors('v999'), /Unknown value/);
});

test('toGraph() contains labels and edges but never data', () => {
  const store = new ProvenanceStore();
  const secret = store.fromTool(scalar('TOP-SECRET-CANARY', emailBody), { tool: 'read_file' });
  store.derive({ data: 'also TOP-SECRET-CANARY', parents: [secret], op: 'concat' });
  const json = JSON.stringify(store.toGraph());
  assert.doesNotMatch(json, /CANARY/);
  assert.match(json, /email:msg-2/);
  assert.equal(store.toGraph().nodes.length, 2);
});

test('toGraph(roots) returns only the roots and their ancestors', () => {
  const store = new ProvenanceStore();
  const a = store.literal('a', { source: 'user_request' });
  const unrelated = store.literal('z', { source: 'user_request' });
  const b = store.derive({ data: 'b', parents: [a], op: 'op' });
  const ids = store.toGraph([b.id]).nodes.map((n) => n.id);
  assert.deepEqual(ids, [a.id, b.id]);
  assert.ok(!ids.includes(unrelated.id));
});
