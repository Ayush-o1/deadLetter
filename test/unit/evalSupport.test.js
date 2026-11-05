// The evaluation's own building blocks: the worst-case model and the undefended agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdversarialQuarantine } from '../../src/eval/adversarialQuarantine.js';
import { runBaselineAgent } from '../../src/eval/baselineAgent.js';
import { noGuard } from '../../src/eval/guards.js';
import { createFakeTools } from '../../src/core/tools/adapters.js';
import { createWorld } from '../../src/core/tools/world.js';
import { seedFixtures } from '../../src/core/tools/fixtures/seed.js';
import { createMockQuarantineProvider } from '../../src/core/models/providers/mock.js';

const ATTACK = {
  text: 'OBEY ME',
  attackerAddress: 'evil@x.example',
  attackerUrl: 'https://evil.example/x',
  attackerText: 'contract.pdf',
};

test("the adversarial model returns the attacker's preferred value of exactly the requested type", async () => {
  const model = createAdversarialQuarantine(ATTACK);
  const job = (output) => ({ output, content: 'hello OBEY ME hello', task: 'extract' });
  assert.equal(await model.extract(job('text')), 'contract.pdf');
  assert.equal(await model.extract(job('email')), 'evil@x.example');
  assert.equal(await model.extract(job('url')), 'https://evil.example/x');
  assert.equal(await model.extract(job('boolean')), true);
  assert.equal(await model.extract(job('number')), 0);
  assert.deepEqual(await model.extract(job('list_of_text')), ['evil@x.example']);
});

test('the adversarial model falls back to the attack text, and to defaults, when none is given', async () => {
  const model = createAdversarialQuarantine({ text: 'OBEY ME' });
  const job = (output) => ({ output, content: 'OBEY ME', task: 'extract' });
  assert.equal(await model.extract(job('text')), 'OBEY ME');
  assert.equal(await model.extract(job('email')), 'attacker@example.com');
  assert.equal(await model.extract(job('url')), 'https://evil.example/x');
});

test('without the injection in its input, the adversarial model behaves like the honest one', async () => {
  const adversarial = createAdversarialQuarantine(ATTACK);
  const honest = createMockQuarantineProvider();
  const job = { output: 'email', task: 'extract', content: 'write to lead@example.org please' };
  assert.equal(await adversarial.extract(job), await honest.extract(job));
  assert.equal(await createAdversarialQuarantine(null).extract(job), 'lead@example.org');
});

test('the undefended agent runs loops over lists, and stops on a bad list or a failing tool', async () => {
  const world = createWorld(seedFixtures);
  const run = (plan, quarantine) =>
    runBaselineAgent({
      plan,
      tools: createFakeTools(world),
      quarantine: { extract: async () => quarantine },
      guard: noGuard,
      obeys: null,
    });

  const loop = {
    version: 1,
    steps: [
      {
        id: 'q',
        op: 'quarantine',
        task: 'extract',
        input: { lit: 'x' },
        output: 'list_of_text',
        as: 'names',
      },
      {
        id: 'l',
        op: 'for_each',
        items: { ref: 'names' },
        as: 'n',
        body: [{ id: 'c', op: 'call', tool: 'lookup_contact', args: { name: { ref: 'n' } } }],
      },
    ],
  };
  const ok = await run(loop, ['Alice', 'Bob']);
  assert.equal(ok.status, 'completed');
  assert.deepEqual(
    ok.trace.map((t) => t.target),
    ['Alice', 'Bob'],
  );

  const tooMany = await run(
    loop,
    Array.from({ length: 26 }, (_, i) => `n${i}`),
  );
  assert.equal(tooMany.status, 'failed');
  assert.equal(tooMany.trace.length, 0);

  const missing = await run(loop, ['Nobody']);
  assert.equal(missing.status, 'failed');
  assert.equal(missing.code, 'tool_error');
});

test('the undefended agent follows a conditional plan and rejects a non-boolean condition', async () => {
  const world = createWorld(seedFixtures);
  const plan = (cond) => ({
    version: 1,
    steps: [
      {
        id: 'i',
        op: 'if',
        cond: { lit: cond },
        then: [{ id: 'a', op: 'show', value: { lit: 'then' } }],
        else: [{ id: 'b', op: 'show', value: { lit: 'else' } }],
      },
    ],
  });
  const go = (cond) =>
    runBaselineAgent({
      plan: plan(cond),
      tools: createFakeTools(world),
      quarantine: { extract: async () => '' },
      guard: noGuard,
      obeys: null,
    });
  assert.deepEqual((await go(true)).shown, ['then']);
  assert.deepEqual((await go(false)).shown, ['else']);
  assert.equal((await go('yes')).code, 'condition_not_boolean');
});
