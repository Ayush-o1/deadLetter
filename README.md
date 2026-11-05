# deadLetter

**An action firewall for AI agents.** An agent may read untrusted text (emails, web
pages, files), but that text cannot decide which tool runs or where your private data
goes.

deadLetter is a scoped, measurable implementation of the CaMeL design
([Debenedetti et al., _Defeating Prompt Injections by Design_, arXiv:2503.18813](https://arxiv.org/abs/2503.18813)),
built as a local prototype with fake tools. It is a research-oriented project, not a
production security product: see [what it does not guarantee](#limits).

![The Run screen: a task paused for a decision](docs/screenshots/run-approval.png)

## The idea in one minute

Prompt injection works because a language model has one input channel. Your request and
the email it just read arrive as the same kind of thing, so text inside the email can
act as an order. Filtering for "bad" text is a guess. deadLetter instead splits the
agent so the guess is not needed:

1. A **planner** sees only your request and writes a short, validated plan. It never
   sees an email, file or web page, so text inside them cannot change the plan.
2. A **quarantined model** reads untrusted text for narrow jobs (summarise, extract). It
   has no tools, and whatever it returns is marked untrusted.
3. An **interpreter** runs the plan. Every value carries a **label**: where it came
   from, who may receive it, and whether untrusted text had a hand in making it. Labels
   only ever get more restrictive as values combine.
4. A **policy engine** checks every tool call against those labels and answers **allow**,
   **deny** or **ask** (the run pauses and you decide).

The question moves from "is this text malicious?" to "where did this value come from, and
is it allowed to be used for this action?" The second question has an answer a program can
check.

```mermaid
flowchart LR
    U[Your request] --> P[Planner]
    P -->|validated plan| I[Interpreter]
    T[Email, file, web page<br/>untrusted] --> I
    I -->|text + one narrow task| Q[Quarantined model<br/>no tools]
    Q -->|value, always untrusted| I
    I -->|every tool call| E{Policy engine}
    E -->|allow| X[Tool]
    E -->|ask| H[You decide]
    E -->|deny| L[(Audit log)]
```

## What is in the box

| Screen      | What it does                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Run**     | Type a task, review the plan, watch each step with its labels and the rule that judged it, answer approval cards, read the result, open "Why?" and the information-flow trace. |
| **Rules**   | Turn tools on or off, pick a rule per tool, manage trusted destinations. The always-on rules are shown and cannot be disabled.                                                 |
| **History** | Every task, searchable by what the rules decided, with the full redacted audit trail.                                                                                          |
| **Lab**     | Run 20 prepared scenarios (11 attacks, 9 normal tasks) or your own attack against three defences, diff a clean run against an attacked one, and read the evaluation dashboard. |

![The Lab: the same attack against three defences](docs/screenshots/lab-scenario.png)

Everything uses **fake tools and a seeded dataset** (a mailbox, contacts, files, web
pages), so attacks are safe and every result is reproducible. Demo mode needs no API key.

## Results

On the 20 scenarios in this repository, with deterministic mock models and a worst case
in which the undefended agents obey any injected text (read the
[method and its limits](docs/EVALUATION.md) before quoting a number):

| Defence                                                 | Attacks that succeeded | Normal tasks completed |
| ------------------------------------------------------- | ---------------------- | ---------------------- |
| No defence                                              | 11 of 11               | 9 of 9                 |
| Session taint (block outbound after any untrusted read) | 0 of 11                | 4 of 9                 |
| **deadLetter**                                          | **1 of 11**            | **8 of 9**             |
| deadLetter, if the user approves every prompt           | 4 of 11                | (n/a)                  |

The one attack that gets through is a misleading summary sent to a recipient you allowed,
which the design does not claim to stop. The one task deadLetter cannot do is "do whatever
the email says", because it cannot be planned without reading the email first. Both are
listed, along with every false block, in [docs/EVALUATION.md](docs/EVALUATION.md).
`npm run eval` regenerates the report byte for byte.

## Requirements

- Node.js 22.18+ or 24.11+ (`.nvmrc` pins 24)
- PostgreSQL 14+ running locally
- Google Chrome or Chromium, only for the browser tests and `npm run screenshots`

## Setup

```bash
git clone https://github.com/Ayush-o1/deadLetter.git
cd deadLetter
npm install                      # also generates the Prisma client
createdb deadletter_dev
cp .env.example .env             # put your database user in DATABASE_URL
npm run db:deploy                # apply migrations
npm start                        # http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000>, pick an example task on the Run screen, and press **Make a
plan**. Try "Read brief.txt and email its summary to the project lead." to see an approval
card.

The server listens on the loopback interface only and answers only to loopback host
names, because there is no login. See [docs/DECISIONS.md](docs/DECISIONS.md) (D25) before
changing `HOST`.

### Using a live model (optional)

Demo mode understands ten request shapes. To plan arbitrary requests, point deadLetter at
any OpenAI-compatible chat endpoint (a hosted service or a local server) in `.env`:

```
MODEL_PROVIDER=openai_compatible
MODEL_BASE_URL=http://localhost:11434/v1
PLANNER_MODEL=your-model
```

The planner still sees only your request, the plan is validated the same way, and the
tools are still fake. The test suite and the evaluation never use a live model.

## Commands

| Command                | What it does                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm start`            | run the server                                                                                               |
| `npm run dev`          | run the server and restart on file changes                                                                   |
| `npm test`             | create/migrate `deadletter_test`, then run all tests (unit, integration, e2e, security, evaluation, browser) |
| `npm run eval`         | run every scenario against every defence, write `reports/`                                                   |
| `npm run screenshots`  | regenerate `docs/screenshots/` from the real UI (needs Chrome)                                               |
| `npm run lint`         | ESLint                                                                                                       |
| `npm run format:check` | Prettier check (`npm run format` to fix)                                                                     |
| `npm run db:migrate`   | create a migration during development                                                                        |
| `npm run db:deploy`    | apply existing migrations                                                                                    |

Tests use a separate database and refuse to run against any database whose name does not
end in `_test`. Browser tests skip with a message if no Chrome is found (set
`CHROME_PATH`).

## How it is built

```
src/core/       the security engine: labels, plans, interpreter, policy, tools, models
                (no Express, no database, no network: pure and unit-testable)
src/runtime/    run lifecycle, approvals, audit and redaction
src/eval/       scenarios, the three defences, metrics, reports
src/db/         Prisma repositories (PostgreSQL)
src/http/       Express routes, validation, error handling, local-only protection
public/         the browser app: plain HTML, CSS and ES modules, no build step
test/           unit, integration, e2e, security, evaluation, browser, and an
                independent reference implementation of the label rules
docs/           architecture, threat model, decisions, guides, evaluation
```

Notable engineering choices (each has a reasoned entry in
[docs/DECISIONS.md](docs/DECISIONS.md)):

- Plans are **JSON checked by a strict schema**, never generated code. Nothing is `eval`'d.
- Labels are created only by trusted code, only ever get **more restrictive**, and are
  checked against an **independent reference implementation** on thousands of random
  provenance graphs.
- A tool runs only with a **single-use authorization token** bound to the exact call, so
  "every call goes through the policy engine" is something a test attacks, not a convention.
- The audit record is written **before** the action it describes; if storage fails, the
  action does not happen. The log holds labels and short previews, never whole private text.
- The security tests were checked by **deliberately breaking the code** and confirming they
  fail; that process found and closed several gaps in the tests themselves.
- The UI builds DOM only through a helper that refuses unsafe attributes, under a CSP with
  no inline anything. Text from outside is always a text node.

## Documentation

| Document                                                   | Read it for                                      |
| ---------------------------------------------------------- | ------------------------------------------------ |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md)                   | how to use Run, Rules, History and Lab           |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | components and how they interact                 |
| [docs/POLICY_AND_LABELS.md](docs/POLICY_AND_LABELS.md)     | label semantics, propagation, the policy matrix  |
| [docs/INTERPRETER.md](docs/INTERPRETER.md)                 | the plan language and how it runs                |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)               | attacker assumptions, trust boundaries, limits   |
| [docs/EVALUATION.md](docs/EVALUATION.md)                   | scenarios, metrics, baselines, results, method   |
| [docs/TESTING.md](docs/TESTING.md)                         | test layout and the security regression coverage |
| [docs/API.md](docs/API.md)                                 | the HTTP API                                     |
| [docs/DECISIONS.md](docs/DECISIONS.md)                     | why things are the way they are                  |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | how the project was planned and built            |

## Limits

deadLetter is honest about what it does not do. The tests and the evaluation show
behaviour on the tested scenarios; they are not a proof.

- A **misleading summary** sent to a recipient you allowed is allowed by the rules.
- **Human approval can be mistaken**: a card cannot make anyone read it.
- **Wrong labels or wrong rules defeat the policy.** The reference checker catches mistakes
  in the label code, not wrong assumptions about a source.
- A **compromised planner, interpreter, tool or model provider** is outside the threat model.
- **Side channels** (timing, error behaviour) are not addressed beyond the direct
  control-flow case.
- The tools are **fakes**, so nothing here shows that a real Gmail or Drive integration
  would be safe.
- The evaluation uses **mock models** and a scenario set written by the same person who
  wrote the defence; its numbers are not comparable with published benchmarks.
- It is **single-user and local**. There are no accounts, and the host and origin checks
  narrow who can reach the API from a browser but are not authentication.

Not built, on purpose: real Gmail, Drive or Calendar; accounts or hosting; learned
policies; model-written explanations; a real MCP proxy; an attack generator. The optional
extras (policy checker, scoped trust, policy simulator, detector baseline) were deferred
until the 20 core features worked, and were not started.

## References

- Debenedetti et al., _Defeating Prompt Injections by Design_ (CaMeL), arXiv:2503.18813.
- Beurer-Kellner et al., _Design Patterns for Securing LLM Agents against Prompt Injections_, arXiv:2506.08837.
- Willison, "The lethal trifecta for AI agents".
- Debenedetti et al., _AgentDojo_ (benign utility, utility under attack, attack success rate).
