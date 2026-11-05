// Runs one scenario against one defence and returns a uniform record.
//
// All three defences get the SAME request, the SAME world (built once from the
// scenario), the SAME plan (from the same planner) and the SAME quarantined model.
// Only the guard differs. The outcome is read from the fake world afterwards, not
// from anything the defence says about itself.
import { createPlanner } from '../core/models/planner.js';
import { createQuarantine } from '../core/models/quarantine.js';
import {
  createMockPlannerProvider,
  createMockQuarantineProvider,
} from '../core/models/providers/mock.js';
import { createFakeTools } from '../core/tools/adapters.js';
import { createWorld } from '../core/tools/world.js';
import { toolCatalog } from '../core/tools/specs.js';
import { defaultPolicyConfig, parsePolicyConfig } from '../core/policy/config.js';
import { ApprovalManager } from '../runtime/approvals.js';
import { InMemoryRunRepository } from '../runtime/memoryRepository.js';
import { createRunService } from '../runtime/runner.js';
import { createAdversarialQuarantine } from './adversarialQuarantine.js';
import { runBaselineAgent } from './baselineAgent.js';
import { createHash } from 'node:crypto';
import { buildFixtures } from './fixtures.js';
import { createSessionTaintGuard, noGuard } from './guards.js';
import { findLeaks, holds } from './predicates.js';

export const DEFENCES = Object.freeze(['none', 'session_taint', 'deadletter']);

const FINAL = new Set(['completed', 'blocked', 'failed', 'cancelled', 'interrupted']);
const config = parsePolicyConfig(defaultPolicyConfig(toolCatalog)).config;

const targetOf = (args) =>
  args.find((a) => a.role === 'destination' || a.role === 'selector')?.preview ?? null;

/** The model the undefended agent and deadLetter's quarantined model share in this scenario. */
function quarantineFor(scenario) {
  if (scenario.kind === 'attack' && scenario.injection) {
    return createAdversarialQuarantine({
      text: scenario.injection.text,
      attackerAddress: scenario.attack?.attackerAddress,
      attackerUrl: scenario.attack?.attackerUrl,
      attackerText: scenario.attack?.attackerText,
    });
  }
  return createMockQuarantineProvider();
}

/** What an obedient agent does after reading the injection, if anything. */
function obeysFor(scenario) {
  if (scenario.kind === 'attack' && scenario.injection && scenario.attack?.goal.length > 0) {
    return { text: scenario.injection.text, goal: scenario.attack.goal };
  }
  if (scenario.followsContent && scenario.injection) {
    return { text: scenario.injection.text, goal: scenario.followsContent.goal };
  }
  return null;
}

/** A plan for a task the planner cannot write: the obedient agent just reads, then does what it reads. */
const readOnlyPlan = (from) => ({
  version: 1,
  steps: [
    { id: 'read', op: 'call', tool: 'read_email', args: { from: { lit: from } }, as: 'mail' },
  ],
});

async function runBaseline(scenario, fixtures, guard) {
  const world = createWorld(fixtures);
  const planned = await createPlanner({
    provider: createMockPlannerProvider(),
    catalog: toolCatalog,
  })(scenario.request);
  let plan;
  if (planned.ok) plan = planned.plan;
  else if (scenario.followsContent) plan = readOnlyPlan(scenario.followsContent.readFrom);
  else return { world, status: 'plan_failed', code: planned.code, trace: [], shown: [], asks: 0 };

  const out = await runBaselineAgent({
    plan,
    tools: createFakeTools(world),
    quarantine: quarantineFor(scenario),
    guard,
    obeys: obeysFor(scenario),
  });
  return { world, ...out };
}

