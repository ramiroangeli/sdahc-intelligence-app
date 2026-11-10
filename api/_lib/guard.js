// The one way to build a Listings endpoint. It enforces the method, then authorisation, and only then calls
// `run`. A test (tests/routes.test.js, "ROUTE GUARD") fails if any file under api/ serves a route without using it.
import { authorise as realAuthorise } from './auth.js';
import { ConfigError } from './config.js';
import { HttpError, RawResponse, sendJson, sendRaw } from './http.js';

/** `capability` is one string, or an object mapping each allowed method to the capability it needs. */
export function guardedRoute({ capability, methods, run }) {
  const byMethod = typeof capability === 'string' ? Object.fromEntries((methods ?? ['GET']).map((m) => [m, capability])) : capability;
  return function routeFactory(deps = {}) {
    const authorise = deps.authorise ?? realAuthorise;
    return async function handler(req, res) {
      try {
        const needed = byMethod[req.method];
        if (!needed) {
          res.setHeader('Allow', Object.keys(byMethod).join(', '));
          throw new HttpError(405, 'method_not_allowed');
        }
        const session = await authorise(req, needed, deps);
        const out = await run({ req, session, deps });
        if (out instanceof RawResponse) sendRaw(res, out); else sendJson(res, 200, out);
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code, ...(e.extra ?? {}) });
        if (e instanceof ConfigError) return sendJson(res, 503, { error: 'not_configured' });
        // never echo internals, tokens or upstream bodies
        console.error('listings route failed:', e?.name, e?.message);
        sendJson(res, 500, { error: 'internal_error' });
      }
    };
  };
}
