import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY,
  PUBLIC,
  TRUSTED,
  UNTRUSTED,
  atLeastAsRestrictive,
  canReceive,
  createLabel,
  intersectReaders,
  isPrivate,
  isTrusted,
  joinLabels,
  labelsEqual,
  quarantineLabel,
  restricted,
  serializeLabel,
} from '../../src/core/labels/index.js';
import { createRng } from '../helpers/prng.js';

const label = (integrity, readers = PUBLIC, sources = []) =>
  createLabel({ integrity, readers, sources });

test('restricted() normalises, de-duplicates and sorts principals', () => {
  const r = restricted([' Bob@X.com', 'alice@x.com', 'bob@x.com']);
  assert.deepEqual(r.principals, ['alice@x.com', 'bob@x.com']);
});

test('restricted([]) means "the user only" and is private', () => {
  const l = label(TRUSTED, restricted([]));
  assert.equal(isPrivate(l), true);
  assert.equal(canReceive(l, 'alice@x.com'), false);
});

test('a public label can be received by anyone and is not private', () => {
  const l = label(TRUSTED);
  assert.equal(isPrivate(l), false);
  assert.equal(canReceive(l, 'anyone@x.com'), true);
});

test('canReceive compares principals case-insensitively', () => {
  const l = label(TRUSTED, restricted(['alice@x.com']));
  assert.equal(canReceive(l, 'ALICE@x.com'), true);
});

test('createLabel rejects bad integrity, bad sources and forged readers', () => {
  assert.throws(() => createLabel({ integrity: 'mostly-trusted' }), /integrity/);
  assert.throws(() => createLabel({ integrity: TRUSTED, sources: [''] }), /sources/);
  assert.throws(
    () => createLabel({ integrity: TRUSTED, readers: { kind: 'everyone' } }),
    /readers/,
  );
  assert.throws(() => restricted(['']), /principal/);
  assert.throws(() => restricted([42]), /principal/);
});

test('labels are frozen', () => {
  const l = label(TRUSTED, restricted(['a@x.com']), ['s']);
  assert.throws(() => {
    l.integrity = TRUSTED;
  }, TypeError);
  assert.throws(() => l.readers.principals.push('evil@x.com'), TypeError);
  assert.throws(() => l.sources.push('forged'), TypeError);
});

test('integrity: untrusted wins in any combination, in any order', () => {
  const t = label(TRUSTED);
  const u = label(UNTRUSTED);
  assert.equal(joinLabels(t, u).integrity, UNTRUSTED);
  assert.equal(joinLabels(u, t).integrity, UNTRUSTED);
  assert.equal(joinLabels(t, t, t, u, t).integrity, UNTRUSTED);
  assert.equal(joinLabels(t, t).integrity, TRUSTED);
});

test('a trusted value never makes an untrusted result trusted', () => {
  const result = joinLabels(label(UNTRUSTED), IDENTITY, label(TRUSTED, restricted(['a@x.com'])));
  assert.equal(isTrusted(result), false);
});

test('readers: public ∩ X = X', () => {
  const x = restricted(['a@x.com']);
  assert.deepEqual(intersectReaders(PUBLIC, x), x);
  assert.deepEqual(intersectReaders(x, PUBLIC), x);
  assert.equal(intersectReaders(PUBLIC, PUBLIC).kind, 'public');
});

test('readers: overlapping sets intersect', () => {
  const r = intersectReaders(
    restricted(['a@x.com', 'b@x.com']),
    restricted(['b@x.com', 'c@x.com']),
  );
  assert.deepEqual(r.principals, ['b@x.com']);
});

test('readers: disjoint sets collapse to "user only", never to public', () => {
  const r = intersectReaders(restricted(['a@x.com']), restricted(['b@x.com']));
  assert.equal(r.kind, 'restricted');
  assert.deepEqual(r.principals, []);
});

