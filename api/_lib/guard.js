// The one way to build a Listings endpoint. It enforces the method, then authorisation, and only then calls
// `run`. A test (tests/route-guard.test.js) fails if any file under api/ serves a route without using it.
import { authorise as realAuthorise } from './auth.js';
import { ConfigError } from './config.js';
import { HttpError, sendJson } from './http.js';

export function guardedRoute({ capability, methods = ['GET'], run }) {
  return function routeFactory(deps = {}) {
    const authorise = deps.authorise ?? realAuthorise;
    return async function handler(req, res) {
      try {
        if (!methods.includes(req.method)) {
          res.setHeader('Allow', methods.join(', '));
          throw new HttpError(405, 'method_not_allowed');
        }
        const session = await authorise(req, capability, deps);
        sendJson(res, 200, await run({ req, session, deps }));
      } catch (e) {
        if (e instanceof HttpError) return sendJson(res, e.status, { error: e.code });
        if (e instanceof ConfigError) return sendJson(res, 503, { error: 'not_configured' });
        // never echo internals, tokens or upstream bodies
        console.error('listings route failed:', e?.name, e?.message);
        sendJson(res, 500, { error: 'internal_error' });
      }
    };
  };
}
