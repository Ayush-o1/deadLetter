# Decisions

Each entry: what we chose, why, and what it costs. "Research" marks an idea that
comes from the literature; "Choice" marks a decision made in this repository.

## D1. Plain JavaScript (ES modules), JSDoc for types

Choice. No TypeScript, React, Next.js or Tailwind, as requested. Shared shapes
(`Label`, `Value`, `Decision`) are documented with JSDoc `@typedef` so editors
help without a compile step. Cost: no static checking.

## D2. Node `^22.18 || ^24.11`, built-in test runner

Choice. These are the Node versions Prisma 7 supports, and both run
TypeScript-syntax files without a flag (needed by D3). `node:test` and
`node:assert` cover unit, integration and e2e tests, so there is no test
framework dependency. Coverage uses `--experimental-test-coverage`.

## D3. Prisma 7.10.1 with `@prisma/adapter-pg`

Choice. Prisma 8 is only a release candidate, so we pin the latest stable 7.x.
Prisma 7's `prisma-client` generator emits `.ts` files and requires a driver
adapter. A spike (outside the repo) confirmed Node 24 loads the generated client
from plain JS with enums, `Json` columns and the pg adapter. The generated
client is gitignored and produced by `npm run db:generate`. Prisma 7 no longer
runs `generate` after `migrate dev`, so the scripts call it explicitly.
Risk: relies on Node's type stripping for generated files only; if that breaks,
the fallback is `prisma-client-js`.

## D4. Zod 4 for validation

Choice. One dependency validates three untrusted boundaries: HTTP bodies, plans
from the planner, and output from the quarantined model. Strict objects reject
unknown keys. Hand-rolled validators for three boundaries would be more code and
more places for bugs.

## D5. Plans are JSON, not generated code

Research (CaMeL uses a restricted Python subset) + Choice (we use JSON).
A JSON plan validated by a schema needs no parser, cannot contain `eval`, and
every op is an explicit allow-list entry. Cost: less expressive than a Python
subset; no functions, no arithmetic. The spec's tasks do not need them.

## D6. Labels: sources, parents, readers, integrity

Research (capabilities in CaMeL; information-flow control). Two axes:
integrity (`trusted`/`untrusted`) and confidentiality (`readers`: `public` or a
finite set). Propagation takes the most restrictive of the inputs: integrity is
untrusted if any input is, readers are intersected. `parents` are kept so the
flow explorer and the reference checker can walk the graph.

## D7. Grounding rule for destination literals

Choice. A literal in a plan that names an address, URL or path must appear
verbatim in the user's request; otherwise validation fails. This turns "the
planner is trusted" into something mechanical for the one place it matters most,
and implements the spec's "naming a recipient in your request is permission".
Cost: a paraphrased request (e.g. a nickname) fails unless it resolves through
`lookup_contact`, where the contact _name_ must appear in the request.

## D8. Policy = non-overridable floor + per-tool template; stricter wins

Choice. Floor rules (tool not in the catalog, disabled tool, no rule configured,
untrusted selector or destination, untrusted control dependence) cannot be
turned off from the Rules tab. A tool that is not in the catalog is denied; a
known tool with no rule asks, as the product spec requires. Templates are configurable. Final decision = max severity
(`allow < ask < deny`). Missing configuration can therefore only make a decision
stricter, never looser.

## D9. Control-flow protection with a control label

