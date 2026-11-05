// Run storage in PostgreSQL via Prisma. Implements the repository interface the
// run service expects (see src/runtime/memoryRepository.js for the reference
// implementation).
//
// A run row holds the redacted run record; each step is a row with its full
// redacted record in `data` plus indexed columns for searching History.
import { Prisma } from '../generated/client.ts';
import { hasStepFilter, normalizeFilters, summarizeRun } from '../runtime/summary.js';

const json = (value) => (value === null || value === undefined ? Prisma.JsonNull : value);
const date = (iso) => (iso ? new Date(iso) : null);

function toRow(run) {
  return {
    request: run.request,
    status: run.status,
    createdAt: new Date(run.createdAt),
    updatedAt: new Date(run.updatedAt),
    finishedAt: date(run.finishedAt),
    plan: json(run.plan),
    planPreview: run.planPreview,
    error: json(run.error),
    results: run.results,
    provenance: json(run.provenance),
    events: run.events,
    version: run.version,
  };
}

function toRecord(row) {
  return {
    id: row.id,
    request: row.request,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    plan: row.plan,
    planPreview: row.planPreview,
    error: row.error,
    results: row.results,
    provenance: row.provenance,
    events: row.events,
    version: row.version,
  };
}

/** @param {import('../generated/client.ts').PrismaClient} db */
export function createPrismaRunRepository(db) {
  async function summaries(rows) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const stepRows = await db.step.findMany({
      where: { runId: { in: ids } },
      select: { runId: true, decision: true },
    });
    return rows.map((row) => {
      const steps = stepRows
        .filter((s) => s.runId === row.id)
        .map((s) => ({ policy: s.decision ? { decision: s.decision } : null }));
      return summarizeRun(toRecord(row), steps);
    });
  }

  return {
    async saveRun(run) {
      const data = toRow(run);
      await db.run.upsert({ where: { id: run.id }, create: { id: run.id, ...data }, update: data });
    },

    async saveStep(runId, step) {
      const data = {
        stepId: step.stepId,
        tool: step.tool,
        state: step.state,
        decision: step.policy?.decision ?? null,
        ruleId: step.policy?.ruleId ?? null,
        decidedBy: step.policy?.decidedBy ?? null,
        data: step,
      };
      await db.step.upsert({
        where: { runId_seq: { runId, seq: step.seq } },
        create: { runId, seq: step.seq, ...data },
        update: data,
      });
    },

    async getRun(id) {
      const row = await db.run.findUnique({
        where: { id },
        include: { steps: { orderBy: { seq: 'asc' } } },
      });
      return row ? { ...toRecord(row), steps: row.steps.map((s) => s.data) } : undefined;
    },

    /** @param {import('../runtime/summary.js').RunFilters} [filters] */
    async listRuns(filters) {
      const f = normalizeFilters(filters);
      const where = {};
      if (f.status) where.status = f.status;
      if (f.q) where.request = { contains: String(f.q), mode: 'insensitive' };
      if (hasStepFilter(f)) {
        where.steps = {
          some: {
            ...(f.decision && { decision: f.decision }),
            ...(f.ruleId && { ruleId: f.ruleId }),
            ...(f.tool && { tool: f.tool }),
            ...(f.decidedBy && { decidedBy: f.decidedBy }),
          },
        };
      }
      const rows = await db.run.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: f.offset,
        take: f.limit,
      });
      return summaries(rows);
    },

    async listByStatus(statuses) {
      return summaries(await db.run.findMany({ where: { status: { in: statuses } } }));
    },
  };
}
