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
(`--test-concurrency=1`) because they share that database. If you run `node --test`
on several database test files yourself, pass `--test-concurrency=1` too.

## Safety rule

Tests delete data. `test/helpers/testDb.js` refuses to run unless the database
name ends in `_test`, and a unit test checks that guard. Set `TEST_DATABASE_URL`
to use a different test database (CI does).

## Layout

```
test/
  helpers/       server and browser starters, test database, builders, a full wired pipeline
  unit/          pure functions: labels, plans, interpreter, policy, approvals, tools, models, config
  integration/   run service, repositories, policy pipeline, failure paths (database and HTTP)
  e2e/           the whole application over HTTP on PostgreSQL
  eval/          the evaluation: exact outcomes, leakage, metamorphic, reproducibility
  security/      regression tests for security behaviour: bypass attempts, architecture guards, local-only
  ui/            the real UI in Chrome: Run, Rules, History, Lab, XSS, accessibility, layout
  reference/     independent label checker (imports nothing from src/)
```

Coverage on `src/` is about 99% of lines. Every security-critical file (labels, the
interpreter, the policy engine, gate, tokens and tool invoker, audit and redaction) is at
or near 100%; the uncovered lines are start-up code and a few defensive branches.

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

| Run service: planning without a world, request-only planner, execute/pause/approve/reject/cancel, failures, restart recovery, concurrency | `test/integration/runner.test.js` (uses `test/helpers/service.js`) |
| Audit: **audit-before-action** (storage failure at "step started" and at the decision record), **privacy** (canary and full-text scan of every record ever saved), bounded previews, provenance graph has no full text | `test/integration/runner.test.js` |

| Evaluation: scenario set, identical worlds across defences, **exact outcomes** of 11 attacks and 9 benign tasks per defence, data-leakage test, reproducibility, summary equals counts of recorded runs, `EVALUATION.md` equals a fresh run | `test/eval/evaluation.test.js` |
| **Metamorphic**: 11 attacks x 8 rewordings x 2 simulated users leave deadLetter's plan, actions, decisions and status unchanged; clean-versus-attacked diff; custom attack playground | `test/eval/metamorphic.test.js` |

| Repositories: **one contract run against the in-memory and the Prisma implementation** (round trip, upsert, filters, pagination, status lookup, cascade); stored rules incl. fail-closed on a missing row and on corrupted rows; stored reports | `test/integration/repositories.test.js`, `policyRepository.test.js`, `database.test.js` |
| The whole application over HTTP on PostgreSQL: validation, scenarios A and D with approve/reject/edit/trust/cancel, rules taking effect, History search, restart recovery, flow graph, Lab, and a **database-wide scan for private content** | `test/e2e/api.test.js` (uses `test/helpers/app.js`) |

| The real UI in the installed Chrome (puppeteer-core): scenarios A and D through the screens, approve / reject / edit, Why? and the flow explorer, Rules and History, **XSS inertness** (markup in an email shows as text and never runs; the element builder refuses `style`, string handlers and external links), CSP violations, phone layout without sideways scroll, accessibility basics | `test/ui/ui.test.js` (skipped with a message if no Chrome is found; set `CHROME_PATH` to point at one) |

| The Lab in Chrome: scenario comparison and the clean-versus-attacked diff (only the surplus attacker action is flagged), normal-task costs, the playground with hostile text, the honest-limit note, **dashboard numbers cross-checked against the stored report**, table view, exports, earlier evaluations, phone layout | `test/ui/lab.test.js` |

| Failure paths: the pause cannot be recorded (approval withdrawn, nothing sent), the final save fails, an unreachable live model, memory bounded for many runs; the evaluation's worst-case model and undefended agent | `test/integration/failurePaths.test.js`, `test/unit/evalSupport.test.js` |
| **Local-only protection**: DNS rebinding (hostile Host), cross-site requests (foreign, `null` and mismatched-port Origin), accepted own origin and no-Origin clients | `test/security/localOnly.test.js` |

| **Audit privacy from every direction** (found in the final audit): private text used as a destination or a selector, in policy explanations and in tool errors, bounded to the documented preview limit; error messages never quote arguments; a run cancelled while planning stays cancelled | `test/security/auditLeakage.test.js`, `test/unit/fakeTools.test.js`, `test/unit/interpreter.test.js` |

| Accessibility regressions found in the final audit: badge secondary text keeps at least 4.5:1 contrast (computed from real styles); the flow diagram is a group of labelled buttons, not an image | `test/ui/a11y.test.js` |
| **A rehearsal of `docs/DEMO.md`**: performs the demo's steps in a real browser, asserts what the presenter is told to point at, and checks the guide's numbers against a fresh evaluation, so the guide cannot drift | `test/ui/demo.test.js` |

The end-to-end scenarios requested in the project brief map to tests as follows:

| Scenario                   | Test                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| normal email summarisation | `fakeToolsPipeline`: "E: a normal email..."; `runner`: "scenario A"                   |
| malicious email            | `fakeToolsPipeline`: "A: a malicious email..."                                        |
| malicious webpage          | `fakeToolsPipeline`: "B: a malicious web page..."                                     |
| private file leakage       | `fakeToolsPipeline`: "C: ..." (two tests); `runner`: "an attack run"                  |
| approval-required task     | `fakeToolsPipeline` and `runner`: "scenario D" (approve, trust, edit, reject, cancel) |
| normal benign task         | `runner`: "scenario A", "list() ..."                                                  |

The security-critical tests were checked by deliberately breaking the code and
confirming they fail: a join that forgets untrusted inputs, a fail-open gate, a
control stack that omits the condition, a file that imports the value minting
function, an engine that stops denying private data to untrusted destinations,
one that stops asking for untrusted selectors or missing rules, a gate that
approves unrecognised answers, replayable tokens, and tokens that accept swapped
arguments. A planner that is handed extra data, a model module that imports the fake world, a gate that stopped awaiting its decision record, and an interpreter that stopped awaiting the "step started" record were also caught (the last two only after the tests were made specific enough to notice). Each made at least one test fail. Mutation checks on the evaluation exposed two coverage gaps (no scenario exercised an untrusted _selector_; nothing tested a contact chosen by untrusted text being treated as user-named); both were closed by adding a scenario and a unit test.

This file grows each phase; later sections will list the security regression
suite and the metamorphic tests.