Research (program-counter labels in IFC; CaMeL's strict mode). The interpreter
tracks the labels of conditions it is branching or looping on. Calls inside are
raised to at least `ask`; values created inside are untrusted and have the
condition as a parent. Cost: some benign conditional plans will ask.

## D10. Approvals are in-memory; restart interrupts waiting runs

Choice. A pending approval is a promise the interpreter awaits. Persisting a
resumable interpreter (labelled value graph and position) is possible, but is
extra machinery for a single-user local tool. On startup, runs left in
`awaiting_approval` are marked `interrupted`. Documented limitation.

## D11. Polling, not server-sent events

Choice. The Run tab polls `GET /api/runs/:id` while a run is active. Simple,
inspectable with curl, easy to test. Can be swapped later without changing the
engine.

## D12. Deterministic mock models; live provider optional

Choice. The security test suite and evaluation never call a network model.
The mock planner maps registered requests to plans; the mock quarantined model
returns deterministic typed values. For evaluation, the unprotected and
session-taint agents use a **worst-case fooled model** that always performs the
scenario's declared attacker goal after reading the injected content. So the
numbers measure whether the _architecture_ stops an action, not how easily a
particular LLM is fooled. A live provider (OpenAI-compatible HTTP, so it also
works with local servers) is added behind the same interface in phase 5, and its
use is never required by tests. No API access is assumed: the project must be
fully usable with the mock provider.

### D12a. Mock planner scope

The mock planner is a fixed set of request patterns, not a model. It exists so
the whole product runs and is testable without any API. A request outside those
patterns is reported as `cannot_plan` rather than guessed. The live provider is
how arbitrary requests work, with the same validation applied to its plans.

## D13. Few dependencies; no helmet, no dotenv

Choice. Runtime: `express`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `zod`.
Env files load with Node's `process.loadEnvFile()`. The few security headers we
need (CSP, `X-Content-Type-Options`, `Referrer-Policy`) are one small
middleware, so what they do is visible. Dev: `eslint`, `@eslint/js`, `globals`,
`prettier`. ESLint is pinned to 9.39.5 rather than 10.x: `npm audit` reported a
`minimatch` denial-of-service advisory in the 10.x dependency tree with no fix
inside 10.x, and 9.x is clean. Revisit when 10.x updates.

## D14. Audit log stores labels and short previews

Choice. Previews are truncated to a few dozen characters and values with
restricted readers get a shorter preview. Complete private bodies are never
written. A canary-string test enforces this. Cost: the log alone cannot
reconstruct a run's content; for that, see the bounded result preview on `Run`.

## D15. Local-first, single process

Choice. No Docker, Redis or queues. PostgreSQL is the one external service. Tests
use a separate database (`deadletter_test`).

## D16. One agent harness, three guards, in the evaluation

Choice. `none`, `session_taint` and `deadletter` run the same scenarios, tools and
success predicates. Only the guard differs, so a difference in outcome is
attributable to the defence.

## D17. `fetch_url` is treated as a possible data exit

Choice. A GET can exfiltrate through its query string. The URL is a destination
argument. An untrusted URL asks; a URL derived from private data is denied.

## D18. A tool's result inherits the labels of the arguments that selected it

Choice (standard information-flow reasoning). Without this, an attacker-chosen
contact name would return a "trusted" address. The cost is more provenance
edges; a side effect is that the sources of a result include the user's own
literal that selected it (for example `user_request`). Because of that,
"named by the user" (D19) is decided from how a value was created, not from its
sources.

## D19. "Named by the user" is decided from a value's origin

Choice. The spec says naming a recipient in the request is permission for that
recipient to receive the data. A destination is _named_ if it is a literal from
the request, an address typed during approval, or a field returned by a tool the
catalog marks as the user's own directory. A trusted address from some other
trusted source is not named, so private data to it asks. Labels are never
edited to express this, so no label bug can widen who may receive data.

## D20. Authorization tokens bind a call to the policy decision

Choice. The gate mints a single-use token bound to the tool and the identities
of its argument values; the tool invoker consumes it. This turns "every call goes
through the policy engine" from a convention into something a test can attack
(forged, replayed, swapped-argument and cross-tool tokens are all rejected).
Only `policy/gate.js` may mint and only `tools/invoke.js` may consume; a test
checks the imports.

## Open questions (decide at the phase named)

- Phase 5: which live provider to document first. Needs an API key from the user.
- Phase 7: whether to add the optional policy checker (spec order: checker, scoped
  trust, simulator, detector). Nothing optional starts before the 20 core
  features work.
