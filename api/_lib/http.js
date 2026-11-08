// Small HTTP helpers shared by every function. No framework: works with Vercel's Node runtime and with plain
// node:http (used by the local dev server and the tests).

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Private, user-specific data: never cache in a shared cache or the browser.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

export function bearerToken(req) {
  const h = req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,4096})$/.exec(h.trim());
  return m ? m[1] : null;
}
