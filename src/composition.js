// Wiring: builds the services the HTTP layer uses from configuration and a
// database. Everything is constructed here and passed in explicitly; nothing is a
// global, so tests can swap any part.
import { createPlanner } from './core/models/planner.js';
import { createQuarantine } from './core/models/quarantine.js';
import {
  createMockPlannerProvider,
  createMockQuarantineProvider,
} from './core/models/providers/mock.js';
import { createOpenAICompatibleProviders } from './core/models/providers/openaiCompatible.js';
import { seedFixtures } from './core/tools/fixtures/seed.js';
import { createFakeTools } from './core/tools/adapters.js';
import { toolCatalog } from './core/tools/specs.js';
import { createWorld } from './core/tools/world.js';
import { createPrismaEvalRepository } from './db/evalRepository.js';
import { createPrismaPolicyRepository } from './db/policyRepository.js';
import { createPrismaRunRepository } from './db/runRepository.js';
import { ApprovalManager } from './runtime/approvals.js';
import { createRunService } from './runtime/runner.js';

/**
 * @param {{ db: object, config: { model: object }, logger?: object, overrides?: object }} deps
 *   overrides: replace any repository or provider (used by tests)
 */
export function createServices({ db, config, logger = console, overrides = {} }) {
  const policy = overrides.policy ?? createPrismaPolicyRepository(db, toolCatalog, logger);
  const evals = overrides.evals ?? createPrismaEvalRepository(db);
  const repo = overrides.runRepo ?? createPrismaRunRepository(db);

  const m = config.model;
  const live =
    m.provider === 'openai_compatible'
      ? createOpenAICompatibleProviders({
          baseUrl: m.baseUrl,
          apiKey: m.apiKey,
          plannerModel: m.plannerModel,
          quarantineModel: m.quarantineModel,
        })
      : null;
  const plannerProvider = overrides.plannerProvider ?? live?.planner ?? createMockPlannerProvider();
  const quarantineProvider =
    overrides.quarantineProvider ?? live?.quarantine ?? createMockQuarantineProvider();

  const approvals = new ApprovalManager();
  const runs = createRunService({
    planner: createPlanner({ provider: plannerProvider, catalog: toolCatalog }),
    quarantine: createQuarantine({ provider: quarantineProvider }),
    catalog: toolCatalog,
    createWorld: () => createWorld(seedFixtures),
    createTools: (world) => createFakeTools(world),
    getPolicyConfig: () => policy.getConfig(),
    onTrustDestination: (destination) => policy.addTrusted(destination),
    approvals,
    repo,
    logger,
  });

  return {
    runs,
    approvals,
    policy,
    evals,
    meta: { modelProvider: m.provider },
    /** Startup work: default rules for new tools, and runs cut off by a restart. */
    async start() {
      await policy.seedDefaults();
      return runs.recoverInterrupted();
    },
  };
}
