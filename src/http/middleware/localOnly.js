// Protection for a local service with no login.
//
// deadLetter binds to the loopback interface, but a web page you visit can still try
// to reach it from your own browser. Two cheap checks close the known routes:
//
//   Host header   Only loopback names (and any you list) are served. This defeats
//                 "DNS rebinding", where a hostile site's domain is pointed at
//                 127.0.0.1 so that the browser treats our API as same-origin with
//                 the hostile page.
//   Origin header If a request carries an Origin (browsers add one to cross-origin
//                 and to state-changing requests), it must be this very server.
//                 Requests without one (curl, the tests, same-origin GETs) pass.
//
// Neither is authentication. They narrow who can reach the API from a browser.
import { AppError } from '../errors.js';

export const DEFAULT_ALLOWED_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]']);

/** "Example.com:3000" -> "example.com"; "[::1]:3000" -> "[::1]" */
function hostnameOf(hostHeader) {
  const h = String(hostHeader ?? '').toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

/** @param {{ allowedHosts?: string[] }} [opts] */
export function localOnly({ allowedHosts = DEFAULT_ALLOWED_HOSTS } = {}) {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return function localOnlyMiddleware(req, _res, next) {
    if (!allowed.has(hostnameOf(req.headers.host))) {
      return next(
        new AppError(403, 'forbidden_host', 'This server only answers to its own address'),
      );
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let originHost;
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = null;
      }
      if (originHost !== String(req.headers.host).toLowerCase()) {
        return next(
          new AppError(403, 'forbidden_origin', 'Requests from other sites are not accepted'),
        );
      }
    }
    next();
  };
}
