import { Router } from 'express';

/**
 * GET /api/health: reports whether the process is up and the database answers.
 * Returns 503 (not 200) when the database is unreachable, so monitors and the
 * test suite can tell "running" from "working".
 *
 * @param {{ $queryRaw: Function }} db
 */
export function healthRouter(db) {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  return router;
}
