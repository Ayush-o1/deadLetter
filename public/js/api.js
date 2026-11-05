// The only place the app talks to the server.
export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = error?.code ?? 'error';
    this.details = error?.details;
  }
}

async function request(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, {
      code: 'network',
      message: 'Could not reach the server. Is it running?',
    });
  }
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) throw new ApiError(response.status, json?.error);
  return json;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  delete: (path, body) => request('DELETE', path, body),
};

/** Query string from an object, skipping empty values. */
export function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== '' && v !== undefined && v !== null) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
}
