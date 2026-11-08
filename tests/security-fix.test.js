import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probe } from '../scripts/probe-supabase-exposure.mjs';

const settings = (over) => ({ external: { azure: true, email: true }, disable_signup: false, mailer_autoconfirm: false, ...over });
const fakeFetch = ({ anon = 401, set = settings(), tenant = '207ef305-ee7d-4c16-a5b3-c3bdf7b1b29b' } = {}) => async (url) => {
  const u = String(url);
  if (u.includes('/rest/v1/')) return { status: anon };
  if (u.includes('/auth/v1/settings')) return { json: async () => set };
  return { headers: { get: () => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?x=1` } };
};
const run = (o) => probe({ url: 'https://x.supabase.co', anonKey: 'k', fetchImpl: fakeFetch(o) });
const failed = (fs) => fs.filter((f) => !f.ok).map((f) => f.id);

test('probe flags open email sign-up as the exposure', async () => {
  assert.deepEqual(failed(await run()), ['email-signup']);
});
test('probe passes when the Email provider is disabled', async () => {
  assert.deepEqual(failed(await run({ set: settings({ external: { azure: true, email: false } }) })), []);
});
test('probe flags anon read access and a non-SDAHC tenant', async () => {
  assert.deepEqual(failed(await run({ anon: 200, set: settings({ external: { azure: true, email: false } }), tenant: 'common' })), ['anon-analytics', 'anon-raw', 'azure-tenant']);
});

test('proposed SQL restricts the policy to the azure provider, is transactional and has a rollback', () => {
  const sql = readFileSync('supabase/proposed/001_analytics_microsoft_only.sql', 'utf8');
  const active = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.match(active, /using \(\s*\(auth\.jwt\(\) -> 'app_metadata' ->> 'provider'\) = 'azure'\s*\)/);
  assert.match(active, /^begin;/m);
  assert.match(active, /^commit;/m);
  assert.ok(!/using \(true\)/i.test(active), 'the active statements must not reopen the policy');
  assert.match(sql, /ROLLBACK/);
  assert.ok(!/grant\s/i.test(active) && !/service_role/i.test(active), 'no new grants');
});
