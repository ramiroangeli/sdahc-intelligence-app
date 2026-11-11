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
  assert.match(ui, /Import published listing/); assert.match(ui, /importPublished: true/);
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
  assert.match(src, /live \|\| onSite \? 'Publish update'/);
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

test('NO CHANGES: any saved public change turns it off (text, price, even if changed back); notes do not', async () => {
  const ctx = await imported();
  const note = await call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'PUT', body: { id: ID_RG, expectedVersion: 1, content: undefined, addNote: 'checked the address with the agent' } });
  assert.equal(note.status, 200, JSON.stringify(note.json));
  assert.equal((await history(ctx)).noChanges, true, 'a note is not a public change');
  const title = (await call(draftRoute, ctx.w, ctx.db, ALI_N, { url: `/api/listings/draft?id=${ID_RG}` })).json.draft.content.title;
  assert.equal((await save(ctx, { title: title + ' updated' })).status, 200);
  assert.equal((await history(ctx)).noChanges, false);
  assert.equal((await publishAs(ctx, 'dry_run')).status, 200, 'a changed draft can be rehearsed');
  // restoring the old wording is still a saved change: the rule is conservative and never hides an update
  const ctx2 = await imported();
  await save(ctx2, { title: title + ' updated' }); await save(ctx2, { title });
  assert.equal((await history(ctx2)).noChanges, false);
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
  await live(ctx, u.json.job.id, 2);
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
  vm.runInContext(`${readFileSync('listings.js', 'utf8')}\n;globalThis.__u = { jobNoChange, errText, ERR_TEXT, lsNoChanges, lsStatusChange, lsStatusFields, LS };`, ctx);
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
  assert.match(src, /Technical details/); assert.match(src, /Dry run \(optional\)/); assert.match(src, /you can publish without running one/);
  assert.ok(!/GitHub access token/.test(src), 'no stale instruction about the removed personal token');
});

// ---- Commercial status: Available, Under offer, Sold (a Publisher's request; the website keeps its status unless one is asked for) ----
const publishWith = async (ctx, mode, extra = {}, who = ALI_N) => call(draftPublishRoute, ctx.w, ctx.db, who, { method: 'POST', fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_RG, expectedVersion: (await ctx.db.unsafe('select version from listings.drafts where public_id = $1', [ID_RG]))[0].version, mode, ...extra } });
const payloadOfJob = async (ctx, id) => (await ctx.db.unsafe('select payload from listings.publish_jobs where id = $1', [id]))[0].payload;
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
  const a = await publishWith(ctx, 'update'); await live(ctx, a.json.job.id, 2);
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
  assert.match(src, /Publish status change/); assert.match(src, /id: 'ls-sold-confirm'/); assert.match(src, /disabled: sc === 'sold' && !LS\.soldConfirmed/);
  assert.match(src, /LS\.statusChoice = null; LS\.soldConfirmed = false;/, 'the choice never survives a change of page');
});
