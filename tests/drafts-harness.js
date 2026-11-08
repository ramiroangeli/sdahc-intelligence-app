// Test harness for the draft workflow: real SQL (PGlite running the actual migration), the REAL authorisation path,
// and a fake Notion + GitHub + website that records every outbound call so tests can prove nothing is written.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { clearPropertyCache } from '../api/_lib/property.js';
import { clearComplianceCache, clearSnapshotCache } from '../api/_lib/site.js';
import { publicIdFor } from '../api/_lib/notion.js';
import { azureUser, authConfig, supabaseFetch, req as baseReq, res as makeRes, TENANT } from './helpers.js';

export const PAGE_7B = '402909c1-bb60-8100-8000-0000000007b0';
export const PAGE_7A = '402909c1-bb60-8100-8000-0000000007a0';
export const PAGE_RG = '2e2909c1-bb60-8100-aaaa-000000000001'; // Rutherford Grove (published)
export const ID_7B = publicIdFor(PAGE_7B);
export const ID_7A = publicIdFor(PAGE_7A);
export const ID_RG = publicIdFor(PAGE_RG);

export const SECRETS = ['123456', '98765', '98,765', '123,456', '1234567', '6.789'];

const rt = (s) => ({ type: 'rich_text', rich_text: s ? [{ plain_text: s }] : [] });
const sel = (n) => ({ type: 'select', select: n ? { name: n } : null });
export function page7B(over = {}) {
  return {
    id: PAGE_7B, object: 'page', archived: false, last_edited_time: '2026-10-23T01:36:00.000Z',
    properties: {
      Name: { type: 'title', title: [{ plain_text: '7B Wattle Street, Exampleton VIC 3999' }] },
      Address: rt('7B Wattle Street, Exampleton VIC 3999'),
      'State/ Territory': sel('VIC'), 'Design Category': { type: 'multi_select', multi_select: [{ name: 'IL' }] }, 'Build Type': sel('House'),
      Features: { type: 'multi_select', multi_select: [{ name: 'OOA' }, { name: 'No Fire Sprinklers' }] },
      Description: rt('Operating SDA property. 3 participant places; 2 occupied (2/3 physical occupancy). Net 98,765'),
      'Gross income': { type: 'number', number: 123456 }, Price: { type: 'number', number: null }, Yield: { type: 'number', number: null },
      'Web Listing Status': sel(''), 'Web Title': rt(''), 'Web Description': rt(''), 'Web Public Address': rt(''), 'Web Pricing Mode': sel(''),
      'Web Display Price': { type: 'number', number: null }, 'Web Featured': { type: 'checkbox', checkbox: false },
      ...over,
    },
  };
}
const listRow = (id, name, state, status = '') => ({ id, archived: false, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, 'State/ Territory': sel(state), 'Design Category': { type: 'multi_select', multi_select: [{ name: 'IL' }] }, 'Build Type': sel('House'), 'Web Listing Status': sel(status) } });

const RG_SNAPSHOT = { listingId: ID_RG, version: 1, commercialStatus: 'available', approvedAt: '2026-11-05T12:29:09Z', firstPublishedAt: '2026-11-05T12:29:09Z', content: { slug: 'rutherford-grove-armstrong-creek-vic', title: 'Established Improved Liveability SDA Investment' } };
export const COMPLIANCE = { victoria: { reviewedBy: null, reviewedAt: null, adviceReference: null, cleared: { asking_price: false, price_guide: false, eoi: false, contact_agent: false }, determinations: [{ listingId: ID_RG, pricingMode: 'contact_agent', basis: 'internal_determination', recordedBy: 'x', recordedAt: '2026-11-05', reference: 'r', statement: 's' }] }, basicClassification: { confirmedListingIds: [] } };

