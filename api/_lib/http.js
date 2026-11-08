// Small HTTP helpers shared by every function. No framework: works with Vercel's Node runtime and with plain
// node:http (used by the local dev server and the tests).

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
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

export function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  return Object.fromEntries(new URL(req.url ?? '/', 'http://x').searchParams);
}

/** JSON body, at most 64 KB. Vercel pre-parses JSON; plain node streams are read here. */
export async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body)); } catch { throw new HttpError(400, 'invalid_json'); }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 65536) throw new HttpError(413, 'too_large'); chunks.push(c); }
  if (!size) throw new HttpError(400, 'invalid_json');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
}

export const PUBLIC_ID_RE = /^lst_[a-f0-9]{10}$/;
