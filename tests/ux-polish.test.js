// Final UX polish: (1) the file picker starts the upload, (2) photo descriptions are optional, (3) History is collapsed by default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import { draftPhotosRoute, draftRoute } from '../api/_lib/routes.js';
import { fallbackAlt, photoReadiness, photoView, photosForRules, withEffectiveAlt } from '../api/_lib/photos.js';
import { ALI, ID_7B, call, database, resetCaches, world } from './drafts-harness.js';

const code = readFileSync('listings.js', 'utf8');
const css = readFileSync('listings.css', 'utf8');

/* ---------- a minimal browser for the picker and History logic ---------- */
function browser() {
  const els = new Map();
  const mk = (id) => { const e = { id, attrs: {}, hidden: false, classes: new Set(), classList: { toggle: (c, on) => (on ? e.classes.add(c) : e.classes.delete(c)) }, setAttribute: (k, v) => { e.attrs[k] = v; }, click() { e.clicked = (e.clicked || 0) + 1; } }; els.set(id, e); return e; };
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: (id) => els.get(id) ?? null, createElement: () => mk('(new)'), body: { append: (e) => els.set(e.id, e) }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;globalThis.__t = { lsPicked, lsOnPick, lsChoose, lsFileInput, lsToggleHistory, LS, setEnqueue: (f) => { lsEnqueue = f; } };`, ctx);
  return { ctx, els, mk, t: ctx.__t };
}

/** A file input whose `files` list is LIVE, like the real thing: assigning value = '' empties it. */
const liveInput = (files) => { let list = files.slice(); const input = { get files() { return list; }, set value(v) { if (v === '') list = []; }, get value() { return list.length ? 'C:\\fakepath\\x' : ''; } }; return input; };

test('PICKER: choosing files through the button starts the upload for every file (the live FileList is copied before it is reset)', () => {
  const { t } = browser();
  const got = []; t.setEnqueue((files, opts) => got.push({ files: [...files], opts }));
  const input = liveInput(['a.jpg', 'b.jpg', 'c.jpg']);
  t.lsOnPick({ target: input });
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].files, ['a.jpg', 'b.jpg', 'c.jpg'], 'all three files reach the same queue as drag and drop');
  assert.equal(input.files.length, 0, 'the input was reset so the same file can be chosen again');
});

test('PICKER: replacing one image passes the target through; cancelling (no files) does nothing and raises no error', () => {
  const { t } = browser();
  const got = []; t.setEnqueue((files, opts) => got.push({ files: [...files], opts }));
  t.lsOnPick({ target: liveInput(['new.jpg']) }, { replace: 'abc123abc123' });
  assert.deepEqual(got[0].opts, { replace: 'abc123abc123' });
  assert.doesNotThrow(() => t.lsOnPick({ target: liveInput([]) }));
  assert.doesNotThrow(() => t.lsOnPick({ target: null }));
  assert.doesNotThrow(() => t.lsOnPick(undefined));
  assert.equal(got.length, 1, 'cancel never enqueues');
});

test('PICKER: the same file can be chosen again after an upload', () => {
  const { t } = browser();
  let n = 0; t.setEnqueue(() => { n += 1; });
  const input = liveInput(['same.jpg']);
  t.lsOnPick({ target: input });
  input.files; // the dialog is reopened and the same file chosen: a new change event with the same name
  const again = liveInput(['same.jpg']);
  t.lsOnPick({ target: again });
  assert.equal(n, 2);
});

test('PICKER: one persistent off-screen input is used by both "Add photographs" and "Replace"; multiple only for adding; the old copy-after-reset bug is gone', () => {
  const { t, els } = browser();
  t.lsChoose();
  const input = els.get('ls-file-input');
  assert.ok(input && input.clicked === 1, 'the dialog is opened by a click on the input');
  assert.equal(input.multiple, true, 'adding allows several files');
  t.lsChoose({ replace: 'x' });
  assert.equal(els.get('ls-file-input'), input, 'the same input is reused, never rebuilt');
  assert.equal(input.multiple, false, 'replacing takes one file');
  assert.match(code, /onclick: \(\) => lsChoose\(\), onkeydown/);
  assert.match(code, /lsChoose\(\{ replace: p\.id \}\)/);
  assert.ok(!/const f = e\.target\.files; e\.target\.value = ''/.test(code), 'the bug pattern is gone');
  assert.match(css, /\.ls-offscreen/);
});

test('DESCRIPTIONS: empty, "Kitchen", "Bathroom" and "Bedroom" are all accepted; there is no minimum length', () => {
  for (const alt of ['', 'Kitchen', 'Bathroom', 'Bedroom', 'a']) {
    const r = photoReadiness([{ id: 'aaaaaaaaaaaa', alt, files: [] }], { street: 'Wattle Street' });
    assert.deepEqual(r.items[0].issues, [], `"${alt}" is fine`);
    assert.equal(r.ready, true);
  }
  assert.equal(photoReadiness([{ id: 'aaaaaaaaaaaa', alt: 'x'.repeat(201), files: [] }]).items[0].issues[0].code, 'alt_long', 'the upper limit remains');
});

test('DESCRIPTIONS: the privacy checks still apply to anything that was typed', () => {
  const bad = (alt) => photoReadiness([{ id: 'aaaaaaaaaaaa', alt, files: [] }], { street: 'Wattle Street' }).items[0].issues.map((i) => i.code);
  assert.ok(bad('The house at 7B Wattle Street from the road').includes('alt_private'));
  assert.ok(bad('Priced at $695,000').includes('alt_private'));
  assert.ok(bad('Call 0412 345 678').includes('alt_private'));
  assert.ok(bad('See https://example.test/x').includes('alt_private'));
  assert.ok(bad('IMG_2231.jpg').includes('alt_filename'));
});

test('DESCRIPTIONS: an empty description gets a neutral fallback that states only what is certain', () => {
  assert.equal(fallbackAlt('photo', 1, 1), 'Photograph of the property');
  assert.equal(fallbackAlt('photo', 2, 5), 'Photograph 2 of 5 of the property');
  assert.equal(fallbackAlt('floorplan', 1, 1), 'Floorplan of the property');
  const list = withEffectiveAlt([
    { id: 'a1', alt: '', files: [] }, { id: 'b2', alt: 'Kitchen', files: [] }, { id: 'c3', alt: '  ', files: [] }, { id: 'd4', alt: '', kind: 'floorplan', files: [] }]);
  assert.deepEqual(list.map((p) => [p.altText, p.altFallback]), [['Photograph 1 of 3 of the property', true], ['Kitchen', false], ['Photograph 3 of 3 of the property', true], ['Floorplan of the property', true]]);
  // never anything private: no street, no number beside a street, no amount, no contact detail
  for (const p of list) assert.ok(!/\$|@|http|\d+\s+\w+\s+(street|road|grove)|yield|income/i.test(p.altText), p.altText);
  const v = photoView([{ id: 'a1', alt: '', files: [{ w: 480, file: 'a1-480.webp' }] }], {});
  assert.equal(v.items[0].alt, '', 'the stored value stays empty');
  assert.equal(v.items[0].altText, 'Photograph of the property');
  assert.equal(v.items[0].altFallback, true);
  assert.equal(v.readiness.ready, true);
});

test('DESCRIPTIONS: the fallback and short text go to the website rules unchanged, in the order of the gallery', () => {
  const ph = [{ id: 'a1', alt: '', files: [{ w: 480, file: 'a1-480.webp' }], width: 1600, height: 1000, accent: 'teal' }, { id: 'b2', alt: 'Kitchen', files: [{ w: 480, file: 'b2-480.webp' }], width: 1600, height: 1000, accent: 'teal' }];
  assert.deepEqual(photosForRules(ph).map((p) => p.alt), ['Photograph 1 of 2 of the property', 'Kitchen']);
});

async function setup() { resetCaches(); const w = world(); const db = await database(); const c = await call(draftRoute, w, db, ALI, { method: 'POST', body: { propertyId: ID_7B } }); return { w, db, v: c.json.draft.version }; }
const GOOD = { title: 'Established Improved Liveability SDA Investment', description: 'An improved liveability SDA house in Exampleton with three participant places and onsite overnight assistance.', publicAddress: 'Wattle Street, Exampleton VIC 3999', pricingMode: 'contact_agent', displayPrice: '', featured: false };
const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const up = (w, db, bytes) => call(draftPhotosRoute, w, db, ALI, { method: 'POST', body: bytes, headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}` });

