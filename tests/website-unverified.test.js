// When the website repository cannot be read, the Listings Manager must say so. It must never present a listing as "Not published", it must keep the last
// known state as unverified reference information, and it must pause real publishing until the website can be checked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync } from 'node:crypto';
import { SiteReadError, clearSnapshotCache, loadSnapshots, siteReadReason } from '../api/_lib/site.js';
import { buildListings, publicationFor } from '../api/_lib/listings-service.js';
import { clearInstallationTokens } from '../api/_lib/github-app.js';

const code = readFileSync(new URL('../listings.js', import.meta.url), 'utf8');
const svc = readFileSync(new URL('../api/_lib/publish-service.js', import.meta.url), 'utf8');
const cfg = (over = {}) => ({ notion: null, repo: 'o/web', ref: 'main', siteBase: 'https://site.test', githubReadToken: null, githubApp: null, ...over });
const res = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
const reset = () => { clearSnapshotCache(); clearInstallationTokens(); };

test('FAILURES ARE CLASSIFIED: rate limit, HTTP status, timeout, network (no secrets in the detail)', async () => {
  for (const [fetchImpl, kind] of [
    [async () => res(403, {}, { 'x-ratelimit-remaining': '0' }), 'rate_limited'],
    [async () => res(429, {}), 'rate_limited'],
    [async () => res(401, {}), 'http_401'],
    [async () => res(500, {}), 'http_500'],
    [async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); }, 'timeout'],
    [async () => { throw new TypeError('fetch failed'); }, 'network'],
  ]) {
    reset();
    const e = await loadSnapshots(cfg({ githubReadToken: 'ghp_secret_value' }), { fetchImpl }).then(() => null, (x) => x);
    assert.ok(e instanceof SiteReadError, kind); assert.equal(e.kind, kind);
    assert.ok(!/ghp_secret_value|Bearer/.test(e.detail), 'the detail never carries a credential');
    assert.equal(siteReadReason(e).kind, kind);
  }
});

test('TRANSIENT FAILURES RETRY ONCE: a single 502 or timeout does not turn the website into "unreadable"', async () => {
  reset(); let calls = 0;
  const snap = { listingId: 'lst_a', version: 1, commercialStatus: 'available', content: { slug: 'a-street-town-vic', title: 'A Street, Town VIC 3000', description: ['x'], address: { street: 'A Street', suburb: 'Town', state: 'VIC', postcode: '3000' }, pricing: { mode: 'contact_agent' }, photos: [] } };
  const fetchImpl = async (u) => {
    if (String(u).includes('/contents/src/data/listings/approved')) { calls += 1; return calls === 1 ? res(502, {}) : res(200, [{ type: 'file', name: 'a-street-town-vic.json', download_url: 'https://raw.test/a.json' }]); }
    if (String(u).includes('/contents/')) return res(404, {});
    return res(200, snap);
  };
  const s = await loadSnapshots(cfg(), { fetchImpl });
  assert.equal(s.approved.size, 1); assert.equal(calls, 2);
});

test('AUTHENTICATED READS USE THE EXISTING GITHUB APP: contents read only, no personal token; failing to mint falls back to anonymous', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const app = { appId: '123', installationId: '456', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }) };
  reset(); const seen = { mint: null, auth: [] };
  const fetchImpl = async (u, o) => {
    const url = String(u);
    if (url.includes('/access_tokens')) { seen.mint = JSON.parse(o.body); return res(201, { token: 'ghs_app_token', expires_at: new Date(Date.now() + 3600e3).toISOString(), permissions: { contents: 'read' }, repository_selection: 'selected', repositories: [{ full_name: 'o/web' }] }); }
    if (url.includes('api.github.com')) { seen.auth.push(o.headers.Authorization ?? null); return res(200, []); }
    return res(200, {});
  };
  await loadSnapshots(cfg({ githubApp: app }), { fetchImpl });
  assert.deepEqual(seen.mint.permissions, { contents: 'read' }); assert.deepEqual(seen.mint.repositories, ['web']);
  assert.ok(seen.auth.length >= 2 && seen.auth.every((a) => a === 'Bearer ghs_app_token'));
  reset(); const anon = [];
  await loadSnapshots(cfg({ githubApp: app }), { fetchImpl: async (u, o) => { if (String(u).includes('/access_tokens')) return res(403, {}); anon.push(o.headers.Authorization ?? null); return res(200, []); } });
  assert.ok(anon.length >= 2 && anon.every((a) => a === null), 'a token failure never breaks the read');
  assert.ok(!/LISTINGS_GITHUB_DISPATCH_TOKEN/.test(readFileSync(new URL('../api/_lib/site.js', import.meta.url), 'utf8')));
});

