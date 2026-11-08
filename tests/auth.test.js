import test from 'node:test';
import assert from 'node:assert/strict';
import { authorise } from '../api/_lib/auth.js';
import { loadAuthConfig, parseStaff } from '../api/_lib/config.js';
import { setAuditSink } from '../api/_lib/audit.js';
import { HttpError } from '../api/_lib/http.js';
import { authConfig, azureUser, req, supabaseFetch, TENANT } from './helpers.js';

const audits = [];
setAuditSink((l) => audits.push(JSON.parse(l)));
const status = async (p) => { try { await p; return 200; } catch (e) { assert.ok(e instanceof HttpError, String(e)); return e.status; } };
const VIEW = 'listings.view';

test('no token: 401 and Supabase is never called', async () => {
  const calls = [];
  assert.equal(await status(authorise({ headers: {} }, VIEW, { authConfig: authConfig(), fetch: supabaseFetch(azureUser(), 200, calls) })), 401);
  assert.equal(calls.length, 0);
});
test('malformed Authorization header: 401', async () => {
  assert.equal(await status(authorise({ headers: { authorization: 'Basic abc' } }, VIEW, { authConfig: authConfig(), fetch: supabaseFetch(azureUser()) })), 401);
});
test('token rejected by Supabase: 401', async () => {
  assert.equal(await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch({}, 401) })), 401);
});
test('Supabase unreachable: 503, not an allow', async () => {
  const boom = async () => { throw new Error('network'); };
  assert.equal(await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: boom })), 503);
  assert.equal(await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch({}, 500) })), 503);
});
test('email/password account with an allowlisted address: 403', async () => {
  const u = azureUser({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email', identity_data: {} }] });
  assert.equal(await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch(u) })), 403);
});
test('Microsoft account from another tenant: 403', async () => {
  const u = azureUser({ user_metadata: { iss: 'https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/v2.0' }, identities: [{ provider: 'azure', identity_data: {} }] });
  assert.equal(await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch(u) })), 403);
});
test('SDAHC account that is not on the allowlist, or inactive: 403', async () => {
  const u = azureUser({ email: 'stranger@sdahomechoices.com.au' });
  assert.equal(await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch(u) })), 403);
  const off = authConfig([{ email: 'ali@sdahomechoices.com.au', capabilities: [VIEW], active: false, authUserId: null }]);
  assert.equal(await status(authorise(req(), VIEW, { authConfig: off, fetch: supabaseFetch(azureUser()) })), 403);
});
test('a bound identity refuses a different Supabase user with the same email', async () => {
  const bound = authConfig([{ email: 'ali@sdahomechoices.com.au', capabilities: [VIEW], active: true, authUserId: '99999999-9999-4999-8999-999999999999' }]);
  assert.equal(await status(authorise(req(), VIEW, { authConfig: bound, fetch: supabaseFetch(azureUser()) })), 403);
});
test('missing capability: 403 (viewer cannot publish)', async () => {
  const viewer = authConfig([{ email: 'ali@sdahomechoices.com.au', capabilities: [VIEW], active: true, authUserId: null }]);
  assert.equal(await status(authorise(req(), 'listings.publish', { authConfig: viewer, fetch: supabaseFetch(azureUser()) })), 403);
});
test('authorised staff pass, and the decision is audited', async () => {
  audits.length = 0;
  const r = await authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch(azureUser()) });
  assert.equal(r.staff.email, 'ali@sdahomechoices.com.au');
  assert.equal(audits.at(-1).outcome, 'allowed');
});
test('denials are audited with the reason but never the token', async () => {
  audits.length = 0;
  await status(authorise(req(), VIEW, { authConfig: authConfig(), fetch: supabaseFetch(azureUser({ email: 'x@sdahomechoices.com.au' })) }));
  assert.equal(audits.at(-1).detail.reason, 'not_on_allowlist');
  assert.ok(!JSON.stringify(audits).includes('tok_'));
});

test('missing or malformed configuration fails closed with 503', async () => {
  assert.equal(await status(authorise(req(), VIEW, { env: {}, fetch: supabaseFetch(azureUser()) })), 503);
  const base = { LISTINGS_SUPABASE_URL: 'https://example.supabase.co', LISTINGS_SUPABASE_ANON_KEY: 'k', AZURE_TENANT_ID: TENANT, LISTINGS_STAFF_JSON: '[]' };
  assert.equal(await status(authorise(req(), VIEW, { env: base, fetch: supabaseFetch(azureUser()) })), 503, 'empty staff list');
  assert.equal(await status(authorise(req(), VIEW, { env: { ...base, LISTINGS_STAFF_JSON: 'nope' }, fetch: supabaseFetch(azureUser()) })), 503);
  assert.throws(() => loadAuthConfig({ ...base, AZURE_TENANT_ID: 'common', LISTINGS_STAFF_JSON: '[{"email":"a@b.co","capabilities":["listings.view"]}]' }));
  assert.throws(() => loadAuthConfig({ ...base, LISTINGS_SUPABASE_URL: 'http://evil.test', LISTINGS_STAFF_JSON: '[{"email":"a@b.co","capabilities":["listings.view"]}]' }));
});
test('staff JSON rejects unknown capabilities, duplicates and bad emails', () => {
  assert.throws(() => parseStaff('[{"email":"a@b.co","capabilities":["root"]}]'));
  assert.throws(() => parseStaff('[{"email":"a@b.co","capabilities":[]},{"email":"A@b.co","capabilities":[]}]'));
  assert.throws(() => parseStaff('[{"email":"nope","capabilities":[]}]'));
  assert.equal(parseStaff('[{"email":"A@B.co","capabilities":["listings.view"]}]')[0].email, 'a@b.co');
});
