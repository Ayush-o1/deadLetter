// Error handling for the HTTP layer.
//
// Rule: a client only ever sees { error: { code, message } }. Stack traces and
// internal messages stay in the server log, because they can reveal file paths,
// SQL or configuration.

import { ZodError } from 'zod';
import { ApprovalError } from '../runtime/approvals.js';
import { RunError } from '../runtime/runner.js';

export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code short machine-readable code, e.g. "not_found"
   * @param {string} message safe to show to the client
   * @param {unknown} [details] extra safe information, e.g. which fields were invalid
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Errors raised by the services, mapped to HTTP statuses. */
const RUN_STATUS = { not_found: 404, bad_state: 409 };
const APPROVAL_STATUS = {
  not_pending: 404,
  bad_action: 400,
  action_not_offered: 409,
  destination_required: 400,
};

/** Express handler for requests that matched no route. */
export function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'not_found', `No route for ${req.method} ${req.path}`));
}

/**
 * Express error handler (four arguments, so Express recognises it as one).
 * @param {{ error: (...args: unknown[]) => void }} logger
 */
export function createErrorHandler(logger = console) {
  return function errorHandler(err, _req, res, _next) {
    if (res.headersSent) return;

    if (err instanceof AppError) {
      const error = { code: err.code, message: err.message };
      if (err.details) error.details = err.details;
      return res.status(err.status).json({ error });
    }
    // Safety net: validation that happened below the route (inside a service) is still the client's mistake.
    if (err instanceof ZodError) {
      const details = err.issues
        .slice(0, 8)
        .map((i) => ({ path: i.path.join('.'), message: i.message }));
      return res.status(400).json({
        error: { code: 'validation_failed', message: 'The request is not valid', details },
      });
    }
    if (err instanceof RunError) {
      return res
        .status(RUN_STATUS[err.code] ?? 400)
        .json({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ApprovalError) {
      return res
        .status(APPROVAL_STATUS[err.code] ?? 400)
        .json({ error: { code: err.code, message: err.message } });
    }

    // body-parser errors carry a status and a type; translate the common ones.
    if (err?.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    }
    if (err?.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
    }

    logger.error('Unhandled error:', err);
    res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Something went wrong on the server' } });
  };
}
