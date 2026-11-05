// Builds the Express application. All dependencies are passed in, so the same
// function serves production (real database) and tests (test or fake database).
import express from 'express';
import { createErrorHandler, notFoundHandler } from './http/errors.js';
import { securityHeaders } from './http/middleware/securityHeaders.js';
import { healthRouter } from './http/routes/health.js';

/**
 * @param {{ db: object, logger?: { error: (...a: unknown[]) => void } }} deps
 */
export function createApp({ db, logger = console }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(securityHeaders);
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter(db));

  // Anything no route handled is a JSON 404, never an HTML page.
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}