test('PUBLICATION STATE: an unreadable website is "unverified", never draft, review or "not published"; the last known state is kept as reference', () => {
  const draftRow = { content: { description: 'x', publicAddress: 'A Street, Town VIC 3000', pricingMode: 'contact_agent' }, photos: [{ id: 'a', kind: 'photo' }] };
  const st = (a) => publicationFor({ draftRow, snapshot: null, siteUnverified: true, ...a });
  assert.deepEqual([st({ lastSuccess: { kind: 'update' } }).state, st({ lastSuccess: { kind: 'update' } }).lastKnown], ['unverified', 'live']);
  assert.equal(st({ lastSuccess: { kind: 'publish' } }).lastKnown, 'live');
  assert.equal(st({ lastSuccess: { kind: 'withdraw' } }).lastKnown, 'withdrawn');
  assert.deepEqual([st({}).state, st({}).lastKnown], ['unverified', null], 'with no successful job nothing is claimed');
  assert.equal(st({ lastSuccess: { kind: 'update' } }).attention, true);
  assert.equal(st({ lastJob: { kind: 'update', status: 'running' } }).state, 'publishing', 'a running job is still shown as running');
  assert.equal(publicationFor({ draftRow, snapshot: null, siteUnverified: false }).state, 'review', 'a verified, unpublished draft is unchanged');
});

test('LIST: a failed website read gives the plain message, last-known rows, and technical detail for administrators only', async () => {
  reset();
  const fetchImpl = async () => res(403, {}, { 'x-ratelimit-remaining': '0' });
  const drafts = { state: 'ok', items: [{ id: 'lst_a', label: 'A Street, Town VIC 3000' }, { id: 'lst_b', label: 'B Street, Town VIC 3000' }] };
  const lastSuccess = new Map([['lst_a', { kind: 'update' }]]);
  const quiet = console.error; console.error = () => {};
  try {
    const user = await buildListings(cfg(), { fetchImpl, drafts, lastSuccess, admin: false });
    reset();
    const admin = await buildListings(cfg(), { fetchImpl, drafts, lastSuccess, admin: true });
    assert.equal(user.sources.website.state, 'error'); assert.equal(user.sources.website.message, 'Unable to verify website status');
    assert.equal(user.sources.website.reason, undefined); assert.equal(user.sources.website.detail, undefined);
    assert.equal(admin.sources.website.reason, 'rate_limited'); assert.match(admin.sources.website.detail, /HTTP 403/);
    const a = user.listings.find((l) => l.id === 'lst_a'); const b = user.listings.find((l) => l.id === 'lst_b');
    assert.equal(a.publication.state, 'unverified'); assert.equal(a.publication.lastKnown, 'live');
    assert.equal(b.publication.state, 'unverified'); assert.equal(b.publication.lastKnown, null);
    assert.ok(user.listings.every((l) => l.publication.state !== 'draft' && l.publication.state !== 'review'));
  } finally { console.error = quiet; }
});

test('PUBLISHING PAUSES: a real publication or status change is refused (503, nothing recorded) while the website cannot be verified; a test run is not', () => {
  assert.match(svc, /siteNow === null && REAL_KINDS\.includes\(kind\)\) throw new HttpError\(503, 'website_unreadable'/);
  assert.ok(svc.indexOf("siteNow === null && REAL_KINDS") < svc.indexOf('createJob('), 'refused before any job is recorded');
  assert.match(svc, /websiteVerified: site !== null/);
});

test('SCREEN: label, banner with Try again, paused buttons, filters, and no "Not published" for an unverified listing', () => {
  assert.match(code, /unverified: 'Unable to verify website status'/);
  assert.match(code, /id: 'ls-unverified-retry'/);
  for (const id of ["id: 'ls-publish-btn', disabled: lsUnverified()", "id: 'ls-status-go', disabled: !!active || LS.jobBusy || lsUnverified()", "disabled: busy || lsUnverified(), onclick: () => { LS.withdrawOpen"]) assert.ok(code.includes(id), id);
  assert.match(code, /if \(jobs && jobs\.websiteVerified === false\) return 'unverified'/);
  assert.match(code, /st === 'unverified' \? 'Not verified'/);
  assert.match(code, /'Last known: '/);
  assert.match(code, /if \(key === 'draft'\) return !l\.website && st !== 'withdrawn' && st !== 'unverified'/);
  assert.match(code, /d\.sources\.website\.detail \? ' Technical detail: '/);
});
