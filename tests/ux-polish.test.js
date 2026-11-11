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
  assert.match(code, /text: 'Image description \(accessibility\)'/);
  assert.match(code, /placeholder: 'e\.g\. Open kitchen with a stone island bench'/);
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
  assert.match(code, /LS\.historyOpen = false; LS\.jobs = null;/, 'a newly opened listing starts collapsed');
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

/* ---------- UX PR 1: plain vocabulary, two separate statuses, a header that tells the truth ---------- */
function uxBrowser() {
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;globalThis.__x = { PUBLICATION_LABEL, COMMERCIAL_LABEL, lsListingName, LS };`, ctx);
  return ctx.__x;
}

test('VOCABULARY: publication state and selling status are separate sets (a listing can be Live and Under offer), in plain words', () => {
  const x = uxBrowser();
  assert.deepEqual(Object.values(JSON.parse(JSON.stringify(x.PUBLICATION_LABEL))), ['Draft', 'Ready for review', 'Publishing', 'Unable to verify website status', 'Live', 'Live, changes not published', 'Withdrawn']);
  assert.deepEqual(Object.values(JSON.parse(JSON.stringify(x.COMMERCIAL_LABEL))), ['Available', 'Under offer', 'Sold']);
  assert.ok(!Object.values(x.PUBLICATION_LABEL).some((l) => /offer|sold|available/i.test(l)), 'publication states never contain a selling status');
  assert.ok(!Object.values(x.COMMERCIAL_LABEL).some((l) => /live|draft|withdrawn/i.test(l)), 'selling statuses never contain a publication state');
});

test('VOCABULARY: no "Web ..." field labels, no Notion-first sentences and no "Add next listing"; the CRM is named as reference data', () => {
  for (const bad of ['Web title', 'Web description', 'Web public address', 'Web pricing mode', 'Display price (AUD)', 'Web featured', 'Add next listing', 'Notion holds the commercial decision', 'Property facts (read only, from Notion)', 'private, not on the website']) assert.ok(!code.includes(bad), `still says "${bad}"`);
  for (const good of ["'Title'", "'Description'", "'Address shown on the website'", "'Price shown as'", "'Price shown (AUD)'", "text: 'Add listing'", "text: 'From the CRM'", 'reference only, never published', 'Changes you save here are not public until you publish']) assert.ok(code.includes(good), `missing "${good}"`);
});

test('HEADER: the listing is named by the address visitors see; the CRM address (with its house number) is a reference line', () => {
  const x = uxBrowser();
  x.LS.d = { draft: { content: { publicAddress: ' Rutherford Grove, Armstrong Creek VIC 3217 ' }, label: 'Rutherford Grove' }, property: { suggestedPublicAddress: 'Suggested Street, Town VIC 3000', fullName: '3/19 Rutherford Grove, Armstrong Creek VIC 3217' } };
  assert.equal(x.lsListingName(), 'Rutherford Grove, Armstrong Creek VIC 3217');
  x.LS.d.draft.content.publicAddress = '';
  assert.equal(x.lsListingName(), 'Suggested Street, Town VIC 3000', 'until a public address is written the suggestion (house number already removed) is used');
  x.LS.d.property.suggestedPublicAddress = '';
  assert.equal(x.lsListingName(), 'Rutherford Grove');
  assert.ok(!/lsEl\('h2', \{ class: 'panel-title', text: LS\.d\.property\.fullName/.test(code), 'the internal address is never the page title');
});

/* ---------- UX PR 2: the three-step flow, friendly progress, administrators-only technical details ---------- */
function flowBrowser() {
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;globalThis.__f = { friendlyProgress, friendlyFailure, lsIsAdmin, LS };`, ctx);
  return ctx.__f;
}
const J = (over) => JSON.parse(JSON.stringify(over));
const st = (step, status = 'ok') => ({ step, status });

test('PROGRESS: four friendly stages, one active at a time, a failure lands on the stage where it happened, and no technical word is shown', () => {
  const f = flowBrowser();
  const states = (j) => J(f.friendlyProgress(j)).map((x) => x.state).join();
  assert.equal(states({ kind: 'update', active: true, steps: [st('requested'), st('dispatched')] }), 'active,pending,pending,pending');
  assert.equal(states({ kind: 'update', active: true, steps: [st('requested'), st('build'), st('media'), st('pull_request')] }), 'done,done,active,pending');
  assert.equal(states({ kind: 'update', active: false, status: 'failed', steps: [st('build'), st('media'), st('pull_request'), st('checks', 'failed')] }), 'done,done,failed,pending');
  assert.equal(states({ kind: 'update', active: false, status: 'succeeded', steps: [] }), 'done,done,done,done');
  assert.equal(states({ kind: 'update', active: false, status: 'failed', steps: [st('build', 'failed')] }), 'failed,pending,pending,pending');
  const labels = J(f.friendlyProgress({ kind: 'update', steps: [] })).map((x) => x.label).join(' | ');
  assert.equal(labels, 'Checking your listing | Preparing the photos | Publishing to the website | Confirming it is live');
  assert.ok(!/GitHub|pull request|merge|deploy|engine|build|workflow|job|dry/i.test(labels));
  assert.equal(J(f.friendlyProgress({ kind: 'withdraw', active: true, steps: [st('build')] })).map((x) => x.label + ':' + x.state).join(' | '), 'Checking the listing:done | Removing it from the website:active | Confirming it is gone:pending');
});

