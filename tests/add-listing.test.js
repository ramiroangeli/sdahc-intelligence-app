// Add listing: server-side search and paging across EVERY CRM property (not just the first 100), what each match will do, permissions, and the screen logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pickerFor, PICKER_MAX } from '../api/_lib/draft-service.js';
import { propertiesRoute } from '../api/_lib/routes.js';
import { publicIdFor } from '../api/_lib/notion.js';
import { clearSnapshotCache } from '../api/_lib/site.js';
import { clearPropertyCache } from '../api/_lib/property.js';
import { ALI, EDITOR, VIEWER, call, database, resetCaches, world } from './drafts-harness.js';

const CFG = { notion: { token: 't', dataSourceId: 'ds', version: 'v' }, repo: 'o/r', ref: 'main' };
const pageId = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const row = (i, name) => ({ id: pageId(i), archived: false, properties: { Name: { type: 'title', title: [{ plain_text: name }] }, 'State/ Territory': { type: 'select', select: { name: 'VIC' } }, 'Web Listing Status': { type: 'select', select: { name: 'Not Published' } } } });

/** A CRM of `n` properties served three hundred at a time in pages of 100 like Notion does, plus the website's snapshot folders. */
function crm(n, { withdrawn = [], approved = [] } = {}) {
  const all = Array.from({ length: n }, (_, i) => row(i + 1, i === 0 ? '' : `${i}${i % 7 === 0 ? 'A' : ''} Street${i % 50 === 0 ? ' Wattle' : ''} Number ${i}, Town${i % 9} VIC 3${String(i).padStart(3, '0')}`));
  return async (url, opts = {}) => {
    const u = String(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (u.includes('api.notion.com') && u.includes('/query')) {
      const body = JSON.parse(opts.body || '{}'); const start = body.start_cursor ? Number(body.start_cursor) : 0;
      const slice = all.slice(start, start + 100);
      return ok({ results: slice, has_more: start + 100 < all.length, next_cursor: String(start + 100) });
    }
    const m = /approved\/s(\d+)\.json/.exec(u); if (m) return ok({ listingId: approved[Number(m[1])], version: 1, commercialStatus: 'available', content: { slug: 'slug-' + 'abcdefgh'[Number(m[1])], title: 'T' } });
    const w = /withdrawn\/w(\d+)\.json/.exec(u); if (w) return ok({ listingId: withdrawn[Number(w[1])] });
    if (u.includes('/approved')) return ok(approved.map((id, i) => ({ type: 'file', name: `s${i}.json`, download_url: `https://raw.githubusercontent.com/x/approved/s${i}.json` })));
    if (u.includes('/withdrawn')) return ok(withdrawn.map((id, i) => ({ type: 'file', name: `w${i}.json`, download_url: `https://raw.githubusercontent.com/x/withdrawn/w${i}.json` })));
    throw new Error('unexpected fetch ' + u);
  };
}
const fresh = () => { clearPropertyCache(); clearSnapshotCache(); };
const idOf = (i) => publicIdFor(pageId(i));
const run = async (n, args = {}, opts) => { fresh(); const db = await database(); return pickerFor({ cfg: CFG, db, fetchImpl: crm(n, opts), ...args }); };

test('SEARCH: all 250 CRM properties are reachable (the old screen stopped at the first 100): paging covers every one, with a total', async () => {
  fresh(); const db = await database(); const fetchImpl = crm(250);
  const seen = new Set(); let offset = 0; let last;
  for (let i = 0; i < 20; i += 1) { last = await pickerFor({ cfg: CFG, db, fetchImpl, offset, limit: 25 }); last.properties.forEach((p) => seen.add(p.id)); offset += last.properties.length; if (!last.hasMore) break; }
  assert.equal(seen.size, 250, 'every property is reachable by paging');
  assert.equal(last.total, 250); assert.equal(last.hasMore, false);
  const first = await pickerFor({ cfg: CFG, db, fetchImpl });
  assert.equal(first.properties.length, 25); assert.equal(first.total, 250); assert.equal(first.hasMore, true); assert.equal(first.offset, 0);
});

test('SEARCH: the search runs over ALL properties on the server, every word must match in any order, and the total counts matches', async () => {
  const r = await run(250, { q: 'wattle' });
  assert.equal(r.total, 4, 'properties 50, 100, 150 and 200 contain "Wattle", all beyond the first 100 except one');
  assert.ok(r.properties.some((p) => p.name.startsWith('200 ')), 'a match from far beyond the first 100 is found');
  const two = await run(250, { q: 'number 200 street' });
  assert.equal(two.total, 1); assert.equal(two.properties[0].name.startsWith('200 '), true);
  assert.equal((await run(250, { q: 'zzzzz' })).total, 0);
  assert.equal((await run(250, { q: 'WATTLE' })).total, 4, 'case does not matter');
});

test('SEARCH: results that START with what was typed come first, unnamed CRM records come last, and paging is stable', async () => {
  const r = await run(250, { q: '19', limit: 50 });
  assert.ok(r.properties[0].name.startsWith('19 ') || r.properties[0].name.startsWith('19A'), r.properties[0].name);
  const all = await run(250, { limit: 50 });
  assert.equal(all.properties[0].unnamed, false);
  const last = await run(250, { offset: 200, limit: 50 });
  assert.equal(last.properties.at(-1).unnamed, true, 'the record with no name is last');
  const a = await run(250, { offset: 25, limit: 25 }); const b = await run(250, { offset: 25, limit: 25 });
  assert.deepEqual(a.properties.map((p) => p.id), b.properties.map((p) => p.id));
});

test('SEARCH: limits are enforced (page size, maximum, bad numbers) and nothing private is returned', async () => {
  assert.equal((await run(120, { limit: 9999 })).properties.length, PICKER_MAX);
  assert.equal((await run(120, { limit: 0 })).properties.length, 1);
  assert.equal((await run(120, { offset: -5, limit: 3 })).offset, 0);
  const r = await run(30, { limit: 30 });
  for (const p of r.properties) assert.deepEqual(Object.keys(p).sort(), ['buildType', 'designCategories', 'hasDraft', 'id', 'kind', 'name', 'notionStatus', 'onWebsite', 'state', 'unnamed']);
});

test('DETECTION: each match says what Add listing will do: new, existing draft, already live (bring in), or withdrawn (unavailable)', async () => {
  fresh(); const db = await database();
  await db.unsafe(`insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, created_by, updated_by) values ($1, $2, 'Street', '{}', '{}', 'a@b.co', 'a@b.co')`, [idOf(3), pageId(3)]);
  const r = await pickerFor({ cfg: CFG, db, fetchImpl: crm(10, { approved: [idOf(2), idOf(3)], withdrawn: [idOf(4)] }), limit: 50 });
  const kind = (i) => r.properties.find((p) => p.id === idOf(i)).kind;
  assert.equal(kind(2), 'live', 'approved on the website, no draft: eligible for import');
  assert.equal(kind(3), 'draft', 'a draft exists, even when it is also live: open it');
  assert.equal(kind(4), 'withdrawn', 'withdrawn: unavailable');
  assert.equal(kind(5), 'new');
  assert.equal(r.properties.find((p) => p.id === idOf(1)).unnamed, true);
});

test('PERMISSIONS: the property search is for Editors only (Viewers refused), and the response is paged', async () => {
  resetCaches(); const w = world(); const db = await database();
  assert.equal((await call(propertiesRoute, w, db, VIEWER)).status, 403);
  const ok = await call(propertiesRoute, w, db, EDITOR, { url: '/api/listings/properties?q=wattle&offset=0&limit=10' });
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray(ok.json.properties) && Number.isInteger(ok.json.total) && 'hasMore' in ok.json);
  assert.equal((await call(propertiesRoute, w, db, ALI, { url: '/api/listings/properties' })).status, 200);
});

