// Adopting a listing that is already published (Rutherford Grove): the draft is seeded from the approved website snapshot, the existing public
// WebP files are copied byte for byte into PRIVATE staging, and nothing else in the world changes. Real SQL (PGlite), the real authorisation
// path, fake Notion / GitHub / public store that record every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import * as core from '../api/_lib/vendor/listings-core.mjs';
import { draftRoute } from '../api/_lib/routes.js';
import { setAuditSink } from '../api/_lib/audit.js';
import { ALI, EDITOR, ID_7B, ID_RG, PAGE_RG, PUBLISHER, VIEWER, call, database, resetCaches, world } from './drafts-harness.js';

const HOST = 'https://t0t0t0t0.public.blob.vercel-storage.com';
const SPEC = [
  { id: 'a1a1a1a1a1a1', width: 800, height: 409, widths: [480, 800], alt: 'Front of a single-storey brick and render home', accent: 'teal' },
  { id: 'b2b2b2b2b2b2', width: 492, height: 656, widths: [480, 492], alt: 'Open kitchen with a long island bench', accent: 'blue' },
  { id: 'f3f3f3f3f3f3', width: 1600, height: 1131, widths: [480, 960, 1600], alt: 'Floorplan of the single-storey home', accent: 'slate', kind: 'floorplan' },
];
const urlOf = (id, w, listing = ID_RG) => `${HOST}/${listing}/${id}-${w}.webp`;
const webp = (w, h = Math.round(w * 0.6)) => sharp({ create: { width: w, height: h, channels: 3, background: { r: w % 255, g: 90, b: 140 } } }).webp({ quality: 70 }).toBuffer();

function snapshot(over = {}) {
  const content = {
    slug: 'rutherford-grove-armstrong-creek-vic', type: 'property', title: 'Established Improved Liveability SDA Investment',
    description: ['An established improved liveability SDA house in Armstrong Creek with three participant places and onsite overnight assistance.'],
    address: { street: 'Rutherford Grove', suburb: 'Armstrong Creek', state: 'VIC', postcode: '3217' },
    pricing: { mode: 'contact_agent' }, sda: { designCategories: ['IL'], buildingType: 'House' },
    photos: SPEC.map((p) => ({ id: p.id, alt: p.alt, width: p.width, height: p.height, accent: p.accent, ...(p.kind ? { kind: p.kind } : {}), variants: p.widths.map((w) => ({ w, src: urlOf(p.id, w) })), privacyReviewed: true })),
    ...over,
  };
  return { listingId: ID_RG, version: 1, approvedBy: 'Ramiro', approvedById: 'u', approvedAt: '2026-11-05T12:29:09.094Z', firstPublishedAt: '2026-11-05T12:29:09.094Z', commercialStatus: 'available', featured: false, sourceEditedAt: '2026-11-05T11:00:00.000Z', contentHash: core.contentHash(content), content };
}

/** A world where Rutherford Grove is published, its public images are served, and every write is recorded. */
async function setup({ snap = snapshot(), images = {} } = {}) {
  resetCaches();
  const w = world(); const db = await database();
  w.state.snapshots = [snap];
  const fetched = []; const bytesBySrc = new Map();
  for (const p of SPEC) for (const wd of p.widths) bytesBySrc.set(urlOf(p.id, wd), await webp(wd, wd === p.width ? p.height : Math.round(wd * p.height / p.width)));
  const writes = []; const puts = [];
  const put = w.blob.put; w.blob.put = async (p, b) => { if (w.blob.failPut) throw new Error('store down'); puts.push(p); return put(p, b); };
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    if (/\.public\.blob\.vercel-storage\.com\//.test(u) || /evil\.example/.test(u)) {
      fetched.push(u);
      if (images[u] === 404) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      const b = images[u] ?? bytesBySrc.get(u);
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
    }
    if ((opts.method ?? 'GET') !== 'GET' && !(u.includes('api.notion.com') && u.includes('/query'))) writes.push(`${opts.method} ${u}`);
    return w.fetch(url, opts);
  };
  return { w, db, fetch, fetched, bytesBySrc, writes, puts };
}
const importAs = (ctx, who = ALI, over = {}) => call(draftRoute, ctx.w, over.db ?? ctx.db, who, { method: 'POST', fetch: ctx.fetch, body: { propertyId: ID_RG, importPublished: true, ...(over.body ?? {}) } });
const drafts = (db) => db.unsafe('select public_id, version, photos, content from listings.drafts');
const events = () => { const e = []; setAuditSink((l) => e.push(JSON.parse(l))); return e; };

