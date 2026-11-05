// The run service: the life of one task from request to finished audit record.
//
//   create(request)   plan only, show the preview.   status: planned | failed
//   execute(id)       run it in the background.      status: running
//                       ... awaiting_approval while a person decides ...
//                     finished:  completed | blocked | failed | cancelled
//   cancel(id)        no new step starts; finished steps stay finished
//
// This file wires the pieces together and builds the audit record. It makes no
// security decisions itself: the planner, interpreter, policy gate and tool
// invoker do. What it adds is order and durability:
//
//   * planning happens before the world or the value store exist, so nothing
//     from a tool can reach the planner;
//   * every step record and every policy decision is written BEFORE the action
//     it describes (the interpreter and gate await the writes). If a write
//     fails, the action does not happen.
//
// Everything saved is plain JSON that has already been redacted (audit.js).
import { randomUUID } from 'node:crypto';
import { runPlan } from '../core/interpreter/interpreter.js';
import { ProvenanceStore, serializeLabel } from '../core/labels/index.js';
import { describePlan } from '../core/plan/describe.js';
import { createPolicyGate } from '../core/policy/gate.js';
import { createToolInvoker } from '../core/tools/invoke.js';
import {
  buildFlowGraph,
  describeArg,
  describeControl,
  auditPreview,
  resultPreview,
} from './audit.js';

const FINAL = new Set(['completed', 'blocked', 'failed', 'cancelled', 'interrupted']);
const MAX_RUNS_IN_MEMORY = 100;

