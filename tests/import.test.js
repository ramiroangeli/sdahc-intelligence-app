// Adopting a listing that is already published (Rutherford Grove): the draft is seeded from the approved website snapshot, the existing public
// WebP files are copied byte for byte into PRIVATE staging, and nothing else in the world changes. Real SQL (PGlite), the real authorisation
// path, fake Notion / GitHub / public store that record every call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import * as core from '../api/_lib/vendor/listings-core.mjs';
import { draftPublishRoute, draftRoute, publishCallbackRoute } from '../api/_lib/routes.js';
import { setAuditSink } from '../api/_lib/audit.js';
import { ALI, ALI_N, EDITOR, ID_7B, ID_RG, PAGE_RG, PUBLISHER, PUBLISH_ENV, SECRET, VIEWER, call, callSigned, database, github, resetCaches, world } from './drafts-harness.js';

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
  assert.match(ui, /brought in/); assert.match(ui, /importPublished: true/);
  for (const re of [/blob\.vercel-storage/, /listings-staging/, /LISTINGS_GITHUB/, /ghp_|github_pat_/]) assert.ok(!re.test(ui), String(re));
  assert.ok(PAGE_RG);
});

// ---- Publishing an imported listing: it is already public, so it goes out as an UPDATE (it has no successful portal job to say so) ----
async function imported() {
  const ctx = await setup();
  const r = await call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'POST', fetch: ctx.fetch, body: { propertyId: ID_RG, importPublished: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  ctx.gh = github(ctx.w);
  ctx.id = ID_RG;
  return ctx;
}
const publishAs = async (ctx, mode, who = ALI_N) => call(draftPublishRoute, ctx.w, ctx.db, who, { method: 'POST', fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_RG, expectedVersion: (await ctx.db.unsafe('select version from listings.drafts where public_id = $1', [ID_RG]))[0].version, mode } });
const history = async (ctx) => (await call(draftPublishRoute, ctx.w, ctx.db, ALI_N, { url: `/api/listings/draft-publish?id=${ID_RG}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch })).json;
const jobRows = (db) => db.unsafe('select kind, status, attempt from listings.publish_jobs order by created_at');

test('IMPORTED PUBLICATION: with no successful portal job, the portal still knows the listing is published, so the button is an update', async () => {
  const ctx = await imported();
  const h = await history(ctx);
  assert.equal(h.live, null, 'nothing is shown as Live until a real job verifies it');
  assert.equal(h.publishedOnWebsite, true, 'the website snapshot is the evidence that it is already published');
  assert.equal((await jobRows(ctx.db)).length, 0);
  // a genuinely new listing is not "published": it keeps the first-publication button
  const w2 = world(); const db2 = await database(); resetCaches();
  const fresh = await call(draftPublishRoute, w2, db2, ALI_N, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV });
  assert.equal(fresh.json.publishedOnWebsite, false);
  const src = readFileSync(new URL('../listings.js', import.meta.url), 'utf8');
  assert.match(src, /LS\.jobs\.live \|\| LS\.jobs\.publishedOnWebsite/, 'the browser chooses update for a published listing');
  assert.match(src, /published \? 'Publish changes'/);
});

test('IMPORTED PUBLICATION: a first publication request is refused before anything is recorded, copied or dispatched; an update starts in update mode', async () => {
  const ctx = await imported();
  const bad = await publishAs(ctx, 'publish');
  assert.equal(bad.status, 409); assert.equal(bad.json.error, 'already_published');
  assert.match(bad.json.reasons.join(' '), /update/i);
  assert.equal((await jobRows(ctx.db)).length, 0, 'no job'); assert.equal(ctx.gh.dispatches.length, 0, 'no workflow'); assert.equal(ctx.w.publicBlob.mem.size, 0, 'no public image written');
  const ok = await publishAs(ctx, 'update');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.job.kind, 'update');
  assert.equal(ctx.gh.dispatches.length, 1);
  assert.equal(ctx.gh.dispatches[0].body.inputs.mode, 'update');
  assert.equal(ok.json.job.draftVersion, 1);
  // the public identity is what the import preserved: same listing id and the same image files, written in place
  assert.ok([...ctx.w.publicBlob.mem.keys()].every((k) => k.startsWith(ID_RG + '/')));
  assert.equal((await publishAs(ctx, 'update')).json.existing, true, 'asking again for the same version returns the running job');
});

test('IMPORTED PUBLICATION: a failed attempt does not block the corrected update for the same approved draft version', async () => {
  const ctx = await imported();
  // the situation seen in production: the website job refused a first publication (the portal had asked for one before this fix)
  ctx.w.state.snapshots = []; resetCaches();
  const first = await publishAs(ctx, 'publish');
  assert.equal(first.status, 200);
  const fail = await callSigned(publishCallbackRoute, ctx.db, { method: 'POST', url: '/api/listings/publish-callback', secret: SECRET, body: JSON.stringify({ jobId: first.json.job.id, step: 'finished', status: 'failed', detail: { code: 'wrong_mode', message: 'This listing is already published: use an update.' } }) });
  assert.equal(fail.status, 200);
  ctx.w.state.snapshots = [snapshot()]; resetCaches();
  const h = await history(ctx);
  assert.equal(h.live, null, 'a failed job never makes it Live'); assert.equal(h.publishedOnWebsite, true);
  const retry = await publishAs(ctx, 'update');
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  assert.equal(retry.json.existing, false); assert.equal(retry.json.job.kind, 'update'); assert.equal(retry.json.job.attempt, 1);
  assert.equal(ctx.gh.dispatches.at(-1).body.inputs.mode, 'update');
  assert.deepEqual((await jobRows(ctx.db)).map((j) => `${j.kind}:${j.status}`), ['publish:failed', 'update:dispatched'], 'the failed record stays as history; nothing was edited or invented');
});

test('IMPORTED PUBLICATION: an unreadable website does not change first publication, and permissions are unchanged', async () => {
  const ctx = await imported();
  for (const who of [EDITOR, VIEWER]) assert.equal((await publishAs(ctx, 'update', who)).status, 403);
  const h = await history(ctx);
  assert.equal(h.publishedOnWebsite, true);
  const w2 = world(); w2.state.snapshots = []; const db2 = await database(); resetCaches();
  const g2 = github(w2); const orig = g2.fetch;
  g2.fetch = async (u, o) => (String(u).includes('/approved') ? { ok: false, status: 500 } : orig(u, o));
  const read = await call(draftPublishRoute, w2, db2, ALI_N, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV, fetch: g2.fetch });
  assert.equal(read.status, 200); assert.equal(read.json.publishedOnWebsite, null, 'unknown, not guessed');
});

// ---- Nothing to publish: unchanged content is a plain "No changes to publish", not a failed job ----
const save = async (ctx, content) => {
  const cur = (await call(draftRoute, ctx.w, ctx.db, ALI_N, { url: `/api/listings/draft?id=${ID_RG}` })).json;
  return call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'PUT', body: { id: ID_RG, expectedVersion: cur.draft.version, content: { ...cur.draft.content, ...content } } });
};
const live = async (ctx, jobId, version) => {
  const send = (step, status, detail) => callSigned(publishCallbackRoute, ctx.db, { method: 'POST', url: '/api/listings/publish-callback', secret: SECRET, body: JSON.stringify({ jobId, step, status, ...(detail ? { detail } : {}) }) });
  for (const step of ['started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'media', 'pull_request', 'checks', 'merge', 'deploy', 'verify']) await send(step, 'ok');
  return send('finished', 'succeeded', { dryRun: false, live: true, slug: 'rutherford-grove-armstrong-creek-vic', kind: 'update', version, url: 'https://sdahomechoices.com.au/opportunities/rutherford-grove-armstrong-creek-vic/', mergeCommit: 'a'.repeat(40), photos: 6 });
};

test('NO CHANGES: an imported listing nobody has edited reports noChanges, and a dry run is refused with a plain answer and no job', async () => {
  const ctx = await imported();
  assert.equal((await history(ctx)).noChanges, true);
  const r = await publishAs(ctx, 'dry_run');
  assert.equal(r.status, 409); assert.equal(r.json.error, 'no_changes'); assert.match(r.json.reasons.join(' '), /No changes to publish/);
  assert.equal((await jobRows(ctx.db)).length, 0, 'no job is recorded, so nothing shows as Failed'); assert.equal(ctx.gh.dispatches.length, 0);
});

test('NO CHANGES: any real difference turns it off (text, price); notes do not; a value changed and then restored is NOT a change', async () => {
  const ctx = await imported();
  const note = await call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'PUT', body: { id: ID_RG, expectedVersion: 1, content: undefined, addNote: 'checked the address with the agent' } });
  assert.equal(note.status, 200, JSON.stringify(note.json));
  assert.equal((await history(ctx)).noChanges, true, 'a note is not a public change');
  const title = (await call(draftRoute, ctx.w, ctx.db, ALI_N, { url: `/api/listings/draft?id=${ID_RG}` })).json.draft.content.title;
  assert.equal((await save(ctx, { title: title + ' updated' })).status, 200);
  const h1 = await history(ctx);
  assert.equal(h1.noChanges, false); assert.deepEqual(h1.changes.items.map((i) => i.field), ['title']);
  assert.equal((await publishAs(ctx, 'dry_run')).status, 200, 'a changed draft can be rehearsed');
  // restoring the published wording means there is nothing to publish: the comparison looks at values, not at the edit history
  const ctx2 = await imported();
  await save(ctx2, { title: title + ' updated' }); await save(ctx2, { title });
  const h2 = await history(ctx2);
  assert.equal(h2.noChanges, true); assert.equal(h2.changes.count, 0);
  assert.equal((await publishAs(ctx2, 'dry_run')).json.error, 'no_changes', 'and the server agrees');
});

test('NO CHANGES: an acknowledged Notion change or a photograph change counts as a change', async () => {
  const drafts = await import('../api/_lib/drafts-repo.js');
  const ctx = await imported();
  const row = await drafts.getDraft(ctx.db, ID_RG);
  await drafts.updateDraft(ctx.db, { publicId: ID_RG, expectedVersion: row.version, action: 'refresh_base', patch: { baseFacts: { ...row.base_facts, designCategory: 'changed' } }, actor: { email: ALI_N.email }, current: row });
  assert.equal((await history(ctx)).noChanges, false, 'the engine reads Notion facts again, so this is not "nothing"');
  const ctx2 = await imported();
  const r2 = await drafts.getDraft(ctx2.db, ID_RG);
  await drafts.updateDraft(ctx2.db, { publicId: ID_RG, expectedVersion: r2.version, action: 'update', patch: { photos: [...r2.photos].reverse() }, actor: { email: ALI_N.email }, current: r2 });
  assert.equal((await history(ctx2)).noChanges, false);
});

test('NO CHANGES: once Live, an unchanged draft refuses a dry run and answers an update with the job that already published it; a saved change allows them; a merged-but-unconfirmed or running job is never "no changes"', async () => {
  const ctx = await imported();
  await save(ctx, { title: 'Established Improved Liveability SDA Investment, refreshed' });
  const u = await publishAs(ctx, 'update'); assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal((await history(ctx)).noChanges, false, 'a running job is never "no changes"');
  await live(ctx, u.json.job.id, 2); await mirror(ctx);
  const h = await history(ctx); assert.ok(h.live); assert.equal(h.noChanges, true);
  const dry = await publishAs(ctx, 'dry_run'); assert.equal(dry.status, 409); assert.equal(dry.json.error, 'no_changes');
  const again = await publishAs(ctx, 'update'); assert.equal(again.status, 200); assert.equal(again.json.existing, true, 'the same version is answered with the job that already published it');
  assert.equal((await jobRows(ctx.db)).length, 1, 'no extra job for either');
  await save(ctx, { title: 'Established Improved Liveability SDA Investment, refreshed again' });
  assert.equal((await history(ctx)).noChanges, false);
  assert.equal((await publishAs(ctx, 'update')).status, 200);
});

test('NO CHANGES: Viewers and Editors still cannot start anything, and a new listing is untouched by the rule', async () => {
  const ctx = await imported();
  for (const who of [EDITOR, VIEWER]) assert.equal((await publishAs(ctx, 'dry_run', who)).status, 403);
  const w2 = world(); const db2 = await database(); resetCaches();
  const fresh = await call(draftPublishRoute, w2, db2, ALI_N, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV });
  assert.equal(fresh.json.noChanges, false);
});

/* ---- the browser file: plain wording, and a no-change dry run is not a failure ---- */
function uiBrowser() {
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${readFileSync('listings.js', 'utf8')}\n;globalThis.__u = { jobNoChange, errText, ERR_TEXT, lsNoChanges, lsStatusChange, lsStatusFields, lsWithdrawReady, lsWithdrawn, lsWithdrawUnconfirmed, LS };`, ctx);
  return ctx.__u;
}
const noChangeJob = (over = {}) => ({ status: 'failed', kind: 'dry_run', error: { code: 'engine_refused', message: 'the engine would not publish this listing (unchanged, 0 issue(s))' }, steps: [{ step: 'requested', status: 'ok' }, { step: 'engine', status: 'failed', detail: { kind: 'unchanged', issues: [] } }], ...over });

test('UI: a dry run that found nothing to publish is "No changes", any other engine refusal is still a failure', () => {
  const u = uiBrowser();
  assert.equal(u.jobNoChange(noChangeJob()), true);
  assert.equal(u.jobNoChange(noChangeJob({ steps: [{ step: 'engine', status: 'failed', detail: { kind: 'unchanged', issues: ['Victorian pricing compliance'] } }] })), false);
  assert.equal(u.jobNoChange(noChangeJob({ steps: [{ step: 'engine', status: 'failed', detail: { kind: 'not_ready', issues: [] } }] })), false);
  assert.equal(u.jobNoChange(noChangeJob({ error: { code: 'tests_failed' } })), false);
  assert.equal(u.jobNoChange(noChangeJob({ status: 'succeeded' })), false);
});

test('UI: no action is offered when there are no changes, unless Notion moved or a job is running', () => {
  const u = uiBrowser();
  u.LS.d = { notion: { changed: [] } }; u.LS.jobs = { noChanges: true, active: null };
  assert.equal(u.lsNoChanges(), true);
  u.LS.d = { notion: { changed: ['x'] } }; assert.equal(u.lsNoChanges(), false);
  u.LS.d = { notion: { changed: [] } }; u.LS.jobs = { noChanges: true, active: { id: 'j' } }; assert.equal(u.lsNoChanges(), false);
  u.LS.jobs = { noChanges: false, active: null }; assert.equal(u.lsNoChanges(), false);
});

test('UI: staff-facing error text is plain (no GitHub, engine, workflow, payload or pull request wording), covers every code, and never relies on the raw message', () => {
  const u = uiBrowser();
  for (const [code, text] of Object.entries(u.ERR_TEXT)) assert.ok(!/GitHub|engine|workflow|dispatch|payload|manifest|pull request|parity|\bdeploy|\bjob\b|Notion/i.test(text), `${code}: "${text}"`);
  for (const code of ['dispatch_failed', 'workflow_ended', 'no_report', 'timed_out', 'engine_refused', 'parity_failed', 'tests_failed', 'build_failed', 'media_failed', 'media_missing', 'checks_failed', 'merge_refused', 'deploy_failed', 'verify_failed', 'wrong_mode', 'unexpected_files', 'not_configured', 'manifest_invalid', 'property_not_found', 'mode_not_enabled', 'payload_mismatch']) assert.ok(u.ERR_TEXT[code], code);
  const e = { code: 'merge_refused', message: 'GitHub HTTP 405: Repository rule violations found' };
  assert.ok(!u.errText(e).includes('405') && !u.errText(e).includes('rule violations'), 'the raw message goes under Technical details only');
  assert.match(u.errText({ code: 'something_new' }), /did not complete/);
  const src = readFileSync('listings.js', 'utf8');
  assert.match(src, /Technical details/); assert.match(src, /Test without publishing/); assert.match(src, /publishing does not need it/);
  assert.ok(!/GitHub access token/.test(src), 'no stale instruction about the removed personal token');
});

// ---- Commercial status: Available, Under offer, Sold (a Publisher's request; the website keeps its status unless one is asked for) ----
const publishWith = async (ctx, mode, extra = {}, who = ALI_N) => call(draftPublishRoute, ctx.w, ctx.db, who, { method: 'POST', fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_RG, expectedVersion: (await ctx.db.unsafe('select version from listings.drafts where public_id = $1', [ID_RG]))[0].version, mode, ...extra } });
const payloadOfJob = async (ctx, id) => (await ctx.db.unsafe('select payload from listings.publish_jobs where id = $1', [id]))[0].payload;
/** What the website shows after a successful publication: the saved draft, as paragraphs. (The fake job cannot merge, so the test mirrors the merge.) */
const mirror = async (ctx) => {
  const d = (await ctx.db.unsafe('select content from listings.drafts where public_id = $1', [ID_RG]))[0].content;
  const snap = ctx.w.state.snapshots[0];
  ctx.w.state.snapshots[0] = { ...snap, content: { ...snap.content, title: d.title || snap.content.title, description: String(d.description || '').split(/\n\s*\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean) } };
  resetCaches();
};
const setWebsiteStatus = (ctx, status) => { ctx.w.state.snapshots[0] = { ...ctx.w.state.snapshots[0], commercialStatus: status }; resetCaches(); };