test('IMPORT: seeds a draft from the published snapshot, with the same id, address, content and photographs, and writes only the draft and private staging', async () => {
  const ev = events(); const ctx = await setup(); const snap = ctx.w.state.snapshots[0];
  const r = await importAs(ctx);
  assert.equal(r.status, 200, r.raw);
  assert.equal(r.json.draft.id, ID_RG); assert.equal(r.json.draft.version, 1);
  assert.deepEqual(r.json.imported, { fromVersion: 1, slug: 'rutherford-grove-armstrong-creek-vic', photos: 3, files: 7, draftVersion: 1 });
  assert.equal(r.json.draft.content.title, snap.content.title);
  assert.equal(r.json.draft.content.publicAddress, 'Rutherford Grove, Armstrong Creek VIC 3217');
  assert.equal(r.json.draft.content.description, snap.content.description.join('\n\n'));
  assert.equal(r.json.draft.content.pricingMode, 'contact_agent');
  assert.equal(r.json.validation.complete, true); assert.equal(r.json.validation.slug, snap.content.slug, 'the draft previews the published slug, not a suffixed one');
  const [row] = await drafts(ctx.db);
  assert.deepEqual(row.photos.map((p) => [p.id, p.alt, p.width, p.height, p.accent, p.kind ?? null, p.files.map((f) => f.file)]),
    SPEC.map((p) => [p.id, p.alt, p.width, p.height, p.accent, p.kind ?? null, p.widths.map((x) => `${p.id}-${x}.webp`)]), 'ids, alt text, order, floorplan flag and file names are the published ones');
  const hist = await ctx.db.unsafe("select action, changed_fields from listings.draft_history where draft_id = (select id from listings.drafts)");
  assert.equal(hist.length, 1); assert.equal(hist[0].action, 'create'); assert.ok(hist[0].changed_fields.includes('importedFromPublished') && hist[0].changed_fields.includes('photos'));
  assert.deepEqual(ev.filter((e) => e.action === 'listings.draft.import').map((e) => [e.outcome, e.detail.id, e.detail.photos, e.detail.files]), [['ok', ID_RG, 3, 7]]);
});

test('IMPORT: every public WebP is copied into private staging byte for byte (not re-encoded), and nothing is written to Notion, GitHub or the public store', async () => {
  const ctx = await setup(); await importAs(ctx);
  assert.equal(ctx.w.blob.mem.size, 7);
  for (const p of SPEC) for (const wd of p.widths) {
    const staged = ctx.w.blob.mem.get(`listings-staging/${ID_RG}/${p.id}-${wd}.webp`);
    assert.ok(staged && Buffer.compare(staged, ctx.bytesBySrc.get(urlOf(p.id, wd))) === 0, `${p.id}-${wd} is identical`);
  }
  assert.equal(ctx.w.publicBlob.mem.size, 0, 'the public store is never written');
  assert.deepEqual(ctx.writes, [], 'no write request to Notion, GitHub or the website');
  assert.ok(ctx.fetched.every((u) => u.startsWith(`${HOST}/${ID_RG}/`)), 'only this listing\'s public image files were fetched');
  assert.equal(ctx.fetched.length, 7);
});

test('IMPORT: a normal "create draft" for a published listing is still refused, and a property that is not published cannot be imported', async () => {
  const ctx = await setup();
  const normal = await call(draftRoute, ctx.w, ctx.db, ALI, { method: 'POST', fetch: ctx.fetch, body: { propertyId: ID_RG } });
  assert.equal(normal.status, 409); assert.equal(normal.json.error, 'already_published');
  const notPub = await importAs(ctx, ALI, { body: { propertyId: ID_7B } });
  assert.equal(notPub.status, 409); assert.equal(notPub.json.error, 'not_published');
  assert.equal((await drafts(ctx.db)).length, 0); assert.equal(ctx.w.blob.mem.size, 0);
});

