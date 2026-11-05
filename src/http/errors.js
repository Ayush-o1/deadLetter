// Error handling for the HTTP layer.
//
// Rule: a client only ever sees { error: { code, message } }. Stack traces and
// internal messages stay in the server log, because they can reveal file paths,
// SQL or configuration.

export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code short machine-readable code, e.g. "not_found"
   * @param {string} message safe to show to the client
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

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
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
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
