import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, extractIdentity, tenantFromIssuer } from '../api/_lib/identity.js';
import { TENANT, azureUser } from './helpers.js';

test('accepts an Azure account from the SDAHC tenant', () => {
  assert.deepEqual(decideAccess(extractIdentity(azureUser()), TENANT), { ok: true });
});
test('refuses an email/password account even with an SDAHC address', () => {
  const u = azureUser({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email', identity_data: {} }] });
  assert.equal(decideAccess(extractIdentity(u), TENANT).reason, 'not_microsoft');
});
test('refuses another tenant, an unknown tenant and conflicting tenants', () => {
  const other = azureUser({ user_metadata: { iss: 'https://login.microsoftonline.com/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/v2.0' }, identities: [{ provider: 'azure', identity_data: {} }] });
  assert.equal(decideAccess(extractIdentity(other), TENANT).reason, 'tenant_mismatch');
  const none = azureUser({ user_metadata: {}, identities: [{ provider: 'azure', identity_data: { email: 'a@b.co' } }] });
  assert.equal(decideAccess(extractIdentity(none), TENANT).reason, 'tenant_unknown');
  const conflict = azureUser({ user_metadata: { tid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  assert.equal(decideAccess(extractIdentity(conflict), TENANT).reason, 'tenant_conflict');
});
test('lookalike issuer hosts are not trusted', () => {
  assert.equal(tenantFromIssuer(`https://login.microsoftonline.com.evil.test/${TENANT}/v2.0`), null);
  assert.equal(tenantFromIssuer(`https://evil.test/login.microsoftonline.com/${TENANT}/`), null);
});
test('an empty expected tenant never matches', () => {
  assert.equal(decideAccess(extractIdentity(azureUser()), '').ok, false);
});
