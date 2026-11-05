// Consistency tests: the production label code versus the independent reference
// checker (test/reference/labelChecker.js), on thousands of random provenance
// graphs. The seed is printed on failure so a failing graph can be replayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC,
  ProvenanceStore,
  TRUSTED,
  UNTRUSTED,
  createLabel,
  list,
  quarantineLabel,
  record,
  restricted,
  scalar,
} from '../../src/core/labels/index.js';
import { findMismatches } from '../reference/labelChecker.js';
import { createRng } from '../helpers/prng.js';

const PRINCIPALS = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'];

function randomLeafLabel(rng, n) {
  const readers = rng.chance(0.45) ? PUBLIC : restricted(PRINCIPALS.filter(() => rng.chance(0.55)));
  return createLabel({
    integrity: rng.chance(0.6) ? TRUSTED : UNTRUSTED,
    readers,
    sources: [`src${n % 7}`],
  });
}

/** Build a random graph using every creation path the store offers. */
function randomStore(seed) {
  const rng = createRng(seed);
  const store = new ProvenanceStore();
  const values = [];
  const count = 10 + rng.int(40);

  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    const pickSome = (max) => {
      const n = 1 + rng.int(max);
      return Array.from({ length: n }, () => rng.pick(values));
    };
    const control = values.length > 0 && rng.chance(0.25) ? pickSome(2) : [];

    if (values.length === 0 || roll < 0.25) {
      values.push(store.fromTool(scalar(`d${i}`, randomLeafLabel(rng, i)), { tool: 't', control }));
    } else if (roll < 0.35) {
      values.push(store.literal(`lit${i}`, { source: 'user_request', control }));
    } else if (roll < 0.43) {
      values.push(
        store.fromTool(
          record({
            a: scalar(1, randomLeafLabel(rng, i)),
            b: scalar(2, randomLeafLabel(rng, i + 1)),
          }),
          { tool: 't', control },
        ),
      );
    } else if (roll < 0.5) {
      values.push(
        store.fromTool(
          list([scalar(1, randomLeafLabel(rng, i)), scalar(2, randomLeafLabel(rng, i + 3))]),
          {
            tool: 't',
            control,
          },
        ),
      );
    } else {
      const extra = rng.chance(0.3) ? quarantineLabel('task') : undefined;
      values.push(store.derive({ data: `x${i}`, parents: pickSome(4), op: 'op', extra, control }));
    }
  }
  return store;
}

test('production labels equal the reference labels on 1000 random graphs', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const graph = randomStore(seed).toGraph();
    const mismatches = findMismatches(graph);
    assert.equal(mismatches.length, 0, `seed ${seed}: ${JSON.stringify(mismatches[0])}`);
  }
});

test('invariants, checked without using the production comparison code', () => {
  for (let seed = 5000; seed < 5300; seed++) {
    const { nodes } = randomStore(seed).toGraph();
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (const node of nodes) {
      for (const depId of [...node.parents, ...node.controlDeps]) {
        const dep = byId[depId].label;
        if (dep.integrity === 'untrusted') {
          assert.equal(
            node.label.integrity,
            'untrusted',
            `seed ${seed}: ${node.id} laundered ${depId}`,
          );
        }
        if (dep.readers !== 'public') {
          assert.notEqual(
            node.label.readers,
            'public',
            `seed ${seed}: ${node.id} widened ${depId}`,
          );
          for (const p of node.label.readers) {
            assert.ok(dep.readers.includes(p), `seed ${seed}: ${node.id} added reader ${p}`);
          }
        }
        for (const s of dep.sources) {
          assert.ok(node.label.sources.includes(s), `seed ${seed}: ${node.id} lost source ${s}`);
        }
      }
    }
  }
});

test('the checker can fail: it detects tampered labels', () => {
  // Pick a graph that has an untrusted, restricted, derived node to tamper with.
  let graph;
  let target;
  for (let seed = 1; seed < 200 && !target; seed++) {
    graph = structuredClone(randomStore(seed).toGraph());
    target = graph.nodes.find(
      (n) =>
        n.parents.length > 0 &&
        n.label.integrity === 'untrusted' &&
        n.label.readers !== 'public' &&
        n.label.readers.length > 0,
    );
  }
  assert.ok(target, 'test setup: need a suitable node');
  assert.equal(findMismatches(graph).length, 0, 'untampered graph is clean');

  const run = (mutate) => {
    const copy = structuredClone(graph);
    mutate(copy.nodes.find((n) => n.id === target.id).label);
    return findMismatches(copy);
  };
  assert.ok(run((l) => (l.integrity = 'trusted')).length > 0, 'laundered integrity');
  assert.ok(run((l) => (l.readers = 'public')).length > 0, 'widened to public');
  assert.ok(run((l) => l.readers.pop()).length > 0, 'dropped a reader');
  assert.ok(run((l) => l.sources.push('forged')).length > 0, 'forged source');
});

test('the checker rejects a graph that references an unknown node', () => {
  const graph = {
    nodes: [
      {
        id: 'v1',
        intrinsic: { integrity: 'trusted', readers: 'public', sources: [] },
        label: { integrity: 'trusted', readers: 'public', sources: [] },
        parents: ['v9'],
        controlDeps: [],
      },
    ],
  };
  assert.throws(() => findMismatches(graph), /unknown node/);
});
