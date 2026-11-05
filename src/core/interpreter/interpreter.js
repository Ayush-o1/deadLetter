// The interpreter: runs a validated plan one step at a time.
//
// What it does NOT do is as important as what it does:
//   * It never evaluates generated code. A step is one of five known operations.
//   * It never lets data choose a tool, an operation or a variable name; those
//     are literal strings in the plan.
//   * It never calls a tool directly. Every tool call goes through `authorize`
//     first (the policy engine, plus human approval when the answer is "ask"),
//     and the tool is reached only through `invokeTool`.
//   * It never calls the quarantined model with anything but one narrow task.
//
// Everything outside the plan is injected through `ctx`, so this file has no
// I/O, no clock and no model, and can be tested with simple stubs.
import { quarantineLabel } from '../labels/index.js';
import { ROLE } from '../tools/catalog.js';
import { LIMITS } from '../plan/schema.js';
import { validatePlan } from '../plan/validate.js';
import { RunHalt, fail } from './errors.js';
import { Scope, evaluate } from './expressions.js';
import { parseQuarantineOutput } from './outputs.js';

/**
 * @typedef {object} RunContext
 * @property {string} request   the user's request (trusted)
 * @property {import('../labels/provenance.js').ProvenanceStore} store
 * @property {ReturnType<import('../tools/catalog.js').defineCatalog>} catalog
 * @property {(call: { stepId: string, tool: string, args: object, control: object[] })
 *            => Promise<{ outcome: 'execute', args?: object, authorization?: unknown }
 *                     | { outcome: 'blocked', reason: string, message?: string }>} authorize
 *           Decides whether a tool call may run. Must be the policy engine.
 * @property {(tool: string, args: object, authorization: unknown) => Promise<object>} invokeTool
 *           Runs the tool and returns a result built with scalar()/record()/list().
 * @property {(job: { task: string, instruction?: string, output: string, content: string })
 *            => Promise<unknown>} quarantine   the quarantined model
 * @property {(event: object) => void} [onEvent]  progress/audit events; if it throws, the run stops
 * @property {(err: unknown) => void} [onInternalError]  receives unexpected errors (bugs) for logging
 * @property {AbortSignal} [signal]
 * @property {Partial<typeof LIMITS>} [limits]
 */

/** All steps of a block, including nested ones, in order. */
function flatten(steps) {
  return steps.flatMap((s) => [
    s,
    ...flatten(s.then ?? []),
    ...flatten(s.else ?? []),
    ...flatten(s.body ?? []),
  ]);
}

const BLOCK_REASON = { blocked: 'run_blocked', failed: 'run_failed', cancelled: 'run_cancelled' };

/**
 * Validate and run a plan.
 *
 * @param {unknown} planInput the plan as returned by the planner (validated here again)
 * @param {RunContext} ctx
 * @returns {Promise<{
 *   status: 'completed' | 'failed' | 'blocked' | 'cancelled' | 'invalid_plan',
 *   error?: { code: string, message: string, stepId?: string },
 *   errors?: object[],
 *   shown: { stepId: string, title?: string, value: object }[],
 *   executedSteps: number }>}
 */