test('STATUS: a Publisher can change the public status of a published listing with nothing else to publish; only the change travels in the payload', async () => {
  const ctx = await imported();
  assert.equal((await history(ctx)).websiteStatus, 'available');
  const r = await publishWith(ctx, 'update', { commercialStatus: 'under_offer', expectedStatus: 'available' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.job.kind, 'update'); assert.equal(ctx.gh.dispatches.at(-1).body.inputs.mode, 'update');
  const p = await payloadOfJob(ctx, r.json.job.id);
  assert.equal(p.content.commercialStatus, 'under_offer');
  assert.equal(p.approver.id, 'listings-manager'); assert.ok(!JSON.stringify(p).includes('@'), 'nobody is named in the payload');
  assert.equal((await jobRows(ctx.db)).length, 1);
});

test('STATUS: publishing content without choosing a status never carries one, so the website keeps the status it shows', async () => {
  const ctx = await imported();
  await save(ctx, { title: 'Established Improved Liveability SDA Investment, refreshed' });
  const r = await publishWith(ctx, 'update');
  assert.equal(r.status, 200);
  assert.ok(!('commercialStatus' in (await payloadOfJob(ctx, r.json.job.id)).content));
  const ctx2 = await imported(); await save(ctx2, { title: 'Established Improved Liveability SDA Investment, refreshed again' });
  const same = await publishWith(ctx2, 'update', { commercialStatus: 'available', expectedStatus: 'available' });
  assert.equal(same.status, 200);
  assert.ok(!('commercialStatus' in (await payloadOfJob(ctx2, same.json.job.id)).content), 'asking for the status it already has is not a change');
});

test('STATUS: a stale page cannot undo someone else\'s change (409 status_changed), an invalid status is refused, and a first publication can only be Available', async () => {
  const ctx = await imported();
  setWebsiteStatus(ctx, 'sold');
  const stale = await publishWith(ctx, 'update', { commercialStatus: 'available', expectedStatus: 'available' });
  assert.equal(stale.status, 409); assert.equal(stale.json.error, 'status_changed'); assert.equal(stale.json.current, 'sold');
  const noExpected = await publishWith(ctx, 'update', { commercialStatus: 'available' });
  assert.equal(noExpected.status, 409, 'the status the person saw is required');
  assert.equal((await publishWith(ctx, 'update', { commercialStatus: 'for_sale', expectedStatus: 'sold' })).status, 400);
  assert.equal((await publishWith(ctx, 'publish', { commercialStatus: 'sold', expectedStatus: 'available' })).json.error, 'status_not_allowed');
  assert.equal((await jobRows(ctx.db)).length, 0); assert.equal(ctx.gh.dispatches.length, 0); assert.equal(ctx.w.publicBlob.mem.size, 0);
});

test('STATUS: only Publishers can change it (Editors and Viewers are refused), and an unreadable website stops it with nothing recorded', async () => {
  const ctx = await imported();
  for (const who of [EDITOR, VIEWER]) assert.equal((await publishWith(ctx, 'update', { commercialStatus: 'sold', expectedStatus: 'available' }, who)).status, 403);
  assert.equal((await jobRows(ctx.db)).length, 0);
  const down = ctx.gh.fetch;
  ctx.gh.fetch = async (u, o) => (String(u).includes('/approved') ? { ok: false, status: 500 } : down(u, o));
  resetCaches();
  const r = await publishWith(ctx, 'update', { commercialStatus: 'sold', expectedStatus: 'available' });
  assert.equal(r.status, 503); assert.equal(r.json.error, 'website_unreadable');
  assert.equal((await jobRows(ctx.db)).length, 0); assert.equal(ctx.gh.dispatches.length, 0);
});

test('STATUS: a status change at a version that is already live is a new job, repeating it returns that job, and "no changes" does not hide it', async () => {
  const ctx = await imported();
  await save(ctx, { title: 'Established Improved Liveability SDA Investment, refreshed' });
  const a = await publishWith(ctx, 'update'); await live(ctx, a.json.job.id, 2); await mirror(ctx);
  assert.equal((await history(ctx)).noChanges, true);
  assert.equal((await publishWith(ctx, 'dry_run')).status, 409, 'content is unchanged');
  const s = await publishWith(ctx, 'update', { commercialStatus: 'sold', expectedStatus: 'available' });
  assert.equal(s.status, 200, JSON.stringify(s.json)); assert.equal(s.json.existing, false); assert.notEqual(s.json.job.id, a.json.job.id);
  assert.equal(ctx.gh.dispatches.length, 2);
  const again = await publishWith(ctx, 'update', { commercialStatus: 'sold', expectedStatus: 'available' });
  assert.equal(again.json.existing, true); assert.equal(again.json.job.id, s.json.job.id); assert.equal(ctx.gh.dispatches.length, 2);
  assert.equal((await publishWith(ctx, 'dry_run', { commercialStatus: 'under_offer', expectedStatus: 'available' })).status, 409, 'a second job for the listing cannot start while one runs');
  await live(ctx, s.json.job.id, 2);
  setWebsiteStatus(ctx, 'sold');
  const h = await history(ctx);
  assert.equal(h.websiteStatus, 'sold'); assert.equal(h.noChanges, true);
  const back = await publishWith(ctx, 'update', { commercialStatus: 'available', expectedStatus: 'sold' });
  assert.equal(back.status, 200); assert.equal(back.json.existing, false, 'moving back is a new job');
});

test('STATUS: a listing that is not on the website has no status', async () => {
  const w2 = world(); const db2 = await database(); resetCaches();
  const h = await call(draftPublishRoute, w2, db2, ALI_N, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV });
  assert.equal(h.json.websiteStatus, null);
});

