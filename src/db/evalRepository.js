// Stored evaluation reports (the Lab tab's history).

/** @param {import('../generated/client.ts').PrismaClient} db */
export function createPrismaEvalRepository(db) {
  return {
    async save(report) {
      const row = await db.evalReport.create({
        data: { scenarioSet: report.meta.scenarioSet, report },
      });
      return { id: row.id, createdAt: row.createdAt.toISOString() };
    },
    async list(limit = 20) {
      const rows = await db.evalReport.findMany({
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 100),
      });
      return rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        scenarioSet: r.scenarioSet,
        summary: r.report.summary,
        meta: r.report.meta,
      }));
    },
    async get(id) {
      const row = await db.evalReport.findUnique({ where: { id } });
      return row
        ? { id: row.id, createdAt: row.createdAt.toISOString(), report: row.report }
        : undefined;
    },
  };
}
