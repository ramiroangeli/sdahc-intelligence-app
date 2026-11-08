// Verifies WHO signed in with Microsoft, from the claims Supabase Auth stores on the user.
// Adapted from 63_sdahc_RFI_system/src/shared/identity.ts. Pure functions. Never authorise on an email alone:
// the account must come from the Azure provider, belong to the SDAHC tenant, and (in staff.js) be on the allowlist.
// Everything unknown fails CLOSED.

const GUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const GUID_RE = new RegExp(`^${GUID}$`, 'i');
// Anchored: lookalike hosts do not match.
const ISSUER = new RegExp(`^https://(?:login\\.microsoftonline\\.com|sts\\.windows\\.net)/(${GUID})(?:/|$)`, 'i');

export function tenantFromIssuer(iss) {
  if (typeof iss !== 'string') return null;
  const m = ISSUER.exec(iss.trim());
  return m ? m[1].toLowerCase() : null;
}

function tenantFromClaims(claims) {
  if (!claims || typeof claims !== 'object') return [];
  const found = [];
  const fromIss = tenantFromIssuer(claims.iss);
  if (fromIss) found.push(fromIss);
  for (const tid of [claims.tid, claims.custom_claims?.tid]) {
    if (typeof tid === 'string' && GUID_RE.test(tid)) found.push(tid.toLowerCase());
  }
  return found;
}

export function extractIdentity(user) {
  const azure = (user?.identities ?? []).filter((i) => i?.provider === 'azure');
  const tenants = new Set([
    ...tenantFromClaims(user?.user_metadata),
    ...azure.flatMap((i) => tenantFromClaims(i.identity_data)),
  ]);
  const rawEmail = user?.email ?? azure.map((i) => i.identity_data?.email).find((e) => typeof e === 'string') ?? null;
  const email = rawEmail ? String(rawEmail).trim().toLowerCase() : null;
  return {
    authUserId: typeof user?.id === 'string' ? user.id : null,
    email: email || null,
    provider: user?.app_metadata?.provider ?? null,
    tenantId: tenants.size === 1 ? [...tenants][0] : null,
    tenantConflict: tenants.size > 1,
    hasAzureIdentity: azure.length > 0,
  };
}

export function decideAccess(identity, expectedTenantId) {
  if (!identity.authUserId) return { ok: false, reason: 'no_user' };
  if (identity.provider !== 'azure' || !identity.hasAzureIdentity) return { ok: false, reason: 'not_microsoft' };
  if (!identity.email) return { ok: false, reason: 'no_email' };
  if (identity.tenantConflict) return { ok: false, reason: 'tenant_conflict' };
  if (!identity.tenantId) return { ok: false, reason: 'tenant_unknown' };
  if (!expectedTenantId || identity.tenantId !== String(expectedTenantId).toLowerCase()) return { ok: false, reason: 'tenant_mismatch' };
  return { ok: true };
}