export async function runPlan(planInput, ctx) {
  const { request, store, catalog, authorize, invokeTool, quarantine, signal } = ctx;
  for (const [name, fn] of Object.entries({ authorize, invokeTool, quarantine })) {
    if (typeof fn !== 'function') throw new TypeError(`runPlan needs a ${name} function`);
  }
  const limits = { ...LIMITS, ...ctx.limits };
  const emit = ctx.onEvent ?? (() => {});

  // Nothing runs unless the plan is valid. Validation happens here, not only in
  // the caller, so there is no path to execution that skips it.
  const validation = validatePlan(planInput, { request, catalog });
  if (!validation.ok) {
    return { status: 'invalid_plan', errors: validation.errors, shown: [], executedSteps: 0 };
  }
  const plan = validation.plan;

  const started = new Set();
  const skipped = new Set();
  const shown = [];
  let executed = 0;
  let currentStepId;
  let iteration = [];

  // Events are awaited. A caller that persists them (the audit log) therefore
  // finishes writing a record BEFORE the interpreter goes on to the action it
  // describes; if the write fails, the run stops and the action never happens.
  const event = async (type, step, extra = {}) => {
    await emit({
      type,
      step: { id: step.id, op: step.op, tool: step.tool },
      iteration: [...iteration],
      ...extra,
    });
  };

  const skip = async (steps, reason) => {
    for (const s of steps) {
      if (started.has(s.id) || skipped.has(s.id)) continue;
      skipped.add(s.id);
      await event('step_skipped', s, { reason });
    }
  };

  // ---- one step ----------------------------------------------------------------

  async function runStep(step, scope, control) {
    if (signal?.aborted) throw new RunHalt('cancelled', 'cancelled', 'The run was cancelled');
    if (++executed > limits.maxExecutedSteps) {
      throw fail('step_limit', `The run exceeded ${limits.maxExecutedSteps} steps`);
    }
    currentStepId = step.id;
    started.add(step.id);
    await event('step_started', step, { control: [...control] });
    const rt = { store, scope, control };

    switch (step.op) {
      case 'call':
        return runCall(step, rt);
      case 'quarantine':
        return runQuarantine(step, rt);
      case 'show': {
        const value = evaluate(step.value, rt);
        shown.push({ stepId: step.id, title: step.title, value });
        return event('step_finished', step, { result: value });
      }
      case 'if':
        return runIf(step, rt);
      case 'for_each':
        return runForEach(step, rt);
      default:
        // Unreachable after validation; kept so a future op cannot run unhandled.
        throw fail('unknown_op', 'Unsupported operation');
    }
  }

  async function runCall(step, rt) {
    const tool = catalog.get(step.tool);
    if (!tool) throw fail('unknown_tool', `Unknown tool "${step.tool}"`);

    // Argument values. Literals in destination/selector positions were already
    // checked against the user's request, so they are labelled as user input.
    const args = Object.create(null);
    for (const [name, expr] of Object.entries(step.args)) {
      const role = tool.params[name].role;
      args[name] = evaluate(expr, rt, {
        grounded: role === ROLE.DESTINATION || role === ROLE.SELECTOR,
      });
    }

    // THE GATE. Anything other than an explicit "execute" is treated as a refusal.
    const decision = await authorize({
      stepId: step.id,
      tool: step.tool,
      args,
      control: [...rt.control],
    });
    if (decision?.outcome !== 'execute') {
      const reason = decision?.reason ?? 'denied';
      const message = decision?.message ?? 'The action was not allowed';
      await event('step_blocked', step, { reason, message, decision });
      throw new RunHalt(reason === 'cancelled' ? 'cancelled' : 'blocked', reason, message);
    }

    // The approved arguments may differ from the planned ones (the user can edit
    // a destination). They must still be values of this run, with real labels.
    const finalArgs = decision.args ?? args;
    for (const value of Object.values(finalArgs)) {
      if (store.get(value?.id) !== value) {
        throw fail(
          'invalid_authorization',
          'The approved action used a value that is not part of this run',
        );
      }
    }

    let spec;
    try {
      spec = await invokeTool(step.tool, finalArgs, decision.authorization);
    } catch (err) {
      // Only messages written for the user are passed on (a tool's own refusal or a
      // rejected authorization). Anything else, such as an unexpected exception, could
      // contain paths, argument text or internals, and is replaced.
      const known = err?.name === 'ToolError' || err?.name === 'UnauthorizedToolCall';
      throw fail(
        'tool_error',
        `The ${tool.title.toLowerCase()} tool failed: ${known ? String(err.message).slice(0, 200) : 'an unexpected error'}`,
      );
    }
    const result = store.fromTool(spec, {
      tool: step.tool,
      control: rt.control,
      inputs: Object.values(finalArgs),
    });
    if (step.as) rt.scope.define(step.as, result);
    await event('step_finished', step, { result, args: finalArgs });
  }

  async function runQuarantine(step, rt) {
    const input = evaluate(step.input, rt);
    const content = typeof input.data === 'string' ? input.data : JSON.stringify(input.data);

    let raw;
    try {
      // The model gets this and nothing else: a narrow task and the text.
      raw = await quarantine({
        task: step.task,
        instruction: step.instruction,
        output: step.output,
        content,
      });
    } catch {
      // No fallback of any kind. In particular the planner never sees the text.
      throw fail('quarantine_failed', 'The quarantined model failed');
    }
    if (signal?.aborted) throw new RunHalt('cancelled', 'cancelled', 'The run was cancelled');

    const parsed = parseQuarantineOutput(step.output, raw);
    if (!parsed.ok) {
      throw fail(
        'quarantine_output_invalid',
        `The quarantined model did not return valid ${step.output}`,
      );
    }

    // Whatever came back is untrusted, whatever it was given.
    const extra = quarantineLabel(step.task);
    const op = `quarantine:${step.task}`;
    let result;
    if (step.output === 'list_of_text') {
      const items = parsed.value.map((text) =>
        store.derive({ data: text, parents: [input], op, extra, control: rt.control }),
      );
      result = store.collect(items, { control: rt.control });
    } else {
      result = store.derive({
        data: parsed.value,
        parents: [input],
        op,
        extra,
        control: rt.control,
      });
    }
    rt.scope.define(step.as, result);
    await event('step_finished', step, { result });
  }

  async function runIf(step, rt) {
    const cond = evaluate(step.cond, rt);
    if (typeof cond.data !== 'boolean')
      throw fail('condition_not_boolean', 'An if condition must be true or false');
    const taken = cond.data ? step.then : (step.else ?? []);
    const notTaken = cond.data ? (step.else ?? []) : step.then;
    await event('step_finished', step, { result: cond, branch: cond.data ? 'then' : 'else' });
    await skip(flatten(notTaken), 'branch_not_taken');
    // From here on, everything created or called is "under" this condition.
    await runBlock(taken, new Scope(rt.scope), [...rt.control, cond]);
  }

  async function runForEach(step, rt) {
    const list = evaluate(step.items, rt);
    let items;
    try {
      items = store.items(list);
    } catch {
      throw fail('not_a_list', 'for_each needs a list');
    }
    if (items.length > limits.maxLoopIterations) {
      throw fail(
        'loop_limit',
        `The list has ${items.length} items; the limit is ${limits.maxLoopIterations}`,
      );
    }
    await event('step_finished', step, { result: list, iterations: items.length });
    // How many times the body runs is decided by the list, so the list is a control dependency.
    const control = [...rt.control, list];
    for (let i = 0; i < items.length; i++) {
      const scope = new Scope(rt.scope);
      scope.define(step.as, items[i]);
      iteration = [...iteration, i];
      try {
        await runBlock(step.body, scope, control);
      } finally {
        iteration = iteration.slice(0, -1);
      }
    }
  }

  async function runBlock(steps, scope, control) {
    for (const step of steps) await runStep(step, scope, control);
  }

  // ---- run ---------------------------------------------------------------------

  try {
    await runBlock(plan.steps, new Scope(), []);
    return { status: 'completed', shown, executedSteps: executed };
  } catch (err) {
    if (!(err instanceof RunHalt)) ctx.onInternalError?.(err);
    const halt =
      err instanceof RunHalt
        ? err
        : fail('internal_error', 'The run stopped because of an internal error');
    const step = currentStepId
      ? flatten(plan.steps).find((s) => s.id === currentStepId)
      : undefined;
    iteration = [];
    // Remaining steps never ran. Record that rather than leaving them in limbo.
    try {
      await skip(flatten(plan.steps), BLOCK_REASON[halt.status]);
      if (step && halt.status === 'failed') {
        await event('step_failed', step, { error: { code: halt.code, message: halt.message } });
      }
    } catch {
      // The event sink itself failed; the run has already stopped, nothing more to protect.
    }
    return {
      status: halt.status,
      error: { code: halt.code, message: halt.message, stepId: currentStepId },
      shown,
      executedSteps: executed,
    };
  }
}