export class RunError extends Error {
  /** @param {'not_found' | 'bad_state'} code */
  constructor(code, message) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

/**
 * @param {object} deps
 * @param {(request: string) => Promise<object>} deps.planner         from createPlanner
 * @param {(job: object) => Promise<unknown>} deps.quarantine         from createQuarantine
 * @param {object} deps.catalog
 * @param {() => object} deps.createWorld                              a fresh fake world per run
 * @param {(world: object) => Record<string, Function>} deps.createTools adapters for that world
 * @param {() => Promise<object> | object} deps.getPolicyConfig        a parsed policy config
 * @param {(destination: string) => Promise<void> | void} [deps.onTrustDestination]
 * @param {import('./approvals.js').ApprovalManager} deps.approvals
 * @param {{ saveRun: Function, saveStep: Function, getRun: Function, listRuns: Function, listByStatus: Function }} deps.repo
 */
export function createRunService({
  planner,
  quarantine,
  catalog,
  createWorld,
  createTools,
  getPolicyConfig,
  onTrustDestination = async () => {},
  approvals,
  repo,
  now = () => new Date(),
  newId = randomUUID,
  logger = console,
}) {
  /** @type {Map<string, object>} */
  const runs = new Map();
  const stamp = () => now().toISOString();

  // ---- records -----------------------------------------------------------------

  const addEvent = (rt, type, detail) =>
    rt.record.events.push({ at: stamp(), type, ...(detail ? { detail } : {}) });

  async function saveRun(rt) {
    rt.record.version += 1;
    rt.record.updatedAt = stamp();
    await repo.saveRun(rt.record);
  }

  const saveStep = (rt, step) => {
    rt.record.version += 1;
    return repo.saveStep(rt.record.id, step);
  };

  function remember(rt) {
    runs.set(rt.record.id, rt);
    // Keep memory bounded: forget the oldest finished runs (they stay in the repository).
    if (runs.size > MAX_RUNS_IN_MEMORY) {
      for (const [id, old] of runs) {
        if (FINAL.has(old.record.status)) {
          runs.delete(id);
          if (runs.size <= MAX_RUNS_IN_MEMORY) break;
        }
      }
    }
  }

  async function load(runId) {
    const live = runs.get(runId);
    if (live) return live;
    const stored = await repo.getRun(runId);
    if (!stored) throw new RunError('not_found', 'No such run');
    const { steps, ...record } = stored;
    const rt = {
      record,
      steps,
      results: null,
      store: null,
      world: null,
      abort: null,
      done: Promise.resolve(),
    };
    remember(rt);
    return rt;
  }

  function snapshot(rt) {
    const { record } = rt;
    const results = rt.results
      ? rt.results.map(({ stepId, title, text, label }) => ({ stepId, title, text, label }))
      : record.results;
    return structuredClone({
      ...record,
      steps: rt.steps,
      results,
      pendingApprovals: approvals.list(record.id),
    });
  }

  // ---- creating and executing --------------------------------------------------

  /** Plan a request. Nothing runs and no tool is touched. */
  async function create(request) {
    const record = {
      id: newId(),
      request,
      status: 'planning',
      createdAt: stamp(),
      updatedAt: stamp(),
      finishedAt: null,
      plan: null,
      planPreview: [],
      error: null,
      results: [],
      provenance: null,
      events: [],
      version: 0,
    };
    const rt = {
      record,
      steps: [],
      results: null,
      store: null,
      world: null,
      abort: null,
      done: Promise.resolve(),
    };
    remember(rt);
    addEvent(rt, 'created');
    await saveRun(rt);

    // The planner is called with the request and nothing else. No world, no store,
    // no tool output exists yet.
    const planned = await planner(request);
    if (planned.ok) {
      record.status = 'planned';
      record.plan = planned.plan;
      record.planPreview = describePlan(planned.plan, catalog);
      addEvent(rt, 'planned');
    } else {
      record.status = 'failed';
      record.error = { code: planned.code, message: planned.message };
      record.finishedAt = stamp();
      addEvent(rt, 'plan_failed', { code: planned.code });
    }
    await saveRun(rt);
    return snapshot(rt);
  }

  /** Start a planned run. Returns at once; the run continues in the background. */
  async function execute(runId) {
    const rt = await load(runId);
    if (rt.record.status !== 'planned') {
      throw new RunError('bad_state', `A run that is ${rt.record.status} cannot be started`);
    }
    // Only now does the run's own world and value store come into existence.
    rt.store = new ProvenanceStore();
    rt.world = createWorld();
    rt.abort = new AbortController();
    rt.record.status = 'running';
    addEvent(rt, 'started');
    await saveRun(rt);
    rt.done = drive(rt);
    return snapshot(rt);
  }

  async function drive(rt) {
    const { record, store } = rt;
    const gate = createPolicyGate({
      catalog,
      store,
      getConfig: getPolicyConfig,
      requestApproval: (info) => requestApproval(rt, info),
      onTrustDestination,
      onDecision: (decision) => recordDecision(rt, decision),
    });
    const invokeTool = createToolInvoker(createTools(rt.world));

    let result;
    try {
      result = await runPlan(record.plan, {
        request: record.request,
        store,
        catalog,
        authorize: gate,
        invokeTool,
        quarantine,
        onEvent: (event) => recordEvent(rt, event),
        onInternalError: (err) => logger.error('Run failed internally:', err),
        signal: rt.abort.signal,
      });
    } catch (err) {
      logger.error('Run crashed:', err);
      result = {
        status: 'failed',
        error: { code: 'internal_error', message: 'The run stopped because of an internal error' },
        shown: [],
      };
    }
    await finalize(rt, result);
  }

  async function finalize(rt, result) {
    const { record } = rt;
    const status = result.status === 'invalid_plan' ? 'failed' : result.status;
    record.status = status;
    record.finishedAt = stamp();
    if (result.status === 'invalid_plan') {
      record.error = { code: 'invalid_plan', message: 'The plan was rejected before running' };
    } else if (result.error) {
      record.error = {
        code: result.error.code,
        message: result.error.message,
        stepId: result.error.stepId,
      };
    }
    // Full text stays in memory for the live screen; storage keeps bounded previews.
    rt.results = result.shown.map((s) => ({
      stepId: s.stepId,
      title: s.title ?? null,
      text: typeof s.value.data === 'string' ? s.value.data : JSON.stringify(s.value.data),
      label: serializeLabel(s.value.label),
    }));
    record.results = result.shown.map((s) => ({
      stepId: s.stepId,
      title: s.title ?? null,
      ...resultPreview(s.value),
      label: serializeLabel(s.value.label),
    }));
    record.provenance = buildFlowGraph(rt.store);
    addEvent(rt, 'finished', { status });
    try {
      await saveRun(rt);
    } catch (err) {
      logger.error('Could not save the finished run:', err);
    }
  }

  // ---- events from the interpreter and the gate -----------------------------------

  const keyOf = (stepId, iteration) => `${stepId}#${iteration.join('.')}`;
  const instanceOf = (rt, stepId, iteration) =>
    rt.steps.findLast((s) => s.key === keyOf(stepId, iteration));

  async function recordEvent(rt, e) {
    const { store } = rt;
    const base = () => ({
      seq: rt.steps.length,
      key: keyOf(e.step.id, e.iteration),
      stepId: e.step.id,
      iteration: e.iteration,
      op: e.step.op,
      tool: e.step.tool ?? null,
      state: 'waiting',
      startedAt: null,
      finishedAt: null,
      control: [],
      args: [],
      policy: null,
      result: null,
      error: null,
    });

    let step;
    switch (e.type) {
      case 'step_started':
        step = Object.assign(base(), {
          state: 'running',
          startedAt: stamp(),
          control: e.control.map(describeControl),
        });
        rt.steps.push(step);
        break;

      case 'step_finished':
        step = instanceOf(rt, e.step.id, e.iteration);
        step.state = 'done';
        step.finishedAt = stamp();
        if (e.result) {
          step.result = {
            valueId: e.result.id,
            label: serializeLabel(e.result.label),
            preview: auditPreview(e.result),
          };
          if (step.op === 'quarantine') {
            const input = store.get(e.result.parents[0]);
            if (input) step.input = { valueId: input.id, preview: auditPreview(input) };
          }
        }
        if (e.branch) step.branch = e.branch;
        if (e.iterations !== undefined) step.iterations = e.iterations;
        break;

      case 'step_blocked':
        step = instanceOf(rt, e.step.id, e.iteration);
        step.state = 'blocked';
        step.finishedAt = stamp();
        step.error = { code: e.reason, message: e.message };
        break;

      case 'step_failed':
        step = instanceOf(rt, e.step.id, e.iteration);
        step.state = 'failed';
        step.finishedAt = stamp();
        step.error = e.error;
        break;

      case 'step_skipped':
        step = Object.assign(base(), { state: 'skipped', skipReason: e.reason });
        rt.steps.push(step);
        break;

      default:
        return;
    }
    await saveStep(rt, step);
  }

  /** Called by the gate for every tool call, before the call may run. */
  async function recordDecision(rt, r) {
    const step = rt.steps.findLast(
      (s) => s.stepId === r.stepId && (s.state === 'running' || s.state === 'needs_approval'),
    );
    if (!step) return;
    const spec = catalog.get(r.tool);
    step.args = Object.entries(r.args).map(([name, value]) =>
      describeArg(name, spec.params[name].role, value),
    );
    step.policy = {
      decision: r.decision.decision,
      ruleId: r.decision.ruleId,
      fired: r.decision.fired.map(({ ruleId, decision, arg }) => ({ ruleId, decision, arg })),
      decidedBy: r.decidedBy,
      outcome: r.outcome,
      resolution: r.resolution?.action ?? null,
      explanation: {
        headline: r.decision.explanation.headline,
        rule: r.decision.explanation.rule,
        reasons: r.decision.explanation.reasons,
        next: r.decision.explanation.next,
      },
    };
    await saveStep(rt, step);
  }

  /** The gate says "ask": mark the step, pause the run, wait for a person. */
  async function requestApproval(rt, info) {
    const { record } = rt;
    const step = rt.steps.findLast((s) => s.stepId === info.stepId && s.state === 'running');
    if (step) step.state = 'needs_approval';
    record.status = 'awaiting_approval';
    addEvent(rt, 'approval_requested', { stepId: info.stepId, tool: info.tool });
    if (step) await saveStep(rt, step);
    await saveRun(rt);

    // The interpreter is suspended on this await until someone answers.
    const answer = await approvals.request({
      runId: record.id,
      stepId: info.stepId,
      tool: info.tool,
      card: info.card,
    });

    if (record.status === 'awaiting_approval') record.status = 'running';
    addEvent(rt, 'approval_resolved', { stepId: info.stepId, action: answer.action });
    if (step && step.state === 'needs_approval') step.state = 'running';
    if (step) await saveStep(rt, step);
    await saveRun(rt);
    return answer;
  }

  // ---- controlling a run -----------------------------------------------------------

  async function resolveApproval(approvalId, answer) {
    approvals.resolve(approvalId, answer); // throws ApprovalError on a bad id or answer
  }

  async function cancel(runId) {
    const rt = await load(runId);
    const { status } = rt.record;
    if (FINAL.has(status))
      throw new RunError('bad_state', `A run that is ${status} cannot be cancelled`);
    if (status === 'planned' || status === 'planning') {
      rt.record.status = 'cancelled';
      rt.record.finishedAt = stamp();
      addEvent(rt, 'cancelled');
      await saveRun(rt);
      return snapshot(rt);
    }
    // Running or waiting for approval: stop before the next step, drop pending approvals.
    addEvent(rt, 'cancel_requested');
    rt.abort.abort();
    approvals.cancelRun(runId);
    await rt.done;
    return snapshot(rt);
  }

  // ---- reading -----------------------------------------------------------------------

  async function get(runId) {
    return snapshot(await load(runId));
  }

  async function list() {
    return repo.listRuns();
  }

  /** Test and evaluation helper: resolves when a started run has finished. */
  async function wait(runId) {
    const rt = await load(runId);
    await rt.done;
    return snapshot(rt);
  }

  /** At startup: nothing can be running yet, so anything saved as active was cut off. */
  async function recoverInterrupted() {
    const stale = await repo.listByStatus(['planning', 'running', 'awaiting_approval']);
    for (const run of stale) {
      const rt = await load(run.id);
      rt.record.status = 'interrupted';
      rt.record.finishedAt = stamp();
      rt.record.error = {
        code: 'interrupted',
        message: 'The server restarted while this run was in progress',
      };
      addEvent(rt, 'interrupted');
      for (const step of rt.steps) {
        if (step.state === 'running' || step.state === 'needs_approval') {
          step.state = 'interrupted';
          await repo.saveStep(run.id, step);
        }
      }
      await saveRun(rt);
    }
    return stale.length;
  }

  return { create, execute, cancel, resolveApproval, get, list, wait, recoverInterrupted };
}
