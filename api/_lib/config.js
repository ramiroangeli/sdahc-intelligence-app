// Configuration from environment variables. Missing or malformed values THROW ConfigError and the caller
// answers 503 without doing any work: the API fails closed. Nothing here has a permissive default for security.
import { ALL_CAPABILITIES } from './permissions.js';

export class ConfigError extends Error {}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const val = (env, k) => (typeof env[k] === 'string' ? env[k].trim() : '');

export function parseStaff(raw) {
  let list;
  try { list = JSON.parse(raw); } catch { throw new ConfigError('LISTINGS_STAFF_JSON is not valid JSON'); }
  if (!Array.isArray(list) || list.length === 0) throw new ConfigError('LISTINGS_STAFF_JSON must be a non-empty array');
  const seen = new Set();
  return list.map((row, i) => {
    const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new ConfigError(`LISTINGS_STAFF_JSON entry ${i} has no valid email`);
    if (seen.has(email)) throw new ConfigError(`LISTINGS_STAFF_JSON lists ${email} twice`);
    seen.add(email);
    const caps = row.capabilities;
    if (!Array.isArray(caps) || caps.some((c) => !ALL_CAPABILITIES.includes(c))) throw new ConfigError(`LISTINGS_STAFF_JSON entry ${i} has unknown capabilities`);
    if (row.authUserId !== undefined && !GUID_RE.test(String(row.authUserId))) throw new ConfigError(`LISTINGS_STAFF_JSON entry ${i} has an invalid authUserId`);
    if (row.notionUserId !== undefined && !GUID_RE.test(String(row.notionUserId))) throw new ConfigError(`LISTINGS_STAFF_JSON entry ${i} has an invalid notionUserId`);
    // notionUserId: this person's Notion user id. It becomes "Web Approved By" and must also be on the website's approvers list.
    return { email, capabilities: [...new Set(caps)], active: row.active !== false, authUserId: row.authUserId ? String(row.authUserId).toLowerCase() : null, notionUserId: row.notionUserId ? String(row.notionUserId).toLowerCase() : null };
  });
}

/** Everything needed to decide WHO may call. All required. */
export function loadAuthConfig(env = process.env) {
  const supabaseUrl = val(env, 'LISTINGS_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = val(env, 'LISTINGS_SUPABASE_ANON_KEY');
  const tenantId = val(env, 'AZURE_TENANT_ID').toLowerCase();
  const staffRaw = val(env, 'LISTINGS_STAFF_JSON');
  const missing = [];
  if (!supabaseUrl) missing.push('LISTINGS_SUPABASE_URL');
  if (!anonKey) missing.push('LISTINGS_SUPABASE_ANON_KEY');
  if (!tenantId) missing.push('AZURE_TENANT_ID');
  if (!staffRaw) missing.push('LISTINGS_STAFF_JSON');
  if (missing.length) throw new ConfigError(`missing configuration: ${missing.join(', ')}`);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) throw new ConfigError('LISTINGS_SUPABASE_URL must be an https supabase.co origin');
  if (!GUID_RE.test(tenantId)) throw new ConfigError('AZURE_TENANT_ID must be a GUID');
  return { supabaseUrl, anonKey, tenantId, staff: parseStaff(staffRaw) };
}

/** Where the listing data comes from. Notion is optional so a missing token degrades visibly instead of failing. */
export function loadDataConfig(env = process.env) {
  const token = val(env, 'NOTION_LISTINGS_TOKEN');
  const dataSourceId = val(env, 'NOTION_PROPERTIES_DATA_SOURCE_ID').replace(/^collection:\/\//, '');
  const repo = val(env, 'LISTINGS_GITHUB_REPO') || 'ramiroangeli/sdahc-website';
  const ref = val(env, 'LISTINGS_GITHUB_REF') || 'main';
  const siteBase = (val(env, 'LISTINGS_SITE_BASE_URL') || 'https://sdahomechoices.com.au').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ConfigError('LISTINGS_GITHUB_REPO must be owner/name');
  if (!/^https:\/\/[a-z0-9.-]+$/.test(siteBase)) throw new ConfigError('LISTINGS_SITE_BASE_URL must be an https origin');
  return {
    notion: token && dataSourceId ? { token, dataSourceId, version: val(env, 'NOTION_API_VERSION') || '2026-03-11' } : null,
    repo,
    ref,
    siteBase,
    // optional, read-only; only raises GitHub's anonymous rate limit
    githubReadToken: val(env, 'LISTINGS_GITHUB_READ_TOKEN') || null,
  };
}

/** What publication jobs need. Both are server-side secrets. Missing or weak means publishing answers 503 and does nothing. */
export function loadPublishConfig(env = process.env) {
  const githubToken = val(env, 'LISTINGS_GITHUB_DISPATCH_TOKEN');
  const callbackSecret = val(env, 'LISTINGS_CALLBACK_SECRET');
  const missing = [];
  if (!githubToken) missing.push('LISTINGS_GITHUB_DISPATCH_TOKEN');
  if (callbackSecret.length < 32) missing.push('LISTINGS_CALLBACK_SECRET (at least 32 characters)');
  if (missing.length) throw new ConfigError(`missing configuration: ${missing.join(', ')}`);
  const workflow = val(env, 'LISTINGS_PUBLISH_WORKFLOW') || 'publish-listing.yml';
  if (!/^[\w.-]+\.ya?ml$/.test(workflow)) throw new ConfigError('LISTINGS_PUBLISH_WORKFLOW must be a workflow file name');
  return { githubToken, callbackSecret, workflow };
}
