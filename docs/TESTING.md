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
  reference/     (phase 2) independent label checker
  security/      (later) regression tests for security behaviour
  e2e/           (later) full scenarios
```

## Coverage so far (phase 1)

| Area                                                              | File                                     |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Config defaults, coercion, every validation failure               | `test/unit/config.test.js`               |
| Test-database guard                                               | `test/unit/testDbGuard.test.js`          |
| Health, 404, bad JSON, oversize body, security headers            | `test/integration/http.test.js`          |
| Error handler hides internals, `AppError`, health when DB is down | `test/integration/errorHandling.test.js` |
| Database round trip, reset helper, enum rejection                 | `test/integration/database.test.js`      |

This file grows each phase; later sections will list the security regression
suite and the metamorphic tests.