test('readers: mixing a private value with a public one stays private', () => {
  const joined = joinLabels(label(TRUSTED, restricted(['a@x.com'])), label(TRUSTED));
  assert.equal(isPrivate(joined), true);
  assert.deepEqual(joined.readers.principals, ['a@x.com']);
});

test('sources accumulate, sorted and de-duplicated', () => {
  const joined = joinLabels(
    label(TRUSTED, PUBLIC, ['file:b', 'email:1']),
    label(UNTRUSTED, PUBLIC, ['email:1', 'user_request']),
  );
  assert.deepEqual(joined.sources, ['email:1', 'file:b', 'user_request']);
});

test('IDENTITY is neutral and joining nothing gives IDENTITY', () => {
  const l = label(UNTRUSTED, restricted(['a@x.com']), ['s']);
  assert.ok(labelsEqual(joinLabels(l, IDENTITY), l));
  assert.ok(labelsEqual(joinLabels(), IDENTITY));
});

test('quarantineLabel is untrusted, public, and names its task', () => {
  const q = quarantineLabel('summarize');
  assert.equal(q.integrity, UNTRUSTED);
  assert.equal(q.readers.kind, 'public');
  assert.deepEqual(q.sources, ['quarantine:summarize']);
});

test('atLeastAsRestrictive: ordering examples', () => {
  const trustedPublic = label(TRUSTED);
  const untrustedPublic = label(UNTRUSTED);
  const untrustedPrivate = label(UNTRUSTED, restricted([]));
  assert.equal(atLeastAsRestrictive(untrustedPublic, trustedPublic), true);
  assert.equal(atLeastAsRestrictive(trustedPublic, untrustedPublic), false);
  assert.equal(atLeastAsRestrictive(untrustedPrivate, untrustedPublic), true);
  assert.equal(atLeastAsRestrictive(untrustedPublic, untrustedPrivate), false);
  // A larger reader set is less restrictive than a smaller one.
  assert.equal(
    atLeastAsRestrictive(
      label(TRUSTED, restricted(['a@x.com', 'b@x.com'])),
      label(TRUSTED, restricted(['a@x.com'])),
    ),
    false,
  );
});

test('serializeLabel gives plain JSON', () => {
  assert.deepEqual(serializeLabel(label(UNTRUSTED, restricted(['a@x.com']), ['s'])), {
    integrity: 'untrusted',
    readers: ['a@x.com'],
    sources: ['s'],
  });
  assert.equal(serializeLabel(label(TRUSTED)).readers, 'public');
});

// ---- Algebraic properties of join, checked on seeded random labels -----------

function randomLabel(rng) {
  const readers = rng.chance(0.4)
    ? PUBLIC
    : restricted(['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'].filter(() => rng.chance(0.5)));
  const sources = ['s1', 's2', 's3'].filter(() => rng.chance(0.4));
  return createLabel({ integrity: rng.chance(0.5) ? TRUSTED : UNTRUSTED, readers, sources });
}

test('join is commutative, associative and idempotent (2000 random triples)', () => {
  const rng = createRng(2026);
  for (let i = 0; i < 2000; i++) {
    const [a, b, c] = [randomLabel(rng), randomLabel(rng), randomLabel(rng)];
    assert.ok(labelsEqual(joinLabels(a, b), joinLabels(b, a)), 'commutative');
    assert.ok(
      labelsEqual(joinLabels(joinLabels(a, b), c), joinLabels(a, joinLabels(b, c))),
      'associative',
    );
    assert.ok(labelsEqual(joinLabels(a, a), a), 'idempotent');
  }
});

test('a join is always at least as restrictive as each input (2000 random pairs)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 2000; i++) {
    const [a, b] = [randomLabel(rng), randomLabel(rng)];
    const j = joinLabels(a, b);
    assert.ok(atLeastAsRestrictive(j, a));
    assert.ok(atLeastAsRestrictive(j, b));
  }
});
