// The Listings list: ONE publication state per listing (separate from the selling status), computed on the server from real data; plus the screen's filters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { publicationFor } from '../api/_lib/listings-service.js';
import { listRoute } from '../api/_lib/routes.js';
import { ALI, ID_RG, call, database, resetCaches, world } from './drafts-harness.js';

const SNAP = {
  address: 'Rutherford Grove, Armstrong Creek VIC 3217',
  public: { title: 'Established SDA house', description: ['One paragraph.'], pricingMode: 'contact_agent', displayPrice: null, featured: false, photos: [{ id: 'aaaaaaaaaaaa', alt: 'Front', kind: 'photo' }] },
};
const draftRow = (over = {}) => ({ content: { title: 'Established SDA house', description: 'One paragraph.', publicAddress: SNAP.address, pricingMode: 'contact_agent', displayPrice: '', featured: false, ...over }, photos: [{ id: 'aaaaaaaaaaaa', alt: 'Front', kind: 'photo' }] });

test('PUBLICATION STATE: draft, ready, publishing, live, live with changes, withdrawn: one state, never mixed with the selling status', () => {
  const st = (a) => publicationFor(a).state;
  assert.equal(st({ draftRow: { content: { title: 'x' }, photos: [] }, snapshot: null }), 'draft');
  assert.equal(st({ draftRow: draftRow(), snapshot: null }), 'ready');
  assert.equal(st({ draftRow: { ...draftRow(), photos: [] }, snapshot: null }), 'draft', 'a photograph is needed to be ready');
  assert.equal(st({ draftRow: { ...draftRow(), photos: [{ id: 'f', kind: 'floorplan' }] }, snapshot: null }), 'draft', 'a floorplan alone is not a photograph');
  assert.equal(st({ draftRow: draftRow(), snapshot: SNAP }), 'live');
  assert.equal(st({ draftRow: draftRow({ description: 'Changed.' }), snapshot: SNAP }), 'live_changes');
  assert.equal(st({ draftRow: draftRow(), snapshot: SNAP, lastJob: { kind: 'update', status: 'running' } }), 'publishing');
  assert.equal(st({ draftRow: draftRow(), snapshot: SNAP, withdrawn: true }), 'withdrawn');
  assert.equal(st({ draftRow: null, snapshot: SNAP }), 'live', 'a listing on the website with no draft is simply live');
  for (const state of ['draft', 'ready', 'publishing', 'live', 'live_changes', 'withdrawn']) assert.ok(!/available|offer|sold/i.test(state));
});

test('PUBLICATION STATE: changes are real differences (a restored value is not a change) and the count is reported', () => {
  assert.equal(publicationFor({ draftRow: draftRow({ description: 'Changed.', title: 'New title' }), snapshot: SNAP }).changesCount, 2);
  const restored = draftRow({ description: 'Changed.' }); restored.content.description = 'One paragraph.';
  assert.deepEqual(publicationFor({ draftRow: restored, snapshot: SNAP }), { state: 'live', changesCount: 0, attention: false });
});

test('ATTENTION: only a real job that did not complete asks for attention (a failed test run or an unfinished one does not)', () => {
  const a = (lastJob, extra = {}) => publicationFor({ draftRow: draftRow(), snapshot: SNAP, lastJob, ...extra }).attention;
  assert.equal(a({ kind: 'update', status: 'failed' }), true);
  assert.equal(a({ kind: 'update', status: 'succeeded' }), false);
  assert.equal(a(null), false);
  assert.equal(publicationFor({ draftRow: draftRow(), snapshot: SNAP, withdrawn: true, lastJob: { kind: 'withdraw', status: 'failed', result: { merged: true } } }).attention, true, 'a withdrawal merged but not confirmed');
  assert.equal(publicationFor({ draftRow: draftRow(), snapshot: SNAP, withdrawn: true, lastJob: { kind: 'withdraw', status: 'succeeded' } }).attention, false);
});

