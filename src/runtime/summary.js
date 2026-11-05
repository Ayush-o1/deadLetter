// Shared by every run repository: how a run is summarised for the History list and
// how History filters are interpreted. Keeping this in one place is what lets the
// in-memory and Prisma repositories behave the same (a contract test checks it).

/**
 * @typedef {object} RunFilters
 * @property {string} [q]          text contained in the request (case-insensitive)
 * @property {string} [status]
 * @property {'allow' | 'ask' | 'deny'} [decision]   some step had this policy decision
 * @property {string} [ruleId]     some step fired this rule
 * @property {string} [tool]
 * @property {'engine' | 'user'} [decidedBy]
 * @property {number} [limit]
 * @property {number} [offset]
 */

export const MAX_LIMIT = 200;

export function normalizeFilters(filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), MAX_LIMIT);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  return { ...filters, limit, offset };
}

/** Step-level conditions must all hold on the SAME step. */
export function hasStepFilter(f) {
  return Boolean(f.decision || f.ruleId || f.tool || f.decidedBy);
}

export function stepMatches(step, f) {
  return (
    (!f.decision || step.policy?.decision === f.decision) &&
    (!f.ruleId || step.policy?.ruleId === f.ruleId) &&
    (!f.tool || step.tool === f.tool) &&
    (!f.decidedBy || step.policy?.decidedBy === f.decidedBy)
  );
}

export function runMatches(run, steps, f) {
  if (f.status && run.status !== f.status) return false;
  if (f.q && !run.request.toLowerCase().includes(String(f.q).toLowerCase())) return false;
  if (hasStepFilter(f) && !steps.some((s) => stepMatches(s, f))) return false;
  return true;
}

/** The row shown in the History list. */
export function summarizeRun(run, steps) {
  const decisions = { allow: 0, ask: 0, deny: 0 };
  for (const s of steps) if (s.policy?.decision in decisions) decisions[s.policy.decision] += 1;
  return {
    id: run.id,
    request: run.request,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt ?? null,
    error: run.error ?? null,
    stepCount: steps.length,
    decisions,
    version: run.version,
  };
}