test('UI: the status choice is a change only when it differs from the website, it is sent with the expected status, and Sold needs an explicit confirmation', () => {
  const u = uiBrowser();
  u.LS.jobs = { websiteStatus: 'available', noChanges: true, active: null }; u.LS.d = { notion: { changed: [] } };
  assert.equal(u.lsStatusChange(), null); assert.equal(u.lsNoChanges(), true);
  u.LS.statusChoice = 'sold';
  assert.equal(u.lsStatusChange(), 'sold'); assert.equal(u.lsNoChanges(), false, 'a status change is something to publish');
  assert.deepEqual(JSON.parse(JSON.stringify(u.lsStatusFields())), { commercialStatus: 'sold', expectedStatus: 'available' });
  u.LS.statusChoice = 'available'; assert.equal(u.lsStatusChange(), null); assert.deepEqual(JSON.parse(JSON.stringify(u.lsStatusFields())), {});
  u.LS.jobs = { websiteStatus: null, noChanges: false }; u.LS.statusChoice = 'sold'; assert.equal(u.lsStatusChange(), null, 'no status to change when the listing is not on the website');
  const src = readFileSync('listings.js', 'utf8');
  assert.match(src, /Publish status change/); assert.match(src, /id: 'ls-sold-confirm'/); assert.match(src, /\(sc === 'sold' && !LS\.soldConfirmed\)/);
  assert.match(src, /LS\.statusChoice = null; LS\.soldConfirmed = false;/, 'the choice never survives a change of page');
});