test('LIST ENDPOINT: each row carries its publication state and the number of changes waiting; the selling status is a separate field', async () => {
  resetCaches(); const w = world(); const db = await database();
  const r = await call(listRoute, w, db, ALI);
  assert.equal(r.status, 200, r.raw);
  const rg = r.json.listings.find((l) => l.id === ID_RG);
  assert.ok(rg, 'the published listing is listed');
  assert.equal(rg.publication.state, 'live'); assert.equal(rg.publication.changesCount, 0); assert.equal(rg.publication.attention, false);
  assert.equal(rg.website.commercialStatus, 'available', 'the selling status is reported separately from the publication state');
  assert.ok(r.json.listings.every((l) => l.publication && typeof l.publication.state === 'string'));
  assert.ok(!JSON.stringify(r.json).includes('Notion says'), 'no sentence blames the CRM');
});

/* ---- the screen ---- */
const code = readFileSync('listings.js', 'utf8');
function screen() {
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;globalThis.__s = { lsListMatches, lsListHref, lsListAction, LIST_FILTERS };`, ctx);
  return ctx.__s;
}
const L = (over) => ({ id: 'lst_454f05d21f', website: { commercialStatus: 'available' }, deployment: { state: 'live' }, publication: { state: 'live', changesCount: 0, attention: false }, ...over });

test('LIST SCREEN: filters (All, Needs attention, Drafts, Live, Withdrawn), one action per row, and published listings open on Manage', () => {
  const s = screen();
  const rows = {
    live: L(), changes: L({ publication: { state: 'live_changes', changesCount: 2, attention: false } }), draft: L({ website: null, deployment: { state: 'not_published' }, publication: { state: 'draft', changesCount: 0, attention: false } }),
    failed: L({ publication: { state: 'live', changesCount: 0, attention: true } }), down: L({ deployment: { state: 'not_live' } }), gone: L({ deployment: { state: 'withdrawn' }, publication: { state: 'withdrawn', changesCount: 0, attention: false } }),
  };
  const n = (key) => Object.entries(rows).filter(([, l]) => s.lsListMatches(l, key)).map(([k]) => k).join();
  assert.equal(n('all'), 'live,changes,draft,failed,down,gone');
  assert.equal(n('attention'), 'failed,down');
  assert.equal(n('draft'), 'draft');
  assert.equal(n('live'), 'live,changes,failed,down');
  assert.equal(n('withdrawn'), 'gone');
  assert.deepEqual(J(s.LIST_FILTERS).map((x) => x[1]), ['All', 'Needs attention', 'Drafts', 'Live', 'Withdrawn']);
  assert.match(s.lsListHref(rows.live), /\/manage$/); assert.match(s.lsListHref(rows.gone), /\/manage$/); assert.ok(!/manage/.test(s.lsListHref(rows.draft)));
  assert.equal(s.lsListAction(rows.live), 'Manage'); assert.equal(s.lsListAction(rows.draft), 'Continue'); assert.equal(s.lsListAction(rows.gone), 'View');
});

test('LIST SCREEN: no CRM status, raw page path or version number; the columns say what staff need', () => {
  const list = code.slice(code.indexOf('const LIST_FILTERS'), code.indexOf('/* ------------------------------------------------------------------ Add listing'));
  assert.match(list, /\['Property', 'On the website', 'Selling status', ''\]/);
  for (const gone of ["'CRM status'", "'Page'", "'v' +", "Draft v", '/opportunities/', 'notion.status']) assert.ok(!list.includes(gone), `still shows ${gone}`);
  assert.match(list, /publicationBadge\(st\)/); assert.match(list, /commercialBadge\(l\.website\.commercialStatus\)/);
  assert.equal((list.match(/btn btn-primary/g) || []).length, 1, 'one primary action on the list: Add listing');
});
const J = (x) => JSON.parse(JSON.stringify(x));
