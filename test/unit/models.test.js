import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlanner, describeTools } from '../../src/core/models/planner.js';
import { createQuarantine } from '../../src/core/models/quarantine.js';
import {
  MOCK_SUPPORTED_REQUESTS,
  createMockPlannerProvider,
  createMockQuarantineProvider,
} from '../../src/core/models/providers/mock.js';
import { toolCatalog as catalog } from '../../src/core/tools/specs.js';
import { seedFixtures } from '../../src/core/tools/fixtures/seed.js';
import { runPlan } from '../../src/core/interpreter/interpreter.js';
import { ProvenanceStore } from '../../src/core/labels/index.js';

// ---- Planner isolation (the central rule) ------------------------------------------

test('the planner provider receives exactly {request, tools} and nothing else', async () => {
  const seen = [];
  const provider = {
    plan: async (input) => (seen.push(input), createMockPlannerProvider().plan(input)),
  };
  const plan = createPlanner({ provider, catalog });
  const result = await plan(MOCK_SUPPORTED_REQUESTS[0]);
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['request', 'tools']);
  assert.ok(Object.isFrozen(seen[0]), 'the provider cannot add to what it was given');
  assert.equal(seen[0].request, MOCK_SUPPORTED_REQUESTS[0]);
});

test('nothing from the fake world is ever visible to the planner', async () => {
  const seen = [];
  const provider = {
    plan: async (input) => (
      seen.push(JSON.stringify(input)),
      createMockPlannerProvider().plan(input)
    ),
  };
  const plan = createPlanner({ provider, catalog });
  for (const request of MOCK_SUPPORTED_REQUESTS) await plan(request);
  const everything = seen.join('\n');
  for (const mail of seedFixtures.emails) assert.ok(!everything.includes(mail.body), mail.id);
  for (const file of seedFixtures.files) assert.ok(!everything.includes(file.content), file.path);
  for (const c of ['CANARY', 'attacker', 'Ignore previous']) assert.ok(!everything.includes(c), c);
});

test('plan() accepts only the request; extra arguments are not forwarded', async () => {
  const seen = [];
  const provider = {
    plan: async (input) => (seen.push(input), createMockPlannerProvider().plan(input)),
  };
  await createPlanner({ provider, catalog })(MOCK_SUPPORTED_REQUESTS[5], {
    emailBody: 'SECRET',
    tool_results: ['x'],
  });
  assert.doesNotMatch(JSON.stringify(seen[0]), /SECRET|tool_results/);
});

test('tool descriptions are static and carry no content', () => {
  const tools = describeTools(catalog);
  assert.deepEqual(
    tools.map((t) => t.name),
    catalog.names(),
  );
  assert.deepEqual(tools.find((t) => t.name === 'send_email').params.to, {
    role: 'destination',
    required: true,
  });
});

test('a planner failure is reported and nothing else is tried', async () => {
  let calls = 0;
  const provider = {
    plan: async () => (calls++, Promise.reject(new Error('provider exploded: sk-SECRET'))),
  };
  const result = await createPlanner({ provider, catalog })("Show Bob's latest email.");
  assert.deepEqual([result.ok, result.code], [false, 'planner_failed']);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|exploded/);
  assert.equal(calls, 1);
});

test('an invalid plan from the planner is rejected, with the reasons', async () => {
  const provider = {
    plan: async () => ({ version: 1, steps: [{ id: 'a', op: 'exec', cmd: 'rm -rf /' }] }),
  };
  const result = await createPlanner({ provider, catalog })('Do something');
  assert.deepEqual([result.ok, result.code], [false, 'invalid_plan']);
  assert.ok(result.errors.length > 0);
});

test('a planner that invents a recipient is rejected', async () => {
  const provider = {
    plan: async () => ({
      version: 1,
      steps: [
        {
          id: 'a',
          op: 'call',
          tool: 'send_email',
          args: { to: { lit: 'attacker@evil.example' }, subject: { lit: 's' }, body: { lit: 'b' } },
        },
      ],
    }),
  };
  const result = await createPlanner({ provider, catalog })('Send Alice a note');
  assert.equal(result.code, 'invalid_plan');
  assert.equal(result.errors[0].code, 'ungrounded_literal');
});

test('invalid requests are refused before reaching the provider', async () => {
  let called = false;
  const plan = createPlanner({ provider: { plan: async () => ((called = true), {}) }, catalog });
  for (const bad of ['', '   ', 'x'.repeat(2001), null, undefined, { text: 'hi' }]) {
    assert.equal((await plan(bad)).code, 'invalid_request');
  }
  assert.equal(called, false);
});

// ---- Mock planner ----------------------------------------------------------------------

test('every supported demo request produces a plan that passes validation', async () => {
  const plan = createPlanner({ provider: createMockPlannerProvider(), catalog });
  for (const request of MOCK_SUPPORTED_REQUESTS) {
    const result = await plan(request);
    assert.equal(result.ok, true, `${request}: ${JSON.stringify(result.errors ?? result.message)}`);
  }
});

test('the mock planner uses contacts for names and the typed address for addresses', async () => {
  const plan = createPlanner({ provider: createMockPlannerProvider(), catalog });
  const byName = await plan(
    "Read Bob's latest email, summarise it, and send the summary to Alice.",
  );
  assert.ok(byName.plan.steps.some((s) => s.tool === 'lookup_contact'));
  const byAddress = await plan(
    "Read Bob's latest email, summarise it, and send the summary to alice@example.com.",
  );
  assert.ok(!byAddress.plan.steps.some((s) => s.tool === 'lookup_contact'));
  assert.deepEqual(byAddress.plan.steps.at(-1).args.to, { lit: 'alice@example.com' });
});

