// What is ACTUALLY on the website. Two independent facts, both read from public sources, so neither depends on Notion:
//  1. the approved snapshot files committed to the website repo (what the next build will contain), and
//  2. a live request to the public listing page (what visitors can see right now).
import { createHash } from 'node:crypto';
import { installationToken } from './github-app.js';

const SLUG_RE = /^[a-z]+(-[a-z]+)*$/;
const COMMERCIAL = new Set(['available', 'under_offer', 'sold']);
let cache = null;

/** Why the website could not be read. kind: rate_limited | http_<status> | timeout | network | bad_content. detail is for administrators only. */
export class SiteReadError extends Error {
  constructor(kind, detail) { super(`website read failed: ${kind}`); this.name = 'SiteReadError'; this.kind = kind; this.detail = detail; }
}
export const siteReadReason = (e) => (e instanceof SiteReadError ? { kind: e.kind, detail: e.detail } : { kind: 'unknown', detail: String(e?.message ?? e).slice(0, 200) });

/**
 * A read-only credential for the GitHub API, in this order: an optional read token, then an installation token from the existing GitHub App
 * (contents: read only, the narrowest scope; no personal token), then nothing (anonymous reads share GitHub's low per-address limit).
 * A failure to mint a token never breaks the read: it falls back to anonymous.
 */
async function readToken(cfg, fetchImpl) {
  if (cfg.githubReadToken) return cfg.githubReadToken;
  if (!cfg.githubApp) return null;
  try { return (await installationToken(cfg.githubApp, { repo: cfg.repo, permissions: { contents: 'read' }, fetchImpl })).token; } catch { return null; }
}

const gh = (token) => ({
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sdahc-listings-manager', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  signal: AbortSignal.timeout(8000),
});

/** One request with one retry for a transient failure (timeout, network, 5xx). 404 is returned to the caller. Anything else throws a classified error. */
async function request(what, url, init, fetchImpl) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, init());
      if (res.ok || res.status === 404) return res;
      const limited = res.status === 429 || (res.status === 403 && res.headers?.get?.('x-ratelimit-remaining') === '0');
      last = new SiteReadError(limited ? 'rate_limited' : `http_${res.status}`, `${what}: HTTP ${res.status}${limited ? ' (GitHub rate limit)' : ''}`);
      if (res.status < 500) break;
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      last = new SiteReadError(timeout ? 'timeout' : 'network', `${what}: ${timeout ? 'timed out' : 'network error'}`);
    }
  }
  throw last;
}

async function listDir(cfg, dir, fetchImpl) {
  const token = await readToken(cfg, fetchImpl);
  const res = await request(`list ${dir}`, `https://api.github.com/repos/${cfg.repo}/contents/${dir}?ref=${encodeURIComponent(cfg.ref)}`, () => gh(token), fetchImpl);
  if (res.status === 404) return [];
  return (await res.json()).filter((f) => f.type === 'file' && f.name.endsWith('.json'));
}

async function readJson(cfg, file, fetchImpl) {
  // download_url is raw.githubusercontent.com: no API rate limit
  const res = await request(`read ${file.name}`, file.download_url, () => ({ signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'sdahc-listings-manager' } }), fetchImpl);
  if (res.status === 404) throw new SiteReadError('http_404', `read ${file.name}: HTTP 404`);
  try { return await res.json(); } catch { throw new SiteReadError('bad_content', `read ${file.name}: not valid JSON`); }
}

/** Copies only the fields the screen needs. A malformed file is reported, never trusted. */
export function pickSnapshot(raw) {
  const slug = raw?.content?.slug;
  if (typeof raw?.listingId !== 'string' || typeof slug !== 'string' || !SLUG_RE.test(slug)) return null;
  if (!Number.isInteger(raw.version) || !COMMERCIAL.has(raw.commercialStatus)) return null;
  return {
    listingId: raw.listingId,
    slug,
    title: typeof raw.content.title === 'string' ? raw.content.title : slug,
    // the PUBLIC address as visitors read it (already public in the website repository); used for the typed confirmation of a withdrawal
    address: raw.content.address && typeof raw.content.address.street === 'string' ? `${raw.content.address.street}, ${raw.content.address.suburb} ${raw.content.address.state} ${raw.content.address.postcode}` : null,
    // the approved public facts shown on the list when no CRM record is matched (already public in the website repository)
    state: typeof raw.content.address?.state === 'string' ? raw.content.address.state : null,
    designCategories: Array.isArray(raw.content.sda?.designCategories) ? raw.content.sda.designCategories.filter((x) => typeof x === 'string') : [],
    buildType: typeof raw.content.sda?.buildingType === 'string' ? raw.content.sda.buildingType : null,
    version: raw.version,
    commercialStatus: raw.commercialStatus,
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : null,
    firstPublishedAt: typeof raw.firstPublishedAt === 'string' ? raw.firstPublishedAt : null,
    listingEndDate: typeof raw.listingEndDate === 'string' ? raw.listingEndDate : null,
    // what visitors are shown (all of it already public in the website repository): the other half of the "changes since live" comparison
    public: {
      title: typeof raw.content.title === 'string' ? raw.content.title : '',
      description: Array.isArray(raw.content.description) ? raw.content.description.filter((x) => typeof x === 'string') : [],
      pricingMode: typeof raw.content.pricing?.mode === 'string' ? raw.content.pricing.mode : null,
      displayPrice: typeof raw.content.pricing?.display === 'string' ? raw.content.pricing.display : null,
      featured: raw.featured === true,
      photos: Array.isArray(raw.content.photos) ? raw.content.photos.filter((p) => p && typeof p.id === 'string').map((p) => ({ id: p.id, alt: typeof p.alt === 'string' ? p.alt : '', kind: p.kind === 'floorplan' ? 'floorplan' : 'photo' })) : [],
    },
  };
}