/* ---- the screen ---- */
const code = readFileSync('listings.js', 'utf8');
function screen() {
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;globalThis.__a = { lsPickerChoice, PICKER_KIND };`, ctx);
  return ctx.__a;
}
const J = (x) => JSON.parse(JSON.stringify(x));

test('SCREEN: one entry point, one primary button; a withdrawn or unnamed property cannot be chosen; bringing in a live property needs Editor and Publisher', () => {
  const a = screen();
  const both = { canEdit: true, canPublish: true }; const editorOnly = { canEdit: true, canPublish: false };
  assert.equal(a.lsPickerChoice({ kind: 'new' }, editorOnly).ok, true);
  assert.equal(a.lsPickerChoice({ kind: 'draft' }, editorOnly).ok, true);
  assert.equal(a.lsPickerChoice({ kind: 'live' }, both).ok, true);
  const noPub = J(a.lsPickerChoice({ kind: 'live' }, editorOnly)); assert.equal(noPub.ok, false); assert.match(noPub.why, /Publisher/);
  assert.equal(a.lsPickerChoice({ kind: 'withdrawn' }, both).ok, false); assert.match(a.lsPickerChoice({ kind: 'withdrawn' }, both).why, /administrator/);
  assert.equal(a.lsPickerChoice({ kind: 'new', unnamed: true }, both).ok, false);
  assert.deepEqual(Object.keys(J(a.PICKER_KIND)), ['new', 'draft', 'live', 'withdrawn']);
  const paint = code.slice(code.indexOf('function paintPicker'), code.indexOf('async function lsCreate'));
  assert.equal((paint.match(/btn btn-primary/g) || []).length, 1, 'one primary button on the screen');
  assert.ok(!/Create draft|Import published listing|Yes, import it/.test(code), 'no per-row Create draft or Import buttons');
  assert.match(code, /lsCreate\(p\.id, p\.kind === 'live'\)/, 'a live property is brought in through the same entry point (same endpoint, same import flag)');
  assert.match(code, /&offset=' \+ offset \+ '&limit=25/); assert.match(code, /Show more/);
});
