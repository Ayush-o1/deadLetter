// Builds the Express application. All dependencies are passed in, so the same
// function serves production (real database) and tests (test or fake database).
import { existsSync } from 'node:fs';
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
 * @param {{ db: object, services?: object, publicDir?: string, logger?: { error: (...a: unknown[]) => void } }} deps
 *   services: from createServices(); without it only the health route is mounted
 *   publicDir: folder with the browser app; served after the API routes
 */
export function createApp({ db, services, publicDir, logger = console }) {
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

  // The browser app: plain files, no build step. no-cache so edits show on reload.
  if (publicDir && existsSync(publicDir)) {
    app.use(
      express.static(publicDir, {
        maxAge: 0,
        setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
      }),
    );
  }

  // Anything no route handled is a JSON 404, never an HTML page.
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
