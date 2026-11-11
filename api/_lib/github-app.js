// GitHub App authentication for the publication workflow dispatch. Replaces the expiring personal access token.
//   - the App's private key signs a short JWT (RS256, 9 minutes) that only proves who we are to GitHub
//   - GitHub exchanges it for an installation token limited to ONE repository and ONE permission (Actions: write), valid for one hour
//   - the installation token is kept in memory only, reused until 5 minutes before it expires, and never logged, stored or returned
// Nothing here is persistent, and no error carries a response body, the key or a token.
import { createPrivateKey, createSign } from 'node:crypto';
import { ConfigError } from './config.js';

const API = 'https://api.github.com';
const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const DIGITS = /^\d{1,20}$/;
const val = (env, k) => (typeof env[k] === 'string' ? env[k].trim() : '');

export class GithubAppError extends Error {
  constructor(code, reason, status = null) { super(reason); this.code = code; this.reason = reason; this.status = status; }
}

/**
 * The key as stored in an environment variable: a PEM with real line breaks, a PEM whose breaks were saved as the two characters \n, or the
 * whole PEM base64-encoded. Anything else is refused. Returns a node KeyObject (private).
 */
export function parsePrivateKey(raw) {
  let text = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (!text.includes('-----BEGIN')) { try { text = Buffer.from(text, 'base64').toString('utf8'); } catch { /* not base64 */ } }
  text = text.replace(/\\n/g, '\n').trim();
  if (!/^-----BEGIN (RSA )?PRIVATE KEY-----[\s\S]+-----END (RSA )?PRIVATE KEY-----$/.test(text)) throw new ConfigError('LISTINGS_GITHUB_APP_PRIVATE_KEY is not a PEM private key');
  try {
    const key = createPrivateKey(text);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not rsa');
    return key;
  } catch { throw new ConfigError('LISTINGS_GITHUB_APP_PRIVATE_KEY could not be read as an RSA private key'); }
}