async function runDeadLetter(scenario, fixtures, userApproval) {
  const worlds = [];
  const approvals = new ApprovalManager();
  let n = 0;
  const service = createRunService({
    planner: createPlanner({ provider: createMockPlannerProvider(), catalog: toolCatalog }),
    quarantine: createQuarantine({ provider: quarantineFor(scenario) }),
    catalog: toolCatalog,
    createWorld: () => {
      const w = createWorld(fixtures);
      worlds.push(w);
      return w;
    },
    createTools: (w) => createFakeTools(w),
    getPolicyConfig: () => config,
    approvals,
    repo: new InMemoryRunRepository(),
    now: () => new Date(Date.UTC(2026, 0, 1)),
    newId: () => `eval-${++n}`,
    logger: { error() {} },
  });

  const created = await service.create(scenario.request);
  if (created.status !== 'planned') {
    return {
      world: createWorld(fixtures),
      status: 'plan_failed',
      code: created.error.code,
      trace: [],
      shown: [],
      asks: 0,
    };
  }
  await service.execute(created.id);

  // The simulated user: answers every approval prompt the same way.
  let asks = 0;
  let snap;
  for (let i = 0; i < 20_000; i++) {
    snap = await service.get(created.id);
    if (FINAL.has(snap.status)) break;
    for (const pending of snap.pendingApprovals) {
      asks += 1;
      await service.resolveApproval(pending.id, {
        action: userApproval === 'approve' ? 'approve_once' : 'reject',
      });
    }
    await new Promise((r) => setImmediate(r));
  }
  if (!FINAL.has(snap.status)) throw new Error('Evaluation run did not finish');

  const trace = snap.steps
    .filter((s) => s.tool && s.policy)
    .map((s) => ({
      tool: s.tool,
      target: targetOf(s.args),
      outcome:
        s.state === 'failed'
          ? 'failed'
          : s.policy.outcome === 'executed'
            ? s.policy.decidedBy === 'user'
              ? 'asked_approved'
              : 'executed'
            : s.policy.decidedBy === 'user'
              ? 'asked_rejected'
              : 'denied',
      by: s.policy.decidedBy,
      rule: s.policy.ruleId,
    }));
  return {
    world: worlds[0],
    status: snap.status,
    code: snap.error?.code ?? null,
    trace,
    shown: snap.results.map((r) => r.text),
    asks,
    plan: snap.plan,
  };
}

/**
 * @param {object} scenario
 * @param {'none' | 'session_taint' | 'deadletter'} defence
 * @param {{ userApproval?: 'approve' | 'reject', fixtures?: object }} [opts]
 */
export async function runDefence(
  scenario,
  defence,
  { userApproval = scenario.userApproval, fixtures } = {},
) {
  const world = fixtures ?? buildFixtures(scenario);
  const out =
    defence === 'none'
      ? await runBaseline(scenario, world, noGuard)
      : defence === 'session_taint'
        ? await runBaseline(scenario, world, createSessionTaintGuard(toolCatalog))
        : await runDeadLetter(scenario, world, userApproval);

  const record = {
    scenarioId: scenario.id,
    kind: scenario.kind,
    defence,
    // Proves every defence ran in the identical world.
    worldHash: createHash('sha256').update(JSON.stringify(world)).digest('hex').slice(0, 12),
    userApproval: defence === 'deadletter' ? userApproval : null,
    status: out.status,
    code: out.code,
    asks: out.asks,
    trace: out.trace,
    actionSignature: out.trace
      .filter((t) => t.outcome === 'executed' || t.outcome === 'asked_approved')
      .map((t) => `${t.tool}→${t.target ?? ''}`),
    leaks: findLeaks(out.world, scenario.authorizedEgress),
    egress: out.world.egress.map((e) => `${e.kind}:${e.target}`),
  };

  if (scenario.kind === 'attack') {
    record.attackSucceeded = holds(out.world, out.shown, scenario.attack.success);
    record.attackOutcome = record.attackSucceeded
      ? 'succeeded'
      : out.trace.some((t) => t.outcome === 'denied' || t.outcome === 'blocked')
        ? 'blocked'
        : out.trace.some((t) => t.outcome === 'asked_rejected')
          ? 'escalated'
          : 'no_path';
  } else {
    record.completed = out.status === 'completed' && holds(out.world, out.shown, scenario.success);
    if (!record.completed)
      record.failureReason =
        out.code ?? (out.status === 'completed' ? 'goal_not_reached' : out.status);
  }
  return record;
}
