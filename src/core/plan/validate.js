// Plan validation: decides whether a plan is allowed to run at all.
//
// This is the first of two gates (the second is the policy engine, which judges
// each tool call while the plan runs). Validation looks at the plan and the
// user's request only. It never sees any untrusted content, because none exists
// yet when it runs.
import { ROLE } from '../tools/catalog.js';
import { LIMITS, planSchema } from './schema.js';

/**
 * @typedef {{ code: string, message: string, stepId?: string }} PlanProblem
 * @returns {{ ok: true, plan: object } | { ok: false, errors: PlanProblem[] }}
 */

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Look for object keys that only make sense as an attack on JavaScript itself.
 * The schema library would silently drop an own "__proto__" key rather than
 * reject it; we want the plan refused outright, not quietly edited.
 * Bounded, so a hostile or cyclic structure cannot make this loop forever.
 */
function findForbiddenKey(value, budget = { nodes: 2000 }, depth = 0) {
  if (value === null || typeof value !== 'object') return null;
  if (depth > 30 || --budget.nodes < 0) return '(structure too large or too deep)';
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol' || FORBIDDEN_KEYS.has(key)) return String(key);
    const hit = findForbiddenKey(value[key], budget, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Is `text` written in the user's request? (case-insensitive, verbatim) */
function appearsInRequest(text, request) {
  return text.trim() !== '' && request.toLowerCase().includes(text.toLowerCase());
}

/** Every string literal inside an expression. */
function* literals(expr) {
  if ('lit' in expr) {
    if (typeof expr.lit === 'string') yield expr.lit;
  } else if ('concat' in expr) {
    for (const part of expr.concat) yield* literals(part);
  }
}

function exprDepth(expr) {
  return 'concat' in expr ? 1 + Math.max(...expr.concat.map(exprDepth)) : 1;
}

/**
 * @param {unknown} input         the plan as produced by the planner
 * @param {{ request: string, catalog: ReturnType<import('../tools/catalog.js').defineCatalog> }} ctx
 */
export function validatePlan(input, { request, catalog }) {
  const forbidden = findForbiddenKey(input);
  if (forbidden) {
    return {
      ok: false,
      errors: [
        { code: 'forbidden_key', message: `The plan contains a forbidden key: ${forbidden}` },
      ],
    };
  }

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 10).map((i) => ({
        code: 'schema',
        message: `${i.path.join('.') || '(plan)'}: ${i.message}`,
      })),
    };
  }
  const plan = parsed.data;

  /** @type {PlanProblem[]} */
  const errors = [];
  const problem = (stepId, code, message) => errors.push({ code, message, stepId });
  const ids = new Set();
  let count = 0;

  function checkExpr(expr, scope, stepId, role) {
    if (exprDepth(expr) > LIMITS.maxExprDepth) {
      problem(stepId, 'expression_too_deep', 'Expression is nested too deeply');
    }
    const visit = (e) => {
      if ('ref' in e && !scope.has(e.ref)) {
        problem(stepId, 'undefined_variable', `Variable "${e.ref}" is used before it is defined`);
      } else if ('concat' in e) {
        e.concat.forEach(visit);
      }
    };
    visit(expr);

    // Grounding: a literal that names a destination or a thing to act on must
    // be something the user actually wrote. Otherwise the planner could invent it.
    if (role === ROLE.DESTINATION || role === ROLE.SELECTOR) {
      for (const text of literals(expr)) {
        if (!appearsInRequest(text, request)) {
          problem(
            stepId,
            'ungrounded_literal',
            `"${text}" names a ${role} but does not appear in the user's request`,
          );
        }
      }
    }
  }

  function define(scope, name, stepId) {
    if (scope.has(name)) {
      problem(stepId, 'variable_redefined', `Variable "${name}" is already defined`);
    }
    scope.add(name);
  }

  function walk(steps, scope, depth, loops) {
    for (const step of steps) {
      count += 1;
      if (ids.has(step.id))
        problem(step.id, 'duplicate_step_id', `Step id "${step.id}" is used twice`);
      ids.add(step.id);

      switch (step.op) {
        case 'call': {
          const tool = catalog.get(step.tool);
          if (!tool) {
            problem(step.id, 'unknown_tool', `Unknown tool "${step.tool}"`);
            break;
          }
          for (const name of Object.keys(step.args)) {
            if (!Object.hasOwn(tool.params, name)) {
              problem(step.id, 'unknown_argument', `${tool.name} has no argument "${name}"`);
            }
          }
          for (const [name, spec] of Object.entries(tool.params)) {
            if (!Object.hasOwn(step.args, name)) {
              if (spec.required) {
                problem(step.id, 'missing_argument', `${tool.name} needs argument "${name}"`);
              }
              continue;
            }
            checkExpr(step.args[name], scope, step.id, spec.role);
          }
          if (step.as) define(scope, step.as, step.id);
          break;
        }
        case 'quarantine':
          checkExpr(step.input, scope, step.id, ROLE.DATA);
          define(scope, step.as, step.id);
          break;
        case 'show':
          checkExpr(step.value, scope, step.id, ROLE.DATA);
          break;
        case 'if':
          checkExpr(step.cond, scope, step.id, ROLE.DATA);
          if (depth + 1 > LIMITS.maxDepth)
            problem(step.id, 'too_deep', 'Blocks are nested too deeply');
          // Variables defined inside a branch are not visible after it.
          walk(step.then, new Set(scope), depth + 1, loops);
          if (step.else) walk(step.else, new Set(scope), depth + 1, loops);
          break;
        case 'for_each': {
          checkExpr(step.items, scope, step.id, ROLE.DATA);
          if (depth + 1 > LIMITS.maxDepth)
            problem(step.id, 'too_deep', 'Blocks are nested too deeply');
          if (loops + 1 > LIMITS.maxLoopNesting)
            problem(step.id, 'too_many_loops', 'Loops are nested too deeply');
          const inner = new Set(scope);
          define(inner, step.as, step.id);
          walk(step.body, inner, depth + 1, loops + 1);
          break;
        }
      }
    }
  }

  walk(plan.steps, new Set(), 0, 0);
  if (count > LIMITS.maxSteps) {
    problem(
      undefined,
      'too_many_steps',
      `Plan has ${count} steps; the limit is ${LIMITS.maxSteps}`,
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, plan };
}