test('END TO END: a gallery with no descriptions and one "Kitchen" passes the website photo rules with no review step; the main listing description stays required', async () => {
  const { w, db, v } = await setup();
  const a = await up(w, db, await jpeg(1)); const b = await up(w, db, await jpeg(2));
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  const ids = b.json.photos.items.map((p) => p.id);
  const save = await call(draftPhotosRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, expectedVersion: b.json.draft.version, photos: [{ id: ids[0], alt: '', kind: 'photo' }, { id: ids[1], alt: 'Kitchen', kind: 'photo' }] } });
  assert.equal(save.status, 200); assert.equal(save.json.photos.readiness.ready, true);
  assert.deepEqual(save.json.photos.items.map((p) => p.altText), ['Photograph 1 of 2 of the property', 'Kitchen']);
  const cur = await call(draftRoute, w, db, ALI, { url: `/api/listings/draft?id=${ID_7B}` });
  const put = await call(draftRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, expectedVersion: cur.json.draft.version, content: GOOD } });
  assert.equal(put.status, 200);
  const val = put.json.validation;
  assert.ok(!val.errors.some((e) => /photos?\b|alt/i.test(e.message)), 'the website rules raise nothing about the photo descriptions: ' + JSON.stringify(val.errors));
  assert.ok(!val.blockers.some((b) => ['photos_required', 'photo_alt'].includes(b.code)), JSON.stringify(val.blockers.map((b) => b.code)));
  // the main listing description is still required
  const empty = await call(draftRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, expectedVersion: put.json.draft.version, content: { ...GOOD, description: '' }, dryRun: true } });
  assert.ok(empty.json.validation.fieldErrors.description, 'the listing description is still required');
});

