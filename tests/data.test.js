import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchManagedProperties, LISTED_PROPERTIES, mapPage, maskStreetNumber, publicIdFor } from '../api/_lib/notion.js';
import { buildListings, combine } from '../api/_lib/listings-service.js';
import { clearSnapshotCache, pickSnapshot } from '../api/_lib/site.js';
import { loadDataConfig } from '../api/_lib/config.js';

const PAGE_ID = '2e2909c1-bb60-8100-aaaa-000000000001';
const rt = (s) => ({ type: 'rich_text', rich_text: [{ plain_text: s }] });
const page = (webStatus = 'Published') => ({
  id: PAGE_ID, last_edited_time: '2026-11-05T12:25:00.000Z',
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'Rutherford Grove' }] },
    'State/ Territory': { type: 'select', select: { name: 'VIC' } },
    'Design Category': { type: 'multi_select', multi_select: [{ name: 'IL' }] },
    'Build Type': { type: 'select', select: { name: 'House' } },
    'Web Listing Status': { type: 'select', select: { name: webStatus } },
    'Web Title': rt(''), 'Web Pricing Mode': { type: 'select', select: { name: 'Contact Agent' } }, 'Web Featured': { type: 'checkbox', checkbox: false },
    // private CRM data that must never come out:
    Address: rt('12/34 Secret Street, Somewhere VIC 3000'), Price: { type: 'number', number: 1234567 }, Yield: { type: 'number', number: 6.789 },
    Description: rt('CRM-ONLY-NOTES'), 'Sharepoint Link': { type: 'url', url: 'https://x.sharepoint.com/secret' }, 'Listing Agent': rt('PRIVATE-AGENT'),
  },
});
const SNAP = { listingId: publicIdFor(PAGE_ID), slug: 'rutherford-grove-armstrong-creek-vic', title: 'Established SDA', version: 1, commercialStatus: 'available', approvedAt: '2026-11-05T12:29:09Z', firstPublishedAt: '2026-11-05T12:29:09Z', url: 'x' };