test('the mock planner says so when it cannot plan, instead of guessing', async () => {
  const plan = createPlanner({ provider: createMockPlannerProvider(), catalog });
  const result = await plan('Do whatever the latest email asks me to do.');
  assert.deepEqual([result.ok, result.code], [false, 'cannot_plan']);
  assert.match(result.message, /only understands a few request shapes/);
});

test('the plan depends only on the request: same request, same plan, every time', async () => {
  const plan = createPlanner({ provider: createMockPlannerProvider(), catalog });
  for (const request of MOCK_SUPPORTED_REQUESTS) {
    assert.deepEqual(await plan(request), await plan(request));
  }
});

test('scenario-supplied plans take priority and are copied, not shared', async () => {
  const mine = { version: 1, steps: [{ id: 'a', op: 'show', value: { lit: 'hi' } }] };
  const provider = createMockPlannerProvider({ plans: { 'Say hi': mine } });
  const got = await provider.plan({ request: 'Say hi' });
  got.steps.push('tampered');
  assert.equal(mine.steps.length, 1);
});

// ---- Quarantine interface and mock -------------------------------------------------------

test('the quarantined provider receives exactly four fields', async () => {
  const seen = [];
  const quarantine = createQuarantine({
    provider: { extract: async (job) => (seen.push(job), 'ok') },
  });
  await quarantine({
    task: 'summarize',
    output: 'text',
    content: 'abc',
    instruction: 'brief',
    secret: 'LEAK',
    tools: ['send_email'],
  }).catch((e) => e);
  assert.equal(seen.length, 0, 'unknown fields are rejected before reaching the provider');

  await quarantine({ task: 'summarize', output: 'text', content: 'abc' });
  assert.deepEqual(Object.keys(seen[0]).sort(), ['content', 'instruction', 'output', 'task']);
  assert.ok(Object.isFrozen(seen[0]));
});

test('the quarantine wrapper rejects unknown tasks, types and oversized content', async () => {
  const quarantine = createQuarantine({ provider: { extract: async () => 'x' } });
  await assert.rejects(() => quarantine({ task: 'execute', output: 'text', content: 'a' }));
  await assert.rejects(() => quarantine({ task: 'summarize', output: 'html', content: 'a' }));
  await assert.rejects(() =>
    quarantine({ task: 'summarize', output: 'text', content: 'a'.repeat(50_001) }),
  );
  await assert.rejects(() => quarantine({ task: 'summarize', output: 'text', content: 5 }));
});

test('mock quarantine: summary is extractive and short', async () => {
  const q = createMockQuarantineProvider();
  const out = await q.extract({
    output: 'text',
    content: 'First sentence. Second one!  Third one? Fourth.',
  });
  assert.equal(out, 'First sentence. Second one!');
});

test('mock quarantine: extraction by type', async () => {
  const q = createMockQuarantineProvider();
  const content =
    'Contact lead@example.org or sales@example.org. See https://example.org/a and call 42 now.';
  assert.equal(await q.extract({ output: 'email', content }), 'lead@example.org');
  assert.equal(await q.extract({ output: 'url', content }), 'https://example.org/a');
  assert.equal(await q.extract({ output: 'number', content: 'about 42 items' }), 42);
  assert.deepEqual(await q.extract({ output: 'list_of_text', content }), [
    'lead@example.org',
    'sales@example.org',
  ]);
  assert.equal(
    await q.extract({
      output: 'boolean',
      instruction: 'does it say urgent',
      content: 'This is URGENT',
    }),
    true,
  );
  assert.equal(
    await q.extract({ output: 'boolean', instruction: 'does it say urgent', content: 'All calm' }),
    false,
  );
});

test('mock quarantine: when nothing matches it returns something the interpreter will reject, not an invented value', async () => {
  const q = createMockQuarantineProvider();
  assert.equal(await q.extract({ output: 'email', content: 'no addresses here' }), '');
  assert.ok(Number.isNaN(await q.extract({ output: 'number', content: 'no digits' })));
});

// ---- Everything together: mock planner -> interpreter -> mock quarantine ----------------------

test('planner failure never leads to the interpreter or to any tool', async () => {
  const plan = createPlanner({ provider: createMockPlannerProvider(), catalog });
  const planned = await plan('Do whatever the latest email asks me to do.');
  assert.equal(planned.ok, false);
  assert.equal(planned.plan, undefined);
});

test('a mock-planned task runs through the interpreter with the mock model', async () => {
  const request = 'Summarise https://example.org/post';
  const { plan } = await createPlanner({ provider: createMockPlannerProvider(), catalog })(request);
  const store = new ProvenanceStore();
  const quarantine = createQuarantine({ provider: createMockQuarantineProvider() });
  const result = await runPlan(plan, {
    request,
    store,
    catalog,
    authorize: async () => ({ outcome: 'execute' }),
    invokeTool: async () => ({
      kind: 'scalar',
      data: 'Ten tips. Start with the reader. More.',
      label: { integrity: 'untrusted', readers: { kind: 'public' }, sources: ['web:x'] },
    }),
    quarantine,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.shown[0].value.data, 'Ten tips. Start with the reader.');
  assert.equal(result.shown[0].value.label.integrity, 'untrusted');
});