test('IMPORT: idempotent. A second import returns the existing draft untouched and fetches or writes nothing', async () => {
  const ctx = await setup(); const ev = events();
  await importAs(ctx);
  const fetchedBefore = ctx.fetched.length; const putsBefore = ctx.puts.length;
  const again = await importAs(ctx);
  assert.equal(again.status, 200); assert.equal(again.json.alreadyImported, true); assert.equal(again.json.draft.version, 1);
  assert.equal(ctx.fetched.length, fetchedBefore); assert.equal(ctx.puts.length, putsBefore);
  assert.equal((await drafts(ctx.db)).length, 1);
  assert.equal((await ctx.db.unsafe('select 1 from listings.draft_history')).length, 1);
  assert.ok(ev.some((e) => e.action === 'listings.draft.import.existing' && e.outcome === 'ok'));
});

test('IMPORT: two simultaneous imports leave exactly one draft and one set of staged files', async () => {
  const ctx = await setup();
  const [a, b] = await Promise.all([importAs(ctx), importAs(ctx)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await drafts(ctx.db)).length, 1); assert.equal(ctx.w.blob.mem.size, 7);
  assert.equal([a, b].filter((x) => x.json.imported).length + [a, b].filter((x) => x.json.alreadyImported).length, 2);
});

test('IMPORT PERMISSIONS: only someone who can edit AND publish may import; everyone else is refused before anything is read, fetched or written', async () => {
  for (const who of [VIEWER, EDITOR, PUBLISHER]) {
    const ctx = await setup(); const ev = events();
    const r = await importAs(ctx, who);
    assert.equal(r.status, 403, who.email + ' ' + who.capabilities.join());
    assert.equal(ctx.fetched.length, 0); assert.equal(ctx.w.blob.mem.size, 0); assert.equal((await drafts(ctx.db)).length, 0);
    if (who === EDITOR) assert.ok(ev.some((e) => e.action === 'listings.draft.import' && e.outcome === 'failed' && e.detail.code === 'forbidden'), 'a refused attempt is audited');
  }
  const ctx = await setup();
  const anon = await call(draftRoute, ctx.w, ctx.db, ALI, { method: 'POST', headers: { authorization: '' }, fetch: ctx.fetch, body: { propertyId: ID_RG, importPublished: true } });
  assert.equal(anon.status, 401); assert.equal(ctx.fetched.length, 0);
});

test('IMPORT REFUSES an untrustworthy snapshot (hash mismatch, schema failure) before any image is downloaded', async () => {
  const tampered = snapshot(); tampered.content.title = 'A different title after approval';
  const a = await setup({ snap: tampered }); const ra = await importAs(a);
  assert.equal(ra.status, 409); assert.equal(ra.json.error, 'snapshot_invalid'); assert.match(ra.json.reasons[0], /hash/);
  const broken = snapshot(); broken.content.pricing = { mode: 'asking_price' }; broken.contentHash = core.contentHash(broken.content);
  const b = await setup({ snap: broken }); const rb = await importAs(b);
  assert.equal(rb.status, 409); assert.ok(['snapshot_invalid', 'import_mismatch'].includes(rb.json.error));
  assert.equal(a.fetched.length, 0, 'a tampered snapshot is refused before any image is downloaded');
  for (const c of [a, b]) { assert.equal(c.w.blob.mem.size, 0); assert.equal((await drafts(c.db)).length, 0); }
});