export async function loadSnapshots(cfg, { fetchImpl = fetch, now = Date.now, ttlMs = 60_000 } = {}) {
  const key = `${cfg.repo}@${cfg.ref}`;
  if (cache && cache.key === key && now() - cache.at < ttlMs) return cache.value;
  const approved = new Map();
  const withdrawn = new Set();
  const problems = [];
  const [a, w] = await Promise.all([listDir(cfg, 'src/data/listings/approved', fetchImpl), listDir(cfg, 'src/data/listings/withdrawn', fetchImpl)]);
  await Promise.all(a.map(async (f) => {
    const s = pickSnapshot(await readJson(cfg, f, fetchImpl));
    if (s) approved.set(s.listingId, s); else problems.push(`unreadable snapshot ${f.name}`);
  }));
  await Promise.all(w.map(async (f) => {
    const x = await readJson(cfg, f, fetchImpl);
    if (typeof x?.listingId === 'string') withdrawn.add(x.listingId); else problems.push(`unreadable withdrawal ${f.name}`);
  }));
  const value = { approved, withdrawn, problems };
  cache = { key, at: now(), value };
  return value;
}
export const clearSnapshotCache = () => { cache = null; };

/**
 * The ONE approved snapshot of a listing, in full (content, photographs and content hash), read from the website repository. Used only to adopt a
 * listing that is already published. Looks at <slug>.json first (the name the publication job always writes), then at every approved file.
 * Returns null when no approved file carries that listing id. Never trusted: the caller checks the hash and the schema.
 */
export async function loadApprovedSnapshot(cfg, listingId, { fetchImpl = fetch, slug = null } = {}) {
  const files = await listDir(cfg, 'src/data/listings/approved', fetchImpl);
  const ordered = [...files.filter((f) => slug && f.name === `${slug}.json`), ...files.filter((f) => !(slug && f.name === `${slug}.json`))];
  for (const f of ordered) {
    const raw = await readJson(cfg, f, fetchImpl);
    if (raw?.listingId === listingId) return raw;
  }
  return null;
}


export const listingUrl = (cfg, slug) => (SLUG_RE.test(slug) ? `${cfg.siteBase}/opportunities/${slug}/` : null);

/** live: 200. not_live: 404/410. unknown: anything else, or the request failed. */
export async function checkLive(cfg, slug, { fetchImpl = fetch } = {}) {
  const url = listingUrl(cfg, slug);
  const checkedAt = new Date().toISOString();
  if (!url) return { state: 'unknown', httpStatus: null, checkedAt };
  // one retry: a single network blip or 5xx must not turn a live page into "Unconfirmed"
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'sdahc-listings-manager' } });
      if (res.status >= 500 && attempt === 0) continue;
      const state = res.status === 200 ? 'live' : res.status === 404 || res.status === 410 ? 'not_live' : 'unknown';
      return { state, httpStatus: res.status, checkedAt };
    } catch { /* retry once */ }
  }
  return { state: 'unknown', httpStatus: null, checkedAt };
}

export const fingerprint = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);

let complianceCache = null;
/** compliance.json from the website repo (public). Returns { value, unavailable }. Default deny when unreadable. */
export async function loadCompliance(cfg, { fetchImpl = fetch, now = Date.now, ttlMs = 60_000 } = {}) {
  if (complianceCache && complianceCache.key === `${cfg.repo}@${cfg.ref}` && now() - complianceCache.at < ttlMs) return complianceCache.value;
  let value;
  try {
    const res = await fetchImpl(`https://raw.githubusercontent.com/${cfg.repo}/${encodeURIComponent(cfg.ref)}/src/data/listings/compliance.json`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'sdahc-listings-manager' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    value = { compliance: await res.json(), unavailable: false };
  } catch { value = { compliance: undefined, unavailable: true }; }
  complianceCache = { key: `${cfg.repo}@${cfg.ref}`, at: now(), value };
  return value;
}
export const clearComplianceCache = () => { complianceCache = null; };
