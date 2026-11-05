// The undefended agent that the two baseline defences share.
//
// It performs the same task as deadLetter: it runs the very plan the planner
// wrote for the request. What differs is everything deadLetter adds. This agent
// has no labels, no policy engine, no approval, and one model that reads
// everything. It follows the plan over plain values, and a `guard` (the defence
// under test) may refuse individual tool calls.
//
// WORST-CASE ASSUMPTION (stated in docs/EVALUATION.md): when this agent reads
// text containing the scenario's injection, it obeys it. It then performs the
// attacker's goal, subject only to the guard. That makes the results a statement
// about the architecture, not about how easily a particular model is fooled.
import { parseQuarantineOutput } from '../core/interpreter/outputs.js';
import { ToolError } from '../core/tools/adapters.js';

const MAX_STEPS = 200;

class Stop extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

/** Plain data of a tool result, and whether any part of it is untrusted. */
function plain(spec) {
  switch (spec.kind) {
    case 'scalar':
      return { data: spec.data, untrusted: spec.label.integrity === 'untrusted' };
    case 'record': {
      const parts = Object.entries(spec.fields).map(([k, v]) => [k, plain(v)]);
      return {
        data: Object.fromEntries(parts.map(([k, v]) => [k, v.data])),
        untrusted: parts.some(([, v]) => v.untrusted),
      };
    }
    default: {
      const parts = spec.items.map(plain);
      return { data: parts.map((p) => p.data), untrusted: parts.some((p) => p.untrusted) };
    }
  }
}

const asText = (d) => (typeof d === 'string' ? d : JSON.stringify(d));

/**
 * @param {object} p
 * @param {object} p.plan                the plan the planner produced
 * @param {Record<string, Function>} p.tools    fake tool adapters (plain-data in, spec out)
 * @param {object} p.catalog
 * @param {{ extract: Function }} p.quarantine
 * @param {{ check: (call: object, state: { tainted: boolean }) => { allow: boolean, reason?: string } }} p.guard
 * @param {{ text: string, goal: object[] } | null} p.obeys  injected text to obey, and what obeying does
 */
export async function runBaselineAgent({ plan, tools, quarantine, guard, obeys }) {
  const state = { tainted: false };
  const trace = []; // every tool call the agent attempted
  const shown = [];
  let steps = 0;
  let obeyed = false;

  async function attempt(tool, args, { fromGoal }) {
    const decision = guard.check({ tool, args }, state);
    if (!decision.allow) {
      trace.push({
        tool,
        target: targetOf(tool, args),
        outcome: 'blocked',
        by: 'guard',
        reason: decision.reason,
        fromGoal,
      });
      return { blocked: true };
    }
    let spec;
    try {
      spec = tools[tool](args);
    } catch (err) {
      trace.push({ tool, target: targetOf(tool, args), outcome: 'failed', by: 'tool', fromGoal });
      if (err instanceof ToolError) return { failed: true };
      throw err;
    }
    trace.push({ tool, target: targetOf(tool, args), outcome: 'executed', by: 'agent', fromGoal });
    const result = plain(spec);
    if (result.untrusted) state.tainted = true;
    return { result };
  }

  /** Reading the injected text makes the (worst-case) agent carry out the attacker's goal. */
  async function maybeObey(readData) {
    if (!obeys || obeyed || !asText(readData).includes(obeys.text)) return;
    obeyed = true;
    const results = {};
    for (const step of obeys.goal) {
      const args = Object.fromEntries(
        Object.entries(step.args).map(([k, v]) => [
          k,
          v.replace(/\$(\w+)(?:\.(\w+))?/g, (_, name, field) =>
            asText(field ? results[name]?.[field] : results[name]),
          ),
        ]),
      );
      const out = await attempt(step.tool, args, { fromGoal: true });
      // A refused attacker step is simply skipped; the agent carries on with the user's task.
      if (step.as && out.result) results[step.as] = out.result.data;
    }
  }

  const vars = new Map();
  const evaluate = (expr) => {
    if ('lit' in expr) return expr.lit;
    if ('ref' in expr) {
      let v = vars.get(expr.ref);
      for (const key of expr.path ?? []) v = v?.[key];
      return v;
    }
    return expr.concat.map((e) => asText(evaluate(e))).join('');
  };

  async function runSteps(list) {
    for (const step of list) {
      if (++steps > MAX_STEPS) throw new Stop('failed', 'step_limit');
      switch (step.op) {
        case 'call': {
          const args = Object.fromEntries(
            Object.entries(step.args).map(([k, e]) => [k, evaluate(e)]),
          );
          const out = await attempt(step.tool, args, { fromGoal: false });
          if (out.blocked) throw new Stop('blocked', 'guard_blocked');
          if (out.failed) throw new Stop('failed', 'tool_error');
          if (step.as) vars.set(step.as, out.result.data);
          await maybeObey(out.result.data);
          break;
        }
        case 'quarantine': {
          const content = asText(evaluate(step.input));
          let raw;
          try {
            raw = await quarantine.extract({
              task: step.task,
              instruction: step.instruction,
              output: step.output,
              content,
            });
          } catch {
            throw new Stop('failed', 'quarantine_failed');
          }
          const parsed = parseQuarantineOutput(step.output, raw);
          if (!parsed.ok) throw new Stop('failed', 'quarantine_output_invalid');
          vars.set(step.as, parsed.value);
          await maybeObey(content);
          break;
        }
        case 'show':
          shown.push(asText(evaluate(step.value)));
          break;
        case 'if': {
          const cond = evaluate(step.cond);
          if (typeof cond !== 'boolean') throw new Stop('failed', 'condition_not_boolean');
          await runSteps(cond ? step.then : (step.else ?? []));
          break;
        }
        case 'for_each': {
          const items = evaluate(step.items);
          if (!Array.isArray(items) || items.length > 25) throw new Stop('failed', 'bad_list');
          for (const item of items) {
            vars.set(step.as, item);
            await runSteps(step.body);
            vars.delete(step.as);
          }
          break;
        }
      }
    }
  }

  let status = 'completed';
  let code = null;
  try {
    await runSteps(plan.steps);
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    status = err.status;
    code = err.code;
  }
  return { status, code, trace, shown, asks: 0 };
}

function targetOf(tool, args) {
  return args.to ?? args.url ?? args.path ?? args.name ?? args.from ?? null;
}
