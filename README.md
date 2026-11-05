# deadLetter

An action firewall for AI agents. An agent may read untrusted text (emails, web
pages, files), but that text cannot decide which tool runs or where private data
goes.

deadLetter is a scoped, measurable implementation of the CaMeL design
([Debenedetti et al., arXiv:2503.18813](https://arxiv.org/abs/2503.18813)). It is
a research-oriented local prototype with fake tools, not a production security
product. See [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for exactly what it does
and does not claim.

> **Status: under construction.** The foundation (server, database, tests) is
> in place. The security engine, UI and evaluation are built phase by phase; see
> [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) for what exists today.

## How it works, briefly

1. A **planner** sees only your request and writes a short, validated plan.
2. A **quarantined model** reads untrusted text for narrow jobs (summarise,
   extract). It has no tools.
3. An **interpreter** runs the plan. Every value carries **labels**: where it
   came from, who may receive it, whether it is trusted.
4. A **policy engine** checks every tool call against those labels and answers
   allow, deny or ask.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 22.18+ or 24.11+ (`.nvmrc` pins 24)
- PostgreSQL 14+ running locally

## Setup

```bash
git clone https://github.com/Ayush-o1/deadLetter.git
cd deadLetter
npm install                      # also generates the Prisma client
createdb deadletter_dev
cp .env.example .env             # then put your database user in DATABASE_URL
npm run db:deploy                # apply migrations
npm start                        # http://localhost:3000
```

Check it works: `curl localhost:3000/api/health` should print
`{"status":"ok","database":"connected"}`.

## Scripts

| Command                | What it does                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `npm start`            | run the server                                                |
| `npm run dev`          | run the server and restart on file changes                    |
| `npm test`             | create/migrate the `deadletter_test` database, then run tests |
| `npm run lint`         | ESLint                                                        |
| `npm run format:check` | Prettier check (`npm run format` to fix)                      |
| `npm run db:migrate`   | create a new migration during development                     |
| `npm run db:deploy`    | apply existing migrations                                     |

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Decisions](docs/DECISIONS.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Testing](docs/TESTING.md)
