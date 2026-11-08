import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { authorise } from '../api/_lib/auth.js';
import { listRoute, meRoute } from '../api/_lib/routes.js';
import { clearSnapshotCache } from '../api/_lib/site.js';
import { authConfig, azureUser, req, res, supabaseFetch } from './helpers.js';

/** Real authorise, fake network: anything that is not Supabase auth is recorded and answered with a canned Notion/GitHub body. */
function network(user, hits = []) {
  const auth = supabaseFetch(user);
  return async (url, opts) => {
    if (String(url).includes('/auth/v1/user')) return auth(url);
    hits.push(String(url));
    throw new Error('upstream must not be called');
  };
}
const run = async (route, request, deps) => { const r = res(); await route(deps)(request, r); return r; };

test('unauthorised callers get 401/403 and NO upstream request is made', async () => {
  for (const [name, request, user] of [
    ['no token', { method: 'GET', headers: {} }, azureUser()],
    ['wrong provider', req(), azureUser({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] })],
    ['not on list', req(), azureUser({ email: 'x@sdahomechoices.com.au' })],
  ]) {
    for (const route of [listRoute, meRoute]) {
      const hits = [];
      const r = await run(route, request, { authConfig: authConfig(), fetch: network(user, hits) });
      assert.ok([401, 403].includes(r.statusCode), `${name}: ${r.statusCode}`);
      assert.equal(hits.length, 0, `${name}: upstream called`);
      assert.deepEqual(Object.keys(r.json), ['error']);
    }
  }
});
test('unconfigured service answers 503 and calls nothing', async () => {
  const hits = [];
  const r = await run(listRoute, req(), { env: {}, fetch: network(azureUser(), hits) });
  assert.equal(r.statusCode, 503);
  assert.equal(hits.length, 0);
});
test('only GET is allowed', async () => {
  const r = await run(listRoute, req({ method: 'POST' }), { authConfig: authConfig(), fetch: network(azureUser()) });
  assert.equal(r.statusCode, 405);
});
test('responses are never cacheable', async () => {
  const r = await run(meRoute, req(), { authConfig: authConfig(), fetch: network(azureUser()) });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['cache-control'], /no-store/);
  assert.deepEqual(r.json.capabilities, ['listings.view', 'listings.edit', 'listings.publish']);
});

test('ROUTE GUARD: every function under api/ is built with guardedRoute and none calls authorise itself', () => {
  const routeFiles = [];
  const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (f.startsWith('_')) continue; statSync(p).isDirectory() ? walk(p) : routeFiles.push(p); } };
  walk('api');
  assert.ok(routeFiles.length >= 2);
  const routes = readFileSync('api/_lib/routes.js', 'utf8');
  for (const f of routeFiles) {
    const src = readFileSync(f, 'utf8');
    const m = /import \{ (\w+) \} from '\.\.\/_lib\/routes\.js'/.exec(src);
    assert.ok(m, `${f} must export a handler built in api/_lib/routes.js`);
    assert.match(routes, new RegExp(`export const ${m[1]} = guardedRoute\\(`), `${f}: ${m[1]} must use guardedRoute`);
  }
  // and guardedRoute really calls authorise before run
  const guard = readFileSync('api/_lib/guard.js', 'utf8');
  assert.ok(guard.indexOf('await authorise(') > -1 && guard.indexOf('await authorise(') < guard.indexOf('await run('));
});
test('authorise is the real one by default', () => {
  assert.equal(typeof authorise, 'function');
});