// ---- Withdrawal: private reasons and audit trail, typed address, single Publisher, nothing private reaches the website ----
const ADDR = 'Rutherford Grove, Armstrong Creek VIC 3217';
const SENT = 'PRIVATE-REASON-4f9a-sentinel';
const withdrawWith = (ctx, extra = {}, who = ALI_N, db = ctx.db) => call(draftPublishRoute, ctx.w, db, who, { method: 'POST', fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_RG, mode: 'withdraw', confirmAddress: ADDR, reason: SENT, ...extra } });
const auditRows = (db) => db.unsafe('select * from listings.audit_log order by id');
const tombstone = (ctx) => { ctx.w.state.withdrawn = [{ listingId: ID_RG, withdrawnAt: '2026-11-11T05:00:00.000Z', withdrawnBy: 'SDA Home Choices', reason: 'withdrawn' }]; resetCaches(); };
const historyAs = async (ctx, who) => (await call(draftPublishRoute, ctx.w, ctx.db, who, { url: `/api/listings/draft-publish?id=${ID_RG}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch }));
const cb = (ctx, jobId, step, status, detail) => callSigned(publishCallbackRoute, ctx.db, { method: 'POST', url: '/api/listings/publish-callback', secret: SECRET, body: JSON.stringify({ jobId, step, status, ...(detail ? { detail } : {}) }) });
const nothingStarted = async (ctx) => { assert.equal((await jobRows(ctx.db)).length, 0, 'no job'); assert.equal(ctx.gh.dispatches.length, 0, 'no dispatch'); assert.equal((await auditRows(ctx.db)).length, 0, 'no audit row'); };

test('WITHDRAWAL: a Publisher withdraws a published listing: one job, a private audit row with the reason and the actor, a payload with nothing private, no image or content work', async () => {
  const ctx = await imported();
  const r = await withdrawWith(ctx);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.job.kind, 'withdraw'); assert.equal(r.json.existing, false);
  assert.equal(ctx.gh.dispatches.length, 1); assert.equal(ctx.gh.dispatches[0].body.inputs.mode, 'withdraw');
  const p = await payloadOfJob(ctx, r.json.job.id);
  assert.deepEqual(Object.keys(p).sort(), ['action', 'at', 'authority', 'jobId', 'mode', 'publicId', 'version'], 'only these keys: no content, no reason, no person');
  assert.equal(p.action, 'withdraw'); assert.equal(p.publicId, ID_RG);
  const rows = await auditRows(ctx.db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'withdraw'); assert.equal(rows[0].reason, SENT); assert.equal(rows[0].actor_email, 'ali@sdahomechoices.com.au');
  assert.equal(rows[0].job_id, r.json.job.id); assert.equal(rows[0].public_id, ID_RG); assert.equal(rows[0].draft_version, 1);
  assert.equal(ctx.w.publicBlob.mem.size, 0, 'no public image is written or removed');
  assert.equal((await ctx.db.unsafe('select count(*)::int n from listings.drafts'))[0].n, 1, 'the draft is untouched');
});

test('WITHDRAWAL PRIVACY: the reason never reaches GitHub, the payload, the job record, any log or any response except a Publisher\'s history; Editors and Viewers never see it', async () => {
  const lines = []; setAuditSink((l) => lines.push(l));
  const ctx = await imported();
  const r = await withdrawWith(ctx);
  assert.equal(r.status, 200);
  for (const [step, status, detail] of [['started', 'running'], ['payload', 'ok'], ['engine', 'ok', { kind: 'withdraw', slug: 'rutherford-grove-armstrong-creek-vic' }], ['build', 'ok'], ['pull_request', 'ok', { number: 70, url: 'https://github.com/o/r/pull/70', files: 1 }], ['checks', 'ok'], ['merge', 'ok', { sha: 'a'.repeat(40) }]]) await cb(ctx, r.json.job.id, step, status, detail);
  await cb(ctx, r.json.job.id, 'finished', 'failed', { code: 'verify_failed', message: 'the live site still shows the listing', merged: true });
  const everywhere = JSON.stringify([ctx.gh.dispatches, await ctx.db.unsafe('select * from listings.publish_jobs'), await ctx.db.unsafe('select * from listings.drafts'), await ctx.db.unsafe('select * from listings.draft_history'), ctx.w.calls, lines, r.raw]);
  assert.ok(!everywhere.includes(SENT), 'the reason appears nowhere but the private audit trail');
  assert.ok((await auditRows(ctx.db))[0].reason === SENT, 'and it is there');
  for (const who of [VIEWER, EDITOR]) { const h = await historyAs(ctx, who); assert.equal(h.status, 200); assert.ok(!h.raw.includes(SENT) && !('audit' in h.json), 'viewers and editors get no audit trail'); }
  const pub = await historyAs(ctx, ALI_N);
  assert.ok('audit' in pub.json && pub.json.audit[0].reason === SENT && pub.json.audit[0].by === 'ali@sdahomechoices.com.au', 'a Publisher sees the private record');
  assert.ok(!JSON.stringify(ctx.gh.dispatches).includes('ali@'), 'no person reaches GitHub either');
});

test('WITHDRAWAL: the typed address must match the public address (case and spacing ignored); a wrong or missing address changes nothing', async () => {
  const ctx = await imported();
  for (const bad of [undefined, '', 'Rutherford Grove', 'rutherford grove, armstrong creek vic 3218', '5/50 Rutherford Grove, Armstrong Creek VIC 3217']) {
    const r = await withdrawWith(ctx, { confirmAddress: bad });
    assert.equal(r.status, 409, String(bad)); assert.equal(r.json.error, 'address_mismatch');
  }
  await nothingStarted(ctx);
  const ok = await withdrawWith(ctx, { confirmAddress: '  rutherford GROVE ,Armstrong   Creek vic 3217 ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
});

test('WITHDRAWAL: the reason is required and at most 300 characters; nothing is recorded otherwise', async () => {
  const ctx = await imported();
  for (const [reason, code, status] of [[undefined, 'reason_required', 400], ['', 'reason_required', 400], ['   ', 'reason_required', 400], ['x'.repeat(301), 'invalid_reason', 400]]) {
    const r = await withdrawWith(ctx, { reason }); assert.equal(r.status, status, String(reason).slice(0, 10)); assert.equal(r.json.error, code);
  }
  await nothingStarted(ctx);
  assert.equal((await withdrawWith(ctx, { reason: 'x'.repeat(300) })).status, 200);
});

test('WITHDRAWAL PERMISSIONS: only a Publisher (Editors, Viewers and anonymous callers are refused before anything is read); a Publisher without Editor may withdraw', async () => {
  const ctx = await imported();
  for (const who of [EDITOR, VIEWER]) assert.equal((await withdrawWith(ctx, {}, who)).status, 403);
  assert.equal((await call(draftPublishRoute, ctx.w, ctx.db, ALI_N, { method: 'POST', headers: { authorization: '' }, fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_RG, mode: 'withdraw', confirmAddress: ADDR, reason: SENT } })).status, 401);
  await nothingStarted(ctx);
  assert.equal((await withdrawWith(ctx, {}, PUBLISHER)).status, 200);
});

test('WITHDRAWAL GUARDS: only a published listing that has a draft and is not already withdrawn; an unreadable website stops it; nothing is recorded', async () => {
  const ctx = await imported();
  tombstone(ctx);
  const again = await withdrawWith(ctx); assert.equal(again.status, 409); assert.equal(again.json.error, 'already_withdrawn');
  await nothingStarted(ctx);
  const w2 = world(); const db2 = await database(); resetCaches(); const gh2 = github(w2);
  const noDraft = await call(draftPublishRoute, w2, db2, ALI_N, { method: 'POST', fetch: gh2.fetch, env: PUBLISH_ENV, body: { id: ID_RG, mode: 'withdraw', confirmAddress: ADDR, reason: SENT } });
  assert.equal(noDraft.json.error, 'draft_required');
  const ctx2 = await imported(); const down = ctx2.gh.fetch; ctx2.gh.fetch = async (u, o) => (String(u).includes('/approved') ? { ok: false, status: 500 } : down(u, o)); resetCaches();
  assert.equal((await withdrawWith(ctx2)).status, 503);
  await nothingStarted(ctx2);
  const ctx3 = await imported(); ctx3.w.state.snapshots = []; resetCaches();
  assert.equal((await withdrawWith(ctx3)).json.error, 'not_published');
  await nothingStarted(ctx3);
});

test('WITHDRAWAL: while a listing is withdrawn it cannot be published, updated, re-statused or rehearsed, and nothing is recorded', async () => {
  const ctx = await imported(); tombstone(ctx);
  for (const [mode, extra] of [['update', {}], ['publish', {}], ['dry_run', {}], ['update', { commercialStatus: 'sold', expectedStatus: 'available' }]]) {
    const r = await publishWith(ctx, mode, extra); assert.equal(r.status, 409, mode); assert.equal(r.json.error, 'withdrawn');
  }
  assert.equal((await jobRows(ctx.db)).length, 0); assert.equal(ctx.gh.dispatches.length, 0);
});

test('WITHDRAWAL IDEMPOTENCY: two clicks (or two tabs) leave one job, one audit row and one dispatch; a second withdrawal cannot start while any job runs', async () => {
  const ctx = await imported();
  const [a, b] = await Promise.all([withdrawWith(ctx), withdrawWith(ctx)]);
  assert.ok([a, b].every((r) => r.status === 200), 'both clicks get an answer: the job that won');
  assert.equal([a, b].filter((r) => r.json.existing === false).length, 1, 'exactly one created it');
  assert.equal((await jobRows(ctx.db)).length, 1); assert.equal((await auditRows(ctx.db)).length, 1); assert.equal(ctx.gh.dispatches.length, 1);
  const third = await withdrawWith(ctx); assert.equal(third.status, 200); assert.equal(third.json.existing, true);
  assert.equal((await auditRows(ctx.db)).length, 1, 'repeating a running withdrawal records nothing more');
  const ctx2 = await imported(); await save(ctx2, { title: 'Established Improved Liveability SDA Investment, x' });
  const u = await publishWith(ctx2, 'update'); assert.equal(u.status, 200);
  assert.equal((await withdrawWith(ctx2)).json.error, 'job_active', 'a publication is running: no withdrawal on top of it');
  await live(ctx2, u.json.job.id, 2);
});

test('WITHDRAWAL FAILURE: without the private audit record nothing is dispatched; a dispatch failure fails the job safely and can be retried', async () => {
  const ctx = await imported();
  const bad = { ...ctx.db, unsafe: async (q, p) => { if (/insert into listings\.audit_log/.test(q)) throw new Error('database down'); return ctx.db.unsafe(q, p); } };
  const r = await withdrawWith(ctx, {}, ALI_N, bad);
  assert.equal(r.status, 500); assert.equal(r.json.error, 'audit_failed');
  assert.equal(ctx.gh.dispatches.length, 0);
  assert.deepEqual((await jobRows(ctx.db)).map((j) => `${j.kind}:${j.status}`), ['withdraw:failed']);
  assert.ok(!r.raw.includes(SENT));
  const ctx2 = await imported(); ctx2.gh.status = 422;
  const d = await withdrawWith(ctx2); assert.equal(d.status, 502); assert.equal(d.json.error, 'dispatch_failed');
  assert.equal((await jobRows(ctx2.db)).length, 1); assert.equal((await jobRows(ctx2.db))[0].status, 'failed');
  ctx2.gh.status = 204;
  const retry = await withdrawWith(ctx2); assert.equal(retry.status, 200); assert.equal(retry.json.existing, false); assert.equal(retry.json.job.attempt, 2);
});

test('WITHDRAWAL STATE: Withdrawn is derived from the website; a merge that was not confirmed offers a re-check (no new reason, no new audit row); a verified withdrawal is shown as verified', async () => {
  const ctx = await imported();
  const h0 = (await historyAs(ctx, ALI_N)).json;
  assert.equal(h0.withdrawn, false); assert.equal(h0.withdrawal, null); assert.equal(h0.websiteAddress, ADDR);
  const r = await withdrawWith(ctx);
  assert.equal((await historyAs(ctx, ALI_N)).json.withdrawn, false, 'requested is not withdrawn');
  tombstone(ctx);
  await cb(ctx, r.json.job.id, 'merge', 'ok', { sha: 'a'.repeat(40) });
  await cb(ctx, r.json.job.id, 'finished', 'failed', { code: 'verify_failed', message: 'still showing', merged: true });
  const h1 = (await historyAs(ctx, ALI_N)).json;
  assert.equal(h1.withdrawn, true); assert.equal(h1.withdrawal.merged, true); assert.equal(h1.withdrawal.verified, false);
  assert.equal((await withdrawWith(ctx)).json.error, 'already_withdrawn', 'a new withdrawal is refused');
  assert.equal((await withdrawWith(ctx, { recheck: true, reason: undefined, confirmAddress: undefined }, EDITOR)).status, 403);
  const re = await withdrawWith(ctx, { recheck: true, reason: undefined, confirmAddress: undefined });
  assert.equal(re.status, 200, JSON.stringify(re.json)); assert.equal(re.json.job.attempt, 2);
  assert.equal((await auditRows(ctx.db)).length, 1, 'a re-check is the same withdrawal: no second record');
  await cb(ctx, re.json.job.id, 'finished', 'succeeded', { dryRun: false, live: false, withdrawn: true, slug: 'rutherford-grove-armstrong-creek-vic', kind: 'withdraw' });
  const h2 = (await historyAs(ctx, ALI_N)).json;
  assert.equal(h2.withdrawal.verified, true);
  assert.equal((await withdrawWith(ctx, { recheck: true })).json.error, 'nothing_to_recheck');
});

test('STATUS CHANGE AUDIT: a public status change is recorded privately (who, from, to, job); without that record nothing is started', async () => {
  const ctx = await imported();
  const r = await publishWith(ctx, 'update', { commercialStatus: 'under_offer', expectedStatus: 'available' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rows = await auditRows(ctx.db);
  assert.equal(rows.length, 1); assert.equal(rows[0].action, 'status_change'); assert.equal(rows[0].status_from, 'available'); assert.equal(rows[0].status_to, 'under_offer');
  assert.equal(rows[0].actor_email, 'ali@sdahomechoices.com.au'); assert.equal(rows[0].job_id, r.json.job.id); assert.equal(rows[0].reason, null);
  const ctx2 = await imported();
  const bad = { ...ctx2.db, unsafe: async (q, p) => { if (/insert into listings\.audit_log/.test(q)) throw new Error('database down'); return ctx2.db.unsafe(q, p); } };
  const f = await call(draftPublishRoute, ctx2.w, bad, ALI_N, { method: 'POST', fetch: ctx2.gh.fetch, env: PUBLISH_ENV, body: { id: ID_RG, expectedVersion: 1, mode: 'update', commercialStatus: 'sold', expectedStatus: 'available' } });
  assert.equal(f.status, 500); assert.equal(f.json.error, 'audit_failed'); assert.equal(ctx2.gh.dispatches.length, 0);
  // ordinary publications and dry runs write no audit row
  const ctx3 = await imported(); await save(ctx3, { title: 'Established Improved Liveability SDA Investment, y' });
  assert.equal((await publishWith(ctx3, 'update')).status, 200); assert.equal((await auditRows(ctx3.db)).length, 0);
});

test('WITHDRAWAL UI: the confirm button needs a reason and the exact public address; the screen shows Withdrawn only from the website\'s state; withdraw wording is plain', () => {
  const u = uiBrowser();
  u.LS.jobs = { websiteAddress: ADDR, withdrawn: false, withdrawal: null };
  assert.equal(u.lsWithdrawReady(), false);
  u.LS.withdrawReason = 'Vendor asked to pause'; assert.equal(u.lsWithdrawReady(), false);
  u.LS.withdrawAddress = 'rutherford grove, armstrong creek vic 3218'; assert.equal(u.lsWithdrawReady(), false);
  u.LS.withdrawAddress = '  Rutherford Grove,   Armstrong Creek VIC 3217 '; assert.equal(u.lsWithdrawReady(), true);
  u.LS.withdrawReason = '   '; assert.equal(u.lsWithdrawReady(), false);
  u.LS.withdrawReason = 'x'.repeat(301); assert.equal(u.lsWithdrawReady(), false);
  assert.equal(u.lsWithdrawn(), false);
  u.LS.jobs = { websiteAddress: ADDR, withdrawn: true, withdrawal: { status: 'failed', merged: true } };
  assert.equal(u.lsWithdrawn(), true); assert.equal(u.lsWithdrawUnconfirmed(), true);
  u.LS.jobs.withdrawal = { status: 'succeeded', merged: false, verified: true }; assert.equal(u.lsWithdrawUnconfirmed(), false);
  const src = readFileSync('listings.js', 'utf8');
  assert.match(src, /Reason \(private: it is recorded in the audit trail and is never published\)/);
  assert.match(src, /type the public address of the listing/);
  assert.ok(!/reason:[^}]*LS\.withdrawReason[^}]*\}[^]*?console/.test(src));
  assert.match(src, /Re-check withdrawal/);
  assert.ok(!/GitHub|pull request|workflow|sitemap.*payload/.test(src.slice(src.indexOf('const WITHDRAW_ERR_TEXT'), src.indexOf('const errText =')).replace(/GitHub's/g, '')), 'plain wording in the withdrawal errors');
});

// ---- Final scope: withdrawal is permanent; no reinstatement anywhere a user can see; the documented limits are locked in by tests ----
test('SCOPE: nothing user-facing suggests reinstatement, and withdrawal is described as permanent with no undo', async () => {
  const src = readFileSync('listings.js', 'utf8');
  assert.ok(!/reinstat|reactivat|undo withdraw/i.test(src.replace(/there is no undo/gi, '')), 'the browser file never mentions reinstating');
  assert.match(src, /Withdrawal is permanent in the Listings Manager/);
  assert.match(src, /Marketing this property again is a separate administrative process/);
  const ctx = await imported(); tombstone(ctx);
  const r = await publishWith(ctx, 'update');
  assert.equal(r.status, 409); assert.ok(!/reinstat/i.test(r.raw), 'the API refusal does not promise reinstatement');
  assert.ok(!/reinstate/i.test(readFileSync('api/_lib/publish-service.js', 'utf8').replace(/\/\/.*$/gm, '')), 'no reinstate code path exists in the publication service');
  const route = readFileSync('api/_lib/routes.js', 'utf8') + readFileSync('api/_lib/withdrawal.js', 'utf8');
  assert.ok(!/reinstate/i.test(route.replace(/\/\/.*$/gm, '')), 'no route or service accepts a reinstate request');
});

test('DOCUMENTED LIMIT: for a withdrawn property, Create draft and Import published listing are refused, so normal Create Listing must not be promised', async () => {
  const ctx = await setup(); ctx.w.state.withdrawn = [{ listingId: ID_RG, withdrawnAt: '2026-11-11T05:00:00.000Z', withdrawnBy: 'SDA Home Choices', reason: 'withdrawn' }]; resetCaches();
  const create = await call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'POST', fetch: ctx.fetch, body: { propertyId: ID_RG } });
  assert.equal(create.status, 409); assert.equal(create.json.error, 'already_published');
  const imp = await importAs(ctx, ALI_N);
  assert.equal(imp.status, 409);
  assert.equal((await drafts(ctx.db)).length, 0, 'nothing is created');
  const docs = readFileSync('docs/real-publication-setup.md', 'utf8');
  assert.match(docs, /Do \*\*not\*\* expect Create Listing to work for it/); assert.match(docs, /public photograph files are \*\*kept\*\*|Public photograph files are retained after a withdrawal/i);
  assert.match(docs, /anyone who has an exact URL can still open them/);
});