test('public id matches the website adapter derivation', () => {
  assert.equal(publicIdFor(PAGE_ID), `lst_${createHash('sha256').update(PAGE_ID).digest('hex').slice(0, 10)}`);
});
test('house and unit numbers are removed from the CRM name', () => {
  assert.equal(maskStreetNumber('3/19 Rutherford Grove, Armstrong Creek VIC 3217'), 'Rutherford Grove, Armstrong Creek VIC 3217');
  assert.equal(maskStreetNumber('Unit 2/45-47 Smith St, Town QLD 4000'), 'Smith St, Town QLD 4000');
  assert.equal(maskStreetNumber('12A Example Road'), 'Example Road');
  assert.equal(maskStreetNumber('Rutherford Grove'), 'Rutherford Grove');
  const p = page(); p.properties.Name = { type: 'title', title: [{ plain_text: '3/19 Rutherford Grove, Armstrong Creek VIC 3217' }] };
  assert.ok(!/\d+\/\d+|\b19\b/.test(mapPage(p).name));
});
test('mapPage returns only the allowlisted fields and no CRM data', () => {
  const out = JSON.stringify(mapPage(page()));
  for (const secret of ['Secret Street', '1234567', '6.789', 'CRM-ONLY-NOTES', 'sharepoint', 'PRIVATE-AGENT', PAGE_ID]) assert.ok(!out.includes(secret), `leaked ${secret}`);
  assert.equal(mapPage(page()).name, 'Rutherford Grove');
});
test('the Notion request names only the allowlisted properties and sends no write method', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url: String(url), method: opts.method, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ results: [page()], has_more: false }) }; };
  await fetchManagedProperties({ token: 'secret-token', dataSourceId: 'ds', version: '2026-11-11' }, { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/query\?/);
  const asked = [...new URL(calls[0].url).searchParams.getAll('filter_properties')];
  assert.deepEqual(asked.sort(), [...LISTED_PROPERTIES].sort());
  for (const banned of ['Address', 'Price', 'Yield', 'Description', 'Sharepoint Link', 'Listing Agent', 'Features', 'Deals']) assert.ok(!asked.includes(banned));
});
test('Notion errors never carry the token or the response body', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ code: 'restricted_resource', message: 'secret-token leaked?' }) });
  await assert.rejects(fetchManagedProperties({ token: 'secret-token', dataSourceId: 'ds', version: 'v' }, { fetchImpl }), (e) => { assert.ok(!e.message.includes('secret-token') && !e.message.includes('leaked')); return true; });
});
test('combine keeps Notion intent and live deployment apart', () => {
  const notion = mapPage(page('Published'));
  const live = combine({ notion, snapshot: pickSnapshot({ ...SNAP, content: { slug: SNAP.slug, title: 'T' } , commercialStatus: 'available', version: 1 }), withdrawn: false, live: { state: 'live', httpStatus: 200, checkedAt: 'x' }, url: 'u' });
  assert.equal(live.deployment.state, 'live'); assert.equal(live.inSync, true);
  const missing = combine({ notion, snapshot: null, withdrawn: false, live: null, url: null });
  assert.equal(missing.deployment.state, 'not_published');
  assert.match(missing.notes[0], /Notion says this is live/);
  const down = combine({ notion, snapshot: pickSnapshot({ listingId: SNAP.listingId, version: 1, commercialStatus: 'available', content: { slug: SNAP.slug } }), withdrawn: false, live: { state: 'not_live', httpStatus: 404, checkedAt: 'x' }, url: 'u' });
  assert.equal(down.deployment.state, 'not_live');
  const wd = combine({ notion, snapshot: pickSnapshot({ listingId: SNAP.listingId, version: 1, commercialStatus: 'available', content: { slug: SNAP.slug } }), withdrawn: true, live: null, url: 'u' });
  assert.equal(wd.deployment.state, 'withdrawn');
});
test('pickSnapshot rejects malformed files and unsafe slugs', () => {
  assert.equal(pickSnapshot({ listingId: 'x', version: 1, commercialStatus: 'available', content: { slug: '../admin' } }), null);
  assert.equal(pickSnapshot({ listingId: 'x', version: 'one', commercialStatus: 'available', content: { slug: 'ok-slug' } }), null);
  assert.equal(pickSnapshot(null), null);
});
test('buildListings end to end with fake upstreams (Notion + GitHub + live site)', async () => {
  clearSnapshotCache();
  const snapshotFile = { listingId: publicIdFor(PAGE_ID), version: 1, commercialStatus: 'available', approvedAt: '2026-11-05T12:29:09Z', content: { slug: SNAP.slug, title: 'Established SDA', address: { street: 'Rutherford Grove' } } };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('api.notion.com')) return { ok: true, status: 200, json: async () => ({ results: [page()], has_more: false }) };
    if (u.includes('api.github.com') && u.includes('/approved')) return { ok: true, status: 200, json: async () => [{ type: 'file', name: 'a.json', download_url: 'https://raw.githubusercontent.com/x/a.json' }] };
    if (u.includes('api.github.com')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('raw.githubusercontent.com')) return { ok: true, status: 200, json: async () => snapshotFile };
    if (u.includes('/opportunities/')) return { ok: true, status: 200 };
    throw new Error('unexpected ' + u);
  };
  const cfg = loadDataConfig({ NOTION_LISTINGS_TOKEN: 't', NOTION_PROPERTIES_DATA_SOURCE_ID: 'ds' });
  const out = await buildListings(cfg, { fetchImpl });
  assert.equal(out.listings.length, 1);
  const l = out.listings[0];
  assert.equal(l.name, 'Rutherford Grove');
  assert.equal(l.deployment.state, 'live');
  assert.equal(l.website.url, 'https://sdahomechoices.com.au/opportunities/rutherford-grove-armstrong-creek-vic/');
  const text = JSON.stringify(out);
  for (const secret of ['Secret Street', '1234567', 'CRM-ONLY-NOTES', 'sharepoint.com', PAGE_ID, 'address']) assert.ok(!text.includes(secret), `leaked ${secret}`);
});
test('without a Notion token the screen degrades visibly instead of failing', async () => {
  clearSnapshotCache();
  const fetchImpl = async (url) => { const u = String(url); if (u.includes('api.github.com')) return { ok: true, status: 200, json: async () => [] }; throw new Error('no'); };
  const out = await buildListings(loadDataConfig({}), { fetchImpl });
  assert.equal(out.sources.notion.state, 'not_configured');
  assert.deepEqual(out.listings, []);
});