/** Fake world. `state.pages` can be mutated by tests to simulate a Notion edit. `calls` records everything. */
export function world() {
  const calls = [];
  const mem = new Map();
  const blob = { put: async (p, b) => { mem.set(p, b); }, get: async (p) => mem.get(p) ?? null, del: async (ps) => { for (const p of ps) mem.delete(p); }, mem };
  const state = { page7B: page7B(), snapshots: [RG_SNAPSHOT], withdrawn: [], liveStatus: 200, notionDown: false };
  const fetch = async (url, opts = {}) => {
    const u = String(url); const method = opts.method ?? 'GET';
    calls.push({ url: u, method });
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('/auth/v1/user')) return supabaseFetch(state.user ?? azureUser())(u);
    if (u.includes('api.notion.com')) {
      if (state.notionDown) return { ok: false, status: 500, json: async () => ({ code: 'internal_server_error' }) };
      if (u.includes('/query')) return ok({ results: [listRow(PAGE_7A, '7A Wattle Street, Exampleton VIC 3999', 'VIC'), { ...listRow(PAGE_7B, state.page7B.properties.Name.title[0].plain_text, 'VIC') }, listRow(PAGE_RG, '5/50 Rutherford Grove, Armstrong Creek VIC 3217', 'VIC', 'Published')], has_more: false });
      if (u.includes(`/v1/pages/${PAGE_7B}`)) return ok(state.page7B);
      if (u.includes(`/v1/pages/${PAGE_RG}`)) return ok({ ...page7B(), id: PAGE_RG });
      return { ok: false, status: 404, json: async () => ({ code: 'object_not_found' }) };
    }
    if (u.includes('api.github.com') && u.includes('/approved')) return ok(state.snapshots.map((s, i) => ({ type: 'file', name: `s${i}.json`, download_url: `https://raw.githubusercontent.com/x/approved/s${i}.json` })));
    if (u.includes('api.github.com') && u.includes('/withdrawn')) return ok(state.withdrawn.map((w, i) => ({ type: 'file', name: `w${i}.json`, download_url: `https://raw.githubusercontent.com/x/withdrawn/w${i}.json` })));
    if (u.includes('/approved/s')) return ok(state.snapshots[Number(/s(\d+)\.json/.exec(u)[1])]);
    if (u.includes('/withdrawn/w')) return ok(state.withdrawn[Number(/w(\d+)\.json/.exec(u)[1])]);
    if (u.includes('compliance.json')) return ok(COMPLIANCE);
    if (u.includes('/opportunities/')) return { ok: true, status: state.liveStatus };
    throw new Error('unexpected fetch ' + u);
  };
  return { fetch, calls, state, blob };
}

export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`);
  await db.exec(readFileSync('supabase/migrations/listings_0001_drafts.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/listings_0002_photos.sql', 'utf8'));
  const adapter = {
    raw: db,
    unsafe: async (q, p) => (await db.query(q, p)).rows,
    begin: (fn) => db.transaction((tx) => fn({ unsafe: async (q, p) => (await tx.query(q, p)).rows })),
  };
  return adapter;
}

export const staff = (email, caps) => ({ email, capabilities: caps, active: true, authUserId: null });
export const EDITOR = staff('ali@sdahomechoices.com.au', ['listings.view', 'listings.edit']);
export const PUBLISHER = staff('steve@sdahomechoices.com.au', ['listings.view', 'listings.publish']);
export const ALI = staff('ali@sdahomechoices.com.au', ['listings.view', 'listings.edit', 'listings.publish']);
export const VIEWER = staff('viewer@sdahomechoices.com.au', ['listings.view']);

export const userFor = (s) => azureUser({ email: s.email, id: '22222222-2222-4222-8222-' + String(s.email.length).padStart(12, '0'), identities: [{ provider: 'azure', identity_data: { email: s.email, iss: `https://login.microsoftonline.com/${TENANT}/v2.0` } }] });

/** Call a route as a person. Returns { status, json }. */
export async function call(route, w, db, person, { method = 'GET', url = '/', body, headers } = {}) {
  w.state.user = userFor(person);
  clearSnapshotCache(); clearComplianceCache();
  const r = makeRes();
  const base = baseReq({ method });
  const rq = { ...base, headers: { ...base.headers, ...(headers ?? {}) }, url, body };
  await route({ authConfig: authConfig([person]), fetch: w.fetch, db, blob: w.blob, dataConfig: { notion: { token: 'tok', dataSourceId: 'ds', version: 'v' }, repo: 'o/r', ref: 'main', siteBase: 'https://sdahomechoices.com.au', githubReadToken: null } })(rq, r);
  const bin = Buffer.isBuffer(r.body);
  return { status: r.statusCode, json: r.body && !bin ? JSON.parse(r.body) : null, raw: r.body, headers: r.headers };
}
export const resetCaches = () => { clearPropertyCache(); clearSnapshotCache(); clearComplianceCache(); };
