// Server-side authorisation for every Listings endpoint. Order of checks (any failure denies):
//  1. configuration present and valid (else 503, nothing else runs)
//  2. a bearer token, validated by Supabase Auth on the server (not just decoded)
//  3. the account is Microsoft (azure) AND in the SDAHC tenant
//  4. the email is on the explicit staff allowlist, active, and (if bound) the same Supabase user
//  5. the required capability
// Client-facing errors are generic. The precise reason goes to the audit log only.
import { audit } from './audit.js';
import { loadAuthConfig, ConfigError } from './config.js';
import { HttpError, bearerToken } from './http.js';
import { decideAccess, extractIdentity } from './identity.js';
import { hasCapability } from './permissions.js';

async function fetchSupabaseUser(cfg, token, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError(503, 'auth_unavailable');
  }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new HttpError(503, 'auth_unavailable');
  try { return await res.json(); } catch { throw new HttpError(503, 'auth_unavailable'); }
}

export async function authorise(req, capability, deps = {}) {
  let cfg = deps.authConfig;
  if (!cfg) {
    try { cfg = loadAuthConfig(deps.env ?? process.env); } catch (e) {
      if (e instanceof ConfigError) {
        audit({ action: 'listings.authorise', outcome: 'config_error', detail: { message: e.message } });
        throw new HttpError(503, 'not_configured');
      }
      throw e;
    }
  }
  const token = bearerToken(req);
  if (!token) throw new HttpError(401, 'unauthenticated');

  const user = await fetchSupabaseUser(cfg, token, deps.fetch ?? fetch);
  if (!user) throw new HttpError(401, 'unauthenticated');

  const identity = extractIdentity(user);
  const deny = (reason) => {
    audit({ action: 'listings.authorise', outcome: 'denied', actor: identity, detail: { reason, capability } });
    return new HttpError(403, 'forbidden');
  };
  const decision = decideAccess(identity, cfg.tenantId);
  if (!decision.ok) throw deny(decision.reason);

  const staff = cfg.staff.find((s) => s.email === identity.email);
  if (!staff || !staff.active) throw deny('not_on_allowlist');
  if (staff.authUserId && staff.authUserId !== identity.authUserId.toLowerCase()) throw deny('identity_mismatch');
  if (!hasCapability(staff, capability)) throw deny('missing_capability');

  audit({ action: 'listings.authorise', outcome: 'allowed', actor: identity, detail: { capability, bound: Boolean(staff.authUserId) } });
  return { staff, identity };
}
