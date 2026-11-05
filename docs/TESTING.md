# Testing

Tests use Node's built-in runner (`node:test`) and `node:assert`. No network
model is ever needed.

## Commands

```bash
npm test               # prepares deadletter_test, then runs everything
npm run lint
npm run format:check
```

`npm test` first runs `scripts/prepare-test-db.js`, which creates the test
database if it is missing and applies migrations. Test files run one at a time
(`--test-concurrency=1`) because they share that database.

## Safety rule

Tests delete data. `test/helpers/testDb.js` refuses to run unless the database
name ends in `_test`, and a unit test checks that guard. Set `TEST_DATABASE_URL`
to use a different test database (CI does).

## Layout

```
test/
  helpers/       server starter, test database helpers
  unit/          pure functions: config, (later) labels, policy, plans
  integration/   HTTP + database
  reference/     independent label checker (imports nothing from src/)
  security/      (later) regression tests for security behaviour
  e2e/           (later) full scenarios
```

## Coverage so far

| Area                                                              | File                                     |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Config defaults, coercion, every validation failure               | `test/unit/config.test.js`               |
| Test-database guard                                               | `test/unit/testDbGuard.test.js`          |
| Health, 404, bad JSON, oversize body, security headers            | `test/integration/http.test.js`          |
| Error handler hides internals, `AppError`, health when DB is down | `test/integration/errorHandling.test.js` |
| Database round trip, reset helper, enum rejection                 | `test/integration/database.test.js`      |

| Label lattice: join laws, integrity, readers, sources, freezing, validation | `test/unit/label.test.js` |
| Provenance: literals, tool results, records/lists, control deps, forgery and immutability | `test/unit/provenance.test.js` |
| Production labels vs independent reference on 1000 random graphs; invariants; checker tamper detection | `test/unit/labelConsistency.test.js` |
| Structural guards: only `provenance.js` mints values; no `eval`/`child_process` in `src`; `core/` has no I/O imports | `test/security/architecture.test.js` |

Random tests use a seeded generator (`test/helpers/prng.js`); a failure message
includes the seed so the exact graph can be replayed.

| Plan validation: strict schema, scoping, grounding, limits, forbidden keys; plan preview; tool catalog | `test/unit/plan.test.js` |
| Interpreter: gate ordering and fail-closed behaviour, forged/foreign approved values, quarantine typing and failure, control flow, loops, limits, cancellation | `test/unit/interpreter.test.js` (uses `test/helpers/harness.js`) |

The security-critical tests were checked by deliberately breaking the code and
confirming they fail: a join that forgets untrusted inputs, a fail-open gate, a
control stack that omits the condition, a file that imports the value minting
function.

This file grows each phase; later sections will list the security regression
suite and the metamorphic tests.
