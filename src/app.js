// Builds the Express application. All dependencies are passed in, so the same
// function serves production (real database) and tests (test or fake database).
import express from 'express';
import { createErrorHandler, notFoundHandler } from './http/errors.js';
import { securityHeaders } from './http/middleware/securityHeaders.js';
import { approvalsRouter } from './http/routes/approvals.js';
import { healthRouter } from './http/routes/health.js';
import { labRouter } from './http/routes/lab.js';
import { metaRouter } from './http/routes/meta.js';
import { rulesRouter } from './http/routes/rules.js';
import { runsRouter } from './http/routes/runs.js';

/**
 * @param {{ db: object, services?: object, logger?: { error: (...a: unknown[]) => void } }} deps
 *   services: from createServices(); without it only the health route is mounted
 */
export function createApp({ db, services, logger = console }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter(db));
  if (services) {
    app.use('/api/meta', metaRouter(services));
    app.use('/api/runs', runsRouter(services));
    app.use('/api/approvals', approvalsRouter(services));
    app.use('/api/rules', rulesRouter(services));
    app.use('/api/lab', labRouter(services));
  }

  // Anything no route handled is a JSON 404, never an HTML page.
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
