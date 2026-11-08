// What is ACTUALLY on the website. Two independent facts, both read from public sources, so neither depends on Notion:
//  1. the approved snapshot files committed to the website repo (what the next build will contain), and
//  2. a live request to the public listing page (what visitors can see right now).
import { createHash } from 'node:crypto';

const SLUG_RE = /^[a-z]+(-[a-z]+)*$/;
const COMMERCIAL = new Set(['available', 'under_offer', 'sold']);
let cache = null;

const gh = (cfg, extra = {}) => ({
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'sdahc-listings-manager', ...(cfg.githubReadToken ? { Authorization: `Bearer ${cfg.githubReadToken}` } : {}), ...extra },
  signal: AbortSignal.timeout(8000),
});

async function listDir(cfg, dir, fetchImpl) {
  const res = await fetchImpl(`https://api.github.com/repos/${cfg.repo}/contents/${dir}?ref=${encodeURIComponent(cfg.ref)}`, gh(cfg));
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub listing failed: HTTP ${res.status}`);
  return (await res.json()).filter((f) => f.type === 'file' && f.name.endsWith('.json'));
}

async function readJson(cfg, file, fetchImpl) {
  // download_url is raw.githubusercontent.com: no API rate limit
  const res = await fetchImpl(file.download_url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'sdahc-listings-manager' } });
  if (!res.ok) throw new Error(`GitHub file read failed: HTTP ${res.status}`);
  return res.json();
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
    version: raw.version,
    commercialStatus: raw.commercialStatus,
    approvedAt: typeof raw.approvedAt === 'string' ? raw.approvedAt : null,
    firstPublishedAt: typeof raw.firstPublishedAt === 'string' ? raw.firstPublishedAt : null,
    listingEndDate: typeof raw.listingEndDate === 'string' ? raw.listingEndDate : null,
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

export const listingUrl = (cfg, slug) => (SLUG_RE.test(slug) ? `${cfg.siteBase}/opportunities/${slug}/` : null);

/** live: 200. not_live: 404/410. unknown: anything else, or the request failed. */
export async function checkLive(cfg, slug, { fetchImpl = fetch } = {}) {
  const url = listingUrl(cfg, slug);
  const checkedAt = new Date().toISOString();
  if (!url) return { state: 'unknown', httpStatus: null, checkedAt };
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'sdahc-listings-manager' } });
    const state = res.status === 200 ? 'live' : res.status === 404 || res.status === 410 ? 'not_live' : 'unknown';
    return { state, httpStatus: res.status, checkedAt };
  } catch {
    return { state: 'unknown', httpStatus: null, checkedAt };
  }
}

export const fingerprint = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
