// Endpoints called by the website repository's publication job, not by a person. They are authenticated by a signed request
// (HMAC with LISTINGS_CALLBACK_SECRET, five minute window), checked BEFORE anything else runs. A test (tests/routes.test.js) fails if a file
// under api/ serves a route that uses neither guardedRoute nor signedRoute.
import { ConfigError } from './config.js';
import { HttpError, readRawText, sendJson } from './http.js';
import { verifySignature } from './signing.js';

export function signedRoute({ methods, run }) {
  return function routeFactory(deps = {}) {
    return async function handler(req, res) {
      try {
        if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); throw new HttpError(405, 'method_not_allowed'); }
        const secret = ((deps.env ?? process.env).LISTINGS_CALLBACK_SECRET ?? '').trim();
        if (secret.length < 32) throw new HttpError(503, 'not_configured');
        const raw = req.method === 'GET' ? `GET:${req.url}` : await readRawText(req);
        const h = req.headers ?? {};
        if (!verifySignature(secret, h['x-listings-timestamp'], raw, h['x-listings-signature'], (deps.now ?? Date.now)())) throw new HttpError(401, 'unauthenticated');
        sendJson(res, 200, await run({ req, raw, deps }));
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, ...(e.extra ?? {}) });
        if (e instanceof ConfigError) return sendJson(res, 503, { error: 'not_configured' });
        console.error('signed route failed:', e?.name, e?.message);
        sendJson(res, 500, { error: 'internal_error' });
      }
    };
  };
}