test('RECOVERY: a failure is one sentence plus what to do: after a merge "check again, nothing is redone", before it "nothing was changed"', () => {
  const f = flowBrowser();
  const before = J(f.friendlyFailure({ kind: 'update', error: { code: 'checks_failed' }, result: null }));
  assert.match(before.what, /did not pass/); assert.match(before.todo, /Nothing was changed: the live page is exactly as it was/);
  const after = J(f.friendlyFailure({ kind: 'update', error: { code: 'verify_failed' }, result: { merged: true } }));
  assert.match(after.todo, /Press the button again to check it: nothing is redone/);
  assert.match(J(f.friendlyFailure({ kind: 'withdraw', error: { code: 'verify_failed' }, result: { merged: true } })).todo, /Re-check withdrawal/);
  for (const t of [before.what, before.todo, after.what, after.todo]) assert.ok(!/GitHub|pull request|workflow|engine|code:/i.test(t), t);
});

test('ADMIN ONLY: the technical timeline, the test run and the job list exist only inside the administrator block; staff see none of them', () => {
  const f = flowBrowser();
  f.LS.me = { capabilities: ['listings.view', 'listings.edit', 'listings.publish'] };
  assert.equal(f.lsIsAdmin(), false);
  f.LS.me = { capabilities: ['listings.view', 'listings.admin'] };
  assert.equal(f.lsIsAdmin(), true);
  f.LS.me = null; assert.equal(f.lsIsAdmin(), false);
  const fn = code.slice(code.indexOf('function reviewContent()'), code.indexOf("/* The website engine's own wording"));
  const gate = fn.indexOf('lsIsAdmin() ? lsEl(');
  assert.ok(gate > 0, 'there is an administrator block');
  const staff = fn.slice(0, gate);
  for (const technical of ['jobTimeline(', 'lsStartDryRun', 'Earlier jobs', 'Technical details', 'Test without publishing']) assert.ok(!staff.includes(technical), `${technical} is visible to staff`);
  const admin = fn.slice(gate);
  for (const technical of ['jobTimeline(', 'lsStartDryRun', 'Earlier jobs', 'Technical details', 'Test without publishing']) assert.ok(admin.includes(technical), `${technical} missing for administrators`);
  assert.ok(!/GitHub|pull request|engine|workflow|deployment/i.test(staff.replace(/\/\*[^]*?\*\//g, '')), 'no technical vocabulary in what staff see');
});

test('FLOW: three steps (Prepare, Preview and check, Publish) with ONE primary action each; one confirmation; no duplicate review tab', () => {
  assert.match(code, /\['edit', 'Prepare'/); assert.match(code, /\['preview', 'Preview and check'/); assert.match(code, /\['review', 'Publish'/);
  assert.ok(!/ls-tabs|Private preview'|text: 'Review & publish'/.test(code), 'the three tabs are gone');
  const footer = code.slice(code.indexOf('function lsStepFooter'), code.indexOf('function paintDraft'));
  assert.equal((footer.match(/btn btn-primary/g) || []).length, 2, 'Prepare and Preview each end in one primary button; Publish has its own');
  const pub = code.slice(code.indexOf('function reviewContent()'), code.indexOf("/* The website engine's own wording"));
  assert.equal((pub.match(/class: 'btn btn-primary'/g) || []).length, 1, 'the Publish step has exactly one primary button');
  assert.match(pub, /Publish to website/); assert.match(pub, /Publish changes/); assert.ok(!/Yes, publish|Approve and publish|Publish update/.test(pub));
});

/* ---------- UX PR 4: Manage, with publication state and selling status kept apart ---------- */
function manageBrowser() {
  const ctx = { window: { addEventListener() {}, __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;globalThis.__m = { lsPublicationState, lsHistory, PUBLICATION_LABEL, COMMERCIAL_LABEL };`, ctx);
  return ctx.__m;
}

test('TWO STATUSES: a listing is Live AND Under offer; the publication state and the selling status never collapse into one', () => {
  const m = manageBrowser();
  const live = { live: { kind: 'update' }, publishedOnWebsite: true, websiteStatus: 'under_offer', changes: { count: 0, items: [] }, active: null, withdrawn: false };
  assert.equal(m.lsPublicationState(live, { publishable: true }), 'live', 'publication state says Live whatever the selling status is');
  assert.equal(live.websiteStatus, 'under_offer', 'and the selling status is separate data');
  assert.equal(m.lsPublicationState({ ...live, changes: { count: 2, items: [] } }, {}), 'live_changes');
  assert.equal(m.lsPublicationState({ ...live, active: { kind: 'update' } }, {}), 'publishing');
  assert.equal(m.lsPublicationState({ ...live, withdrawn: true }, {}), 'withdrawn');
  assert.equal(m.lsPublicationState({ live: null, publishedOnWebsite: false, active: null }, { publishable: true }), 'review');
  assert.equal(m.lsPublicationState(null, { publishable: false }), 'draft');
  assert.equal(m.lsPublicationState({ live: null, publishedOnWebsite: true, changes: null, active: null }, {}), 'live', 'an unreadable comparison is never reported as changes');
  const manage = code.slice(code.indexOf('function manageContent()'), code.indexOf("/* ---- the Publish step"));
  assert.match(manage, /publicationBadge\(state\)/); assert.match(manage, /commercialBadge\(cur\)/);
});

test('MANAGE: history is plain words (jobs for everyone, who changed the status only for Publishers); dry runs and running jobs are not history', () => {
  const m = manageBrowser();
  const jobs = {
    jobs: [
      { kind: 'update', status: 'succeeded', finishedAt: '2026-11-10T10:23:00Z', requestedBy: 'ramiro@x.com', active: false },
      { kind: 'dry_run', status: 'succeeded', finishedAt: '2026-11-10T10:20:00Z', requestedBy: 'ramiro@x.com', active: false },
      { kind: 'update', status: 'failed', finishedAt: '2026-11-09T10:00:00Z', requestedBy: 'ali@x.com', active: false },
      { kind: 'update', status: 'running', createdAt: '2026-11-11T01:00:00Z', requestedBy: 'ali@x.com', active: true },
    ],
    audit: [{ action: 'status_change', at: '2026-11-10T11:00:00Z', by: 'ali@x.com', from: 'available', to: 'under_offer' }, { action: 'withdraw', at: '2026-11-10T12:00:00Z', by: 'ali@x.com', reason: 'PRIVATE' }],
  };
  const h = J(m.lsHistory(jobs, [{ at: '2026-11-08T09:00:00Z', by: 'ramiro@x.com', fields: ['importedFromPublished', 'photos'] }]));
  assert.deepEqual(h.map((x) => x.text), ['Status changed from Available to Under offer', 'Published changes', 'Publishing changes did not complete', 'Brought in from the live website']);
  assert.deepEqual(h.map((x) => x.by), ['ali', 'ramiro', 'ali', 'ramiro'], 'a first name only, never an email address');
  assert.ok(!JSON.stringify(h).includes('PRIVATE') && !JSON.stringify(h).includes('@'), 'no private reason and no email reaches the history');
  assert.equal(h[2].bad, true);
  const noAudit = J(m.lsHistory({ jobs: jobs.jobs }, []));
  assert.ok(!noAudit.some((x) => /Status changed/.test(x.text)), 'without the private trail (Viewers, Editors) no status history appears');
  assert.ok(!/GitHub|pull request|workflow|deployment|engine/i.test(JSON.stringify(h)));
});

test('MANAGE: selling status, edit, history and Withdraw live here; the Publish step no longer carries status or withdrawal; Manage is the fourth step', () => {
  const publishFn = code.slice(code.indexOf('function reviewContent()'), code.indexOf("/* The website engine's own wording"));
  assert.ok(!/statusRow\(|withdrawCard\(|lsStatusChange\(\)/.test(publishFn), 'status and withdrawal are not on the Publish step');
  const manage = code.slice(code.indexOf('function manageContent()'), code.indexOf("/* ---- the Publish step"));
  for (const part of ['Selling status', 'Edit this listing', 'History', 'withdrawCard(ro, active)', "id: 'ls-edit-btn'", 'Update status to ']) assert.ok(manage.includes(part), `Manage is missing ${part}`);
  assert.equal((manage.match(/btn btn-primary/g) || []).length, 1, 'one primary button on Manage (Edit details); the status update is secondary');
  assert.match(code, /\['manage', 'Manage', published \?/);
  assert.match(manage, /will be published together with this status/, 'a status change says that saved changes go with it');
});
