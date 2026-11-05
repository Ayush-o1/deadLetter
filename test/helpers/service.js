// A complete run service on mock models, fake tools and an in-memory repository.
import { createPlanner } from '../../src/core/models/planner.js';
import { createQuarantine } from '../../src/core/models/quarantine.js';
import {
  createMockPlannerProvider,
  createMockQuarantineProvider,
} from '../../src/core/models/providers/mock.js';
import { seedFixtures } from '../../src/core/tools/fixtures/seed.js';
import { createFakeTools } from '../../src/core/tools/adapters.js';
import { createWorld } from '../../src/core/tools/world.js';
import { toolCatalog } from '../../src/core/tools/specs.js';
import { ApprovalManager } from '../../src/runtime/approvals.js';
import { InMemoryRunRepository } from '../../src/runtime/memoryRepository.js';
import { createRunService } from '../../src/runtime/runner.js';
import { configWith } from './values.js';

export function makeService({
  fixtures = seedFixtures,
  plans = {},
  quarantineProvider = createMockQuarantineProvider(),
  plannerProvider = createMockPlannerProvider({ plans }),
  config = configWith(),
  repo = new InMemoryRunRepository(),
} = {}) {
  const worlds = [];
  const trusted = [];
  const errors = [];
  let tick = 0;
  const approvals = new ApprovalManager();
  const service = createRunService({
    planner: createPlanner({ provider: plannerProvider, catalog: toolCatalog }),
    quarantine: createQuarantine({ provider: quarantineProvider }),
    catalog: toolCatalog,
    createWorld: () => {
      const w = createWorld(fixtures);
      worlds.push(w);
      return w;
    },
    createTools: (world) => createFakeTools(world),
    getPolicyConfig: () => config,
    onTrustDestination: (d) => trusted.push(d),
    approvals,
    repo,
    now: () => new Date(Date.UTC(2026, 10, 5, 12, 0, tick++)),
    newId: (() => {
      let n = 0;
      return () => `run-${++n}`;
    })(),
    logger: { error: (...a) => errors.push(a) },
  });
  return { service, repo, approvals, worlds, trusted, errors, world: () => worlds.at(-1) };
}

export async function untilApproval(service, runId) {
  for (let i = 0; i < 50; i++) {
    const snap = await service.get(runId);
    if (snap.pendingApprovals.length > 0) return snap;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('no approval appeared');
}

export const REQUEST_A = "Read Bob's latest email, summarise it, and send the summary to Alice.";
export const REQUEST_D = 'Read brief.txt and email its summary to the project lead.';
