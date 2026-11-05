// The planner interface. THE most important rule in the project lives here:
//
//     the planner receives the user's request and static tool descriptions,
//     and nothing else.
//
// `plan(request)` is the only entry point. There is no parameter through which an
// email, file, web page or any tool result could arrive, and the provider is
// handed a frozen object with exactly two keys. If planning fails, the failure is
// reported; nothing falls back to showing the planner anything more.
import { validatePlan } from '../plan/validate.js';

const MAX_REQUEST = 2000;

/** Static, content-free descriptions of the tools: names, roles and effects. */
export function describeTools(catalog) {
  return catalog.list().map((t) => ({
    name: t.name,
    title: t.title,
    effect: t.effect,
    params: Object.fromEntries(
      Object.entries(t.params).map(([name, p]) => [name, { role: p.role, required: p.required }]),
    ),
  }));
}

/**
 * @param {object} deps
 * @param {{ plan: (input: { request: string, tools: object[] }) => Promise<unknown> }} deps.provider
 * @param {ReturnType<import('../tools/catalog.js').defineCatalog>} deps.catalog
 */
export function createPlanner({ provider, catalog }) {
  const tools = Object.freeze(describeTools(catalog));

  /**
   * @param {string} request the user's own words
   * @returns {Promise<{ ok: true, plan: object } | { ok: false, code: string, message: string, errors?: object[] }>}
   */
  return async function plan(request) {
    if (typeof request !== 'string' || request.trim() === '' || request.length > MAX_REQUEST) {
      return {
        ok: false,
        code: 'invalid_request',
        message: `A request must be 1-${MAX_REQUEST} characters`,
      };
    }

    let raw;
    try {
      raw = await provider.plan(Object.freeze({ request, tools }));
    } catch (err) {
      if (err?.code === 'cannot_plan') {
        return { ok: false, code: 'cannot_plan', message: err.message };
      }
      return { ok: false, code: 'planner_failed', message: 'The planner failed to produce a plan' };
    }

    const checked = validatePlan(raw, { request, catalog });
    if (!checked.ok) {
      return {
        ok: false,
        code: 'invalid_plan',
        message: 'The planner produced an invalid plan',
        errors: checked.errors,
      };
    }
    return { ok: true, plan: checked.plan };
  };
}