test('END TO END: a typed description with a house number still blocks publication (automatic check)', async () => {
  const { w, db } = await setup();
  const a = await up(w, db, await jpeg(3));
  const ids = a.json.photos.items.map((p) => p.id);
  const bad = await call(draftPhotosRoute, w, db, ALI, { method: 'PUT', body: { id: ID_7B, expectedVersion: a.json.draft.version, photos: [{ id: ids[0], alt: 'The house at 7B Wattle Street', kind: 'photo' }] } });
  assert.equal(bad.status, 200, 'saving is never blocked');
  const v = await call(draftRoute, w, db, ALI, { url: `/api/listings/draft?id=${ID_7B}` });
  assert.ok(v.json.validation.blockers.some((b) => b.code === 'photo_alt'));
});

test('UI: descriptions are labelled optional, the preview uses the effective text, and no minimum-length wording remains', () => {
  assert.match(code, /text: 'Description \(optional\)'/);
  assert.match(code, /placeholder: 'Optional, e\.g\. Kitchen'/);
  assert.match(code, /No description\. The website will say:/);
  assert.match(code, /lsPhotoImg\(lead\.id, 960, lead\.altText\)/);
  assert.ok(!/at least 8 characters|too short|Describe the image in at least/i.test(code));
});

/* ---------- History ---------- */
test('HISTORY: collapsed when a listing opens; the heading is a real button with aria-expanded; the panel is hidden until opened', () => {
  const { t } = browser();
  assert.equal(t.LS.historyOpen, false);
  assert.match(code, /const hOpen = !!LS\.historyOpen;/);
  assert.match(code, /'aria-expanded': hOpen \? 'true' : 'false', 'aria-controls': 'ls-hist-panel', onclick: lsToggleHistory/);
  assert.match(code, /id: 'ls-hist-panel', class: 'ls-hist-panel', role: 'region', 'aria-labelledby': 'ls-hist-toggle', hidden: !hOpen/);
  assert.match(code, /if \(!LS\.d \|\| LS\.d\.draft\.id !== id\) LS\.historyOpen = false;/, 'a newly opened listing starts collapsed');
});

test('HISTORY: one click opens it, one click closes it; the heading stays', () => {
  const { t, mk } = browser();
  const card = mk('ls-history'); const btn = mk('ls-hist-toggle'); const panel = mk('ls-hist-panel'); panel.hidden = true; btn.attrs['aria-expanded'] = 'false';
  t.lsToggleHistory();
  assert.deepEqual([t.LS.historyOpen, btn.attrs['aria-expanded'], panel.hidden, card.classes.has('open')], [true, 'true', false, true]);
  t.lsToggleHistory();
  assert.deepEqual([t.LS.historyOpen, btn.attrs['aria-expanded'], panel.hidden, card.classes.has('open')], [false, 'false', true, false]);
});

test('HISTORY: the content is unchanged (versions, actions, who, when, changed fields) and it is navy with accessible contrast', () => {
  const block = code.slice(code.indexOf('// History: collapsed'), code.indexOf('return nodes;'));
  assert.match(block, /LS\.d\.history\.map\(\(h\) => lsEl\('li', null, lsEl\('strong', \{ text: 'v' \+ h\.version \+ ' ' \+ h\.action \}\), ' ', h\.by\.split\('@'\)\[0\], ' ', when\(h\.at\), h\.fields\.length/);
  const vars = Object.fromEntries([...readFileSync('styles.css', 'utf8').matchAll(/--([a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  assert.match(css, /\.ls-card-history \{ background: var\(--navy\)/);
  for (const fg of ['on-navy', 'on-navy-mute']) {
    assert.ok(ratio(vars[fg], vars.navy) >= 4.5, `${fg} on navy`);
    assert.ok(ratio(vars[fg], vars['navy-soft']) >= 4.5, `${fg} on the hover colour`);
  }
  assert.ok(ratio('#FFFFFF', vars.navy) >= 7);
  assert.match(css, /\.ls-hist-toggle:focus-visible \{ outline/, 'a visible keyboard focus');
});