test('IMPORT REFUSES images that are not exactly this listing\'s public files: foreign host, another listing\'s path, wrong width, not a WebP, missing', async () => {
  const foreign = snapshot(); foreign.content.photos[0].variants[0].src = 'https://evil.example/' + ID_RG + '/a1a1a1a1a1a1-480.webp'; foreign.contentHash = core.contentHash(foreign.content);
  const other = snapshot(); other.content.photos[1].variants[0].src = urlOf('b2b2b2b2b2b2', 480, 'lst_0000000000'); other.contentHash = core.contentHash(other.content);
  const cases = [
    ['foreign host', { snap: foreign }, 409, 'import_unsupported'],
    ["another listing's path", { snap: other }, 409, 'import_unsupported'],
    ['wrong width', { images: { [urlOf('a1a1a1a1a1a1', 800)]: await webp(300) } }, 409, 'import_unsupported'],
    ['not a WebP', { images: { [urlOf('b2b2b2b2b2b2', 480)]: await sharp({ create: { width: 480, height: 288, channels: 3, background: '#123456' } }).png().toBuffer() } }, 409, 'import_unsupported'],
    ['missing (404)', { images: { [urlOf('f3f3f3f3f3f3', 960)]: 404 } }, 502, 'import_failed'],
  ];
  for (const [name, opts, status, code] of cases) {
    const ctx = await setup(opts); const r = await importAs(ctx);
    assert.equal(r.status, status, name); assert.equal(r.json.error, code, name);
    assert.ok(!ctx.fetched.some((u) => /evil\.example|lst_0000000000/.test(u)), `${name}: the foreign URL is never requested`);
    assert.equal(ctx.w.blob.mem.size, 0, `${name}: nothing staged`); assert.equal((await drafts(ctx.db)).length, 0, `${name}: no draft`);
  }
});

test('IMPORT REFUSES a withdrawn listing, and failures after the checks leave nothing behind (store refusal, database failure)', async () => {
  const wd = await setup(); wd.w.state.withdrawn = [{ listingId: ID_RG }];
  const r1 = await importAs(wd); assert.equal(r1.status, 409); assert.equal(r1.json.error, 'withdrawn'); assert.equal(wd.fetched.length, 0);

  const store = await setup(); store.w.blob.failPut = true;
  const r2 = await importAs(store); assert.equal(r2.status, 502); assert.equal(r2.json.error, 'import_failed');
  assert.equal(store.w.blob.mem.size, 0); assert.equal((await drafts(store.db)).length, 0);

  const dbf = await setup(); const broken = { ...dbf.db, begin: async () => { throw new Error('database down'); } };
  const ev = events();
  const r3 = await call(draftRoute, dbf.w, broken, ALI, { method: 'POST', fetch: dbf.fetch, body: { propertyId: ID_RG, importPublished: true } });
  assert.ok(r3.status >= 500, String(r3.status));
  assert.equal(dbf.w.blob.mem.size, 0, 'files staged by the failed attempt are removed');
  assert.equal((await drafts(dbf.db)).length, 0);
  assert.ok(ev.some((e) => e.action === 'listings.draft.import' && e.outcome === 'failed'), 'the failure is audited');
});

test('IMPORT: an unreadable website or Notion stops it with nothing written', async () => {
  const web = await setup(); const bad = async (u, o) => (String(u).includes('api.github.com') ? { ok: false, status: 500, json: async () => ({}) } : web.fetch(u, o));
  const r = await call(draftRoute, web.w, web.db, ALI, { method: 'POST', fetch: bad, body: { propertyId: ID_RG, importPublished: true } });
  assert.ok(r.status >= 400); assert.equal((await drafts(web.db)).length, 0); assert.equal(web.w.blob.mem.size, 0);
  const notion = await setup(); notion.w.state.notionDown = true;
  const r2 = await importAs(notion); assert.ok(r2.status >= 400); assert.equal((await drafts(notion.db)).length, 0); assert.equal(notion.w.blob.mem.size, 0);
});

test('IMPORT: no additional Vercel function (the Hobby plan allows 12), and the browser files carry no storage address or credential', async () => {
  const handlers = readdirSync('api', { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '_lib').flatMap((d) => readdirSync(`api/${d.name}`).filter((f) => f.endsWith('.js')));
  assert.equal(handlers.length, 12, handlers.join());
  const ui = readFileSync('listings.js', 'utf8');
  assert.match(ui, /Import published listing/); assert.match(ui, /importPublished: true/);
  for (const re of [/blob\.vercel-storage/, /listings-staging/, /LISTINGS_GITHUB/, /ghp_|github_pat_/]) assert.ok(!re.test(ui), String(re));
  assert.ok(PAGE_RG);
});