/** null when no App variable is set at all; throws ConfigError when it is only partly or wrongly set. */
export function loadAppConfig(env = process.env) {
  const appId = val(env, 'LISTINGS_GITHUB_APP_ID');
  const installationId = val(env, 'LISTINGS_GITHUB_APP_INSTALLATION_ID');
  const rawKey = val(env, 'LISTINGS_GITHUB_APP_PRIVATE_KEY');
  if (!appId && !installationId && !rawKey) return null;
  const missing = [];
  if (!appId) missing.push('LISTINGS_GITHUB_APP_ID');
  if (!installationId) missing.push('LISTINGS_GITHUB_APP_INSTALLATION_ID');
  if (!rawKey) missing.push('LISTINGS_GITHUB_APP_PRIVATE_KEY');
  if (missing.length) throw new ConfigError(`missing configuration: ${missing.join(', ')}`);
  if (!DIGITS.test(appId)) throw new ConfigError('LISTINGS_GITHUB_APP_ID must be the numeric App ID');
  if (!DIGITS.test(installationId)) throw new ConfigError('LISTINGS_GITHUB_APP_INSTALLATION_ID must be numeric');
  return { appId, installationId, privateKey: parsePrivateKey(rawKey) };
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** The JWT GitHub asks for: issued 60 seconds in the past (clock drift), valid 9 minutes (GitHub allows 10 at most). */
export function appJwt({ appId, privateKey }, nowMs = Date.now()) {
  const iat = Math.floor(nowMs / 1000) - 60;
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 60 + 9 * 60, iss: appId }));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64url(sig)}`;
}

const cache = new Map(); // key -> { token, expiresAt, meta } | Promise
export const clearInstallationTokens = () => cache.clear();

const explain = (status) => {
  if (status === 401) return 'GitHub did not accept the App credentials (check LISTINGS_GITHUB_APP_ID and the private key).';
  if (status === 403) return 'GitHub refused to issue the App token.';
  if (status === 404) return 'The App installation was not found (check LISTINGS_GITHUB_APP_INSTALLATION_ID and that the App is installed on the website repository).';
  if (status === 422) return 'GitHub refused the requested App token scope (is the App installed on the website repository with Actions: Read and write?).';
  return 'GitHub answered with an unexpected status while issuing the App token.';
};

/**
 * An installation token limited to `repo` (owner/name) and to `permissions` (default: Actions write). Cached per scope until 5 minutes before
 * it expires. Returns { token, expiresAt, permissions, repositorySelection, repositories }; callers must never log or return `token`.
 */
export async function installationToken(app, { repo, permissions = { actions: 'write' }, fetchImpl = fetch, now = Date.now } = {}) {
  const name = String(repo ?? '').split('/')[1];
  if (!name) throw new GithubAppError('bad_repo', 'The website repository name is not valid.');
  const key = `${app.installationId}|${repo}|${JSON.stringify(permissions)}`;
  const hit = cache.get(key);
  if (hit && !(hit instanceof Promise) && hit.expiresAt - now() > REFRESH_BEFORE_MS) return hit;
  if (hit instanceof Promise) return hit; // a mint for this scope is already in flight
  const pending = (async () => {
    let res;
    try {
      res = await fetchImpl(`${API}/app/installations/${app.installationId}/access_tokens`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${appJwt(app, now())}`, 'User-Agent': 'sdahc-listings-manager', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositories: [name], permissions }),
        signal: AbortSignal.timeout(15000),
      });
    } catch { throw new GithubAppError('unreachable', 'GitHub could not be reached to issue the App token.'); }
    if (res.status !== 201) throw new GithubAppError('mint_failed', `${explain(res.status)} (GitHub HTTP ${res.status})`, res.status);
    let data; try { data = await res.json(); } catch { data = null; }
    const expiresAt = Date.parse(data?.expires_at ?? '');
    if (typeof data?.token !== 'string' || !data.token || !Number.isFinite(expiresAt)) throw new GithubAppError('mint_failed', 'GitHub returned an App token in an unexpected form.');
    return { token: data.token, expiresAt, permissions: data.permissions ?? {}, repositorySelection: data.repository_selection ?? null, repositories: (data.repositories ?? []).map((r) => r.full_name ?? r.name) };
  })();
  cache.set(key, pending);
  try { const out = await pending; cache.set(key, out); return out; } catch (e) { cache.delete(key); throw e; }
}

/**
 * Administrator diagnostic, read only: can this deployment obtain an App token for the website repository, and does that token see the
 * publication workflow? Starts nothing. Answers with a verdict and the token's scope, never the token.
 */
export async function checkGithubApp({ env = process.env, repo, workflow, fetchImpl = fetch, now = Date.now }) {
  let app;
  try { app = loadAppConfig(env); } catch (e) { return { ok: false, verdict: `NOT CONFIGURED: ${e.message}` }; }
  if (!app) return { ok: false, verdict: 'NOT CONFIGURED: the GitHub App variables are not set on this deployment.' };
  try {
    const t = await installationToken(app, { repo, fetchImpl, now });
    const res = await fetchImpl(`${API}/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${t.token}`, 'User-Agent': 'sdahc-listings-manager' }, signal: AbortSignal.timeout(15000) });
    const wf = res.status === 200 ? await res.json().catch(() => null) : null;
    const scoped = t.repositories.length === 1 && t.repositories[0] === repo;
    const ok = res.status === 200 && wf?.state === 'active' && t.permissions.actions === 'write' && scoped;
    return {
      ok, tokenIssued: true, repositories: t.repositories, permissions: t.permissions, repositorySelection: t.repositorySelection,
      workflowFound: res.status === 200, workflowState: wf?.state ?? null,
      verdict: ok ? `APP TOKEN OK: scoped to ${repo} with Actions write; the publication workflow is visible..`
        : `APP TOKEN ISSUED BUT NOT SUFFICIENT: workflow lookup HTTP ${res.status}, actions=${t.permissions.actions ?? 'none'}, repositories=${t.repositories.length}.`,
    };
  } catch (e) {
    if (e instanceof GithubAppError) return { ok: false, tokenIssued: false, verdict: `FAILED: ${e.reason}` };
    return { ok: false, tokenIssued: false, verdict: 'FAILED: the check could not be completed.' };
  }
}
