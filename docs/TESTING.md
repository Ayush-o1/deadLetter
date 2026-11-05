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

| Policy engine: spec matrix, fail-closed rules, floor vs templates, control flow, fetch_url, explanations; **every combination of 5 destinations x 4 bodies x 3 control contexts x 4 templates against an independent oracle** | `test/unit/policyEngine.test.js` |
| Approval state machine: pause, answer once, bad answers, cancel | `test/unit/approvals.test.js` |
| Tool bypass attempts: no/forged/replayed/cross-tool/swapped-argument tokens, adapter table tampering, unknown approval answers, deny never asks | `test/security/toolBypass.test.js` |
| Interpreter + gate + approvals + invoker together: scenarios A, C, D (send once / trust / edit / reject / cancel) and a control-flow attack | `test/integration/policyPipeline.test.js` (uses `test/helpers/pipeline.js`) |

| Fake tools: label of every field, lookups, validation, egress recording, world isolation, canaries in private fixtures | `test/unit/fakeTools.test.js` |
| Models: planner receives exactly `{request, tools}` and no world data; failure/invalid/invented-recipient handling; mock planner coverage and determinism; quarantine isolation; mock extraction | `test/unit/models.test.js` |
| Live provider (stubbed fetch): request shapes, no tools offered to the quarantined model, delimiter escaping, error paths never leak the key | `test/unit/liveProvider.test.js` |
| Scenarios A, B, C, D, E and control flow through the real fake tools, checking what actually left the machine | `test/integration/fakeToolsPipeline.test.js` |

The security-critical tests were checked by deliberately breaking the code and
confirming they fail: a join that forgets untrusted inputs, a fail-open gate, a
control stack that omits the condition, a file that imports the value minting
function, an engine that stops denying private data to untrusted destinations,
one that stops asking for untrusted selectors or missing rules, a gate that
approves unrecognised answers, replayable tokens, and tokens that accept swapped
arguments. A planner that is handed extra data and a model module that imports the fake world were also caught. Each made at least one test fail.

This file grows each phase; later sections will list the security regression
suite and the metamorphic tests.
