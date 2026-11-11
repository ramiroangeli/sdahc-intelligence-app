// The three approved simplifications: (1) the Listings Manager is the authority for public content and approval, Notion only prefills;
// (2) no mandatory gallery review (the automatic checks remain); (3) plain-language advertising sign-off instead of technical per-listing compliance text,
// with the underlying requirement still enforced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import { parseStaff } from '../api/_lib/config.js';
import { plainBlocker } from '../api/_lib/publication.js';
import { draftPhotosRoute, draftPublishRoute, draftRoute } from '../api/_lib/routes.js';
import { ALI, ALI_N, COMPLIANCE, ID_7B, ID_RG, PUBLISH_ENV, VIEWER, call, database, github, page7B, resetCaches, staff, world } from './drafts-harness.js';

const GOOD = { title: 'Established Improved Liveability SDA Investment', description: 'An improved liveability SDA house in Exampleton with three participant places and onsite overnight assistance.', publicAddress: 'Wattle Street, Exampleton VIC 3999', pricingMode: 'contact_agent', displayPrice: '', featured: false };
const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
async function ready(who = ALI_N) {
  resetCaches();
  const w = world(); const db = await database(); const gh = github(w);
  const c = await call(draftRoute, w, db, who, { method: 'POST', body: { propertyId: ID_7B } });
  const s = await call(draftRoute, w, db, who, { method: 'PUT', body: { id: ID_7B, expectedVersion: c.json.draft.version, content: GOOD } });
  const up = await call(draftPhotosRoute, w, db, who, { method: 'POST', body: await jpeg(1), headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}` });
  assert.equal(up.status, 200);
  return { w, db, gh, who };
}
const open = (c, who = VIEWER) => call(draftRoute, c.w, c.db, who, { url: `/api/listings/draft?id=${ID_7B}` });
const dry = async (c, who = c.who) => { const v = (await open(c, who)).json.draft.version; return call(draftPublishRoute, c.w, c.db, who, { method: 'POST', fetch: c.gh.fetch, env: PUBLISH_ENV, body: { id: ID_7B, expectedVersion: v, mode: 'dry_run' } }); };
const payloadOf = async (c) => (await c.db.unsafe('select payload from listings.publish_jobs order by created_at desc limit 1'))[0].payload;

/* ---------- 1. the Listings Manager is the authority ---------- */
test('AUTHORITY: the approval travels with the payload as the Listings Manager approval; the public approver is one constant identity, nobody is named', async () => {
  const c = await ready(staff('ali@sdahomechoices.com.au', ['listings.view', 'listings.edit', 'listings.publish']));
  assert.equal((await dry(c)).status, 200, 'a Publisher without a Notion user id can approve: no Notion setup is needed');
  const p = await payloadOf(c);
  assert.equal(p.authority, 'listings_manager');
  assert.equal(p.approver.id, 'listings-manager'); assert.equal(p.approver.name, 'SDA Home Choices'); assert.equal(p.approver.notionUserId, null);
  assert.ok(!JSON.stringify(p).includes('@') && !JSON.stringify(p).includes('app-'), 'no email and no per-person identifier anywhere in the payload');
  assert.equal(p.approval.by, 'listings_manager');
});

test('AUTHORITY: a configured display name is accepted but never made public; every person gets the same constant approver; bad names are still refused at configuration', async () => {
  const c = await ready({ ...ALI, displayName: 'Ali Example', notionUserId: null });
  await dry(c);
  const p = await payloadOf(c);
  assert.equal(p.approver.name, 'SDA Home Choices', 'a person\'s name is never sent to the public website');
  assert.ok(!JSON.stringify(p).includes('Ali Example'));
  const c2 = await ready({ ...ALI, email: 'someone.else@sdahomechoices.com.au', displayName: 'Someone Else', notionUserId: null });
  await dry(c2);
  assert.equal((await payloadOf(c2)).approver.id, p.approver.id, 'two different people produce the same approver identity');
  for (const bad of ['ali@sdahomechoices.com.au', '<b>x</b>', 'x'.repeat(61), 5]) assert.throws(() => parseStaff(JSON.stringify([{ email: 'a@b.co', capabilities: ['listings.view'], displayName: bad }])), /displayName/);
  assert.equal(parseStaff(JSON.stringify([{ email: 'a@b.co', capabilities: ['listings.view'], displayName: 'Ali Example' }]))[0].displayName, 'Ali Example');
});

test('AUTHORITY: no preflight or warning asks for a Notion user id or an approvers list any more', async () => {
  const c = await ready(ALI);
  const r = await dry(c);
  assert.equal(r.status, 200);
  assert.ok(!r.json.wouldBlock.some((m) => /Notion user id|approver/i.test(m)), JSON.stringify(r.json.wouldBlock));
});

test('AUTHORITY: Notion only prefills. Edits to the Notion Web fields are not a conflict, and nothing is ever written to Notion', async () => {
  const c = await ready();
  c.w.state.page7B = page7B({ 'Web Title': { type: 'rich_text', rich_text: [{ plain_text: 'Someone typed this in Notion' }] }, 'Web Description': { type: 'rich_text', rich_text: [{ plain_text: 'And this' }] } }); resetCaches();
  const v = await open(c);
  assert.deepEqual(v.json.notion.changed, [], 'the Web fields in Notion are not tracked');
  assert.equal(v.json.draft.content.title, GOOD.title, 'the draft keeps the Listings Manager text');
  assert.equal((await dry(c)).status, 200, 'and a Notion edit of the Web fields does not stop publication');
  assert.ok(c.w.calls.every((x) => x.method === 'GET' || /\/query|\/dispatches/.test(x.url)), 'no Notion write');
  // CRM facts that matter still raise the existing conflict
  c.w.state.page7B = page7B({ 'Gross income': { type: 'number', number: 150000 } }); resetCaches();
  assert.deepEqual((await open(c)).json.notion.changed, ['commercial']);
});

/* ---------- 2. no mandatory gallery review ---------- */
test('NO REVIEW: a dry run needs no gallery review and its payload marks photographs approved with the listing; the automatic checks still stop a bad description', async () => {
  const c = await ready();
  const r = await dry(c);
  assert.equal(r.status, 200); assert.ok(!JSON.stringify(r.json).includes('review the whole gallery'));
  const p = await payloadOf(c);
  assert.ok(p.manifest.photos.length === 1 && p.manifest.photos.every((x) => x.privacyReviewed === true));
  // a typed description with a house number blocks (automatic check) even though there is no review
  const c2 = await ready();
  const v = (await open(c2)).json; const id = v.photos.items[0].id;
  await call(draftPhotosRoute, c2.w, c2.db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: v.draft.version, photos: [{ id, alt: 'The house at 7B Wattle Street from the road', kind: 'photo' }] } });
  const bad = await dry(c2);
  assert.equal(bad.status, 409); assert.ok(bad.json.reasons.some((m) => /photo descriptions/i.test(m)));
});

test('NO REVIEW: the browser has no review button, dialog or checklist item, and the server has no review endpoint or state', () => {
  const code = readFileSync('listings.js', 'utf8'); const routes = readFileSync('api/_lib/routes.js', 'utf8'); const photos = readFileSync('api/_lib/photos.js', 'utf8');
  assert.ok(!/reviewBar|lsOpenReview|lsConfirmReview|ls-review-modal|draft-gallery-review|Gallery reviewed|Review gallery/.test(code));
  assert.ok(!/draftGalleryReviewRoute|reviewGallery/.test(routes + photos));
  assert.ok(!/reviewState|photo_review/.test(readFileSync('api/_lib/draft-service.js', 'utf8') + readFileSync('api/_lib/publication.js', 'utf8')));
});

/* ---------- 3. plain-language advertising sign-off, requirement preserved ---------- */
test('ADVERTISING: the staff wording is plain (no internal document names, no "determination", no "compliance")', async () => {
  const c = await ready();
  const v = (await open(c)).json;
  const b = v.validation.blockers.find((x) => x.code === 'victoria_compliance');
  assert.ok(b, 'the requirement is still detected for a Victorian listing with no recorded position');
  assert.match(b.message, /^Advertising sign-off needed/);
  for (const technical of [/docs\//i, /\.md\b/, /determination/i, /compliance/i, /Victorian pricing/i, /contact_agent/]) assert.ok(!technical.test(b.message), `technical wording: ${technical}`);
  const r = await dry(c);
  assert.ok(r.json.wouldBlock.some((m) => /^Advertising sign-off needed/.test(m)));
  for (const m of r.json.wouldBlock) assert.ok(!/docs\/|determination|compliance|contact_agent/i.test(m), m);
  assert.equal(plainBlocker({ code: 'basic_classification', message: 'Design Category Basic: ...' }).startsWith('Needs confirmation'), true);
  assert.equal(plainBlocker({ code: 'other', message: 'unchanged' }), 'unchanged');
});

test('ADVERTISING: the requirement is still ENFORCED: a Victorian listing is not publishable until a position is recorded; a standing record clears it for that pricing mode only', async () => {
  const c = await ready();
  assert.equal((await open(c)).json.validation.publishable, false);
  const standing = (over = {}) => ({ ...COMPLIANCE, victoria: { ...COMPLIANCE.victoria, determinations: [{ listingId: '*', pricingMode: 'contact_agent', basis: 'internal_determination', recordedBy: 'Owner', recordedAt: '2026-11-09', reference: 'https://example.test/r', statement: 'Standing position recorded for the test.', ...over }] } });
  c.w.state.compliance = standing(); resetCaches();
  const cleared = (await open(c)).json.validation;
  assert.ok(!cleared.blockers.some((b) => b.code === 'victoria_compliance'), 'a standing record clears Contact Agent for this listing');
  c.w.state.compliance = standing({ pricingMode: 'asking_price' }); resetCaches();
  assert.ok((await open(c)).json.validation.blockers.some((b) => b.code === 'victoria_compliance'), 'it does not clear another pricing mode');
  c.w.state.compliance = standing({ statement: '' }); resetCaches();
  assert.ok((await open(c)).json.validation.blockers.some((b) => b.code === 'victoria_compliance'), 'an incomplete record clears nothing');
  c.w.state.compliance = undefined; resetCaches();
  // another state is untouched by a Victorian requirement (a listing outside Victoria never sees this wording)
  assert.ok(!JSON.stringify(plainBlocker({ code: 'content', message: 'x' })).includes('Advertising'));
});

test('ADVERTISING: the browser shows one plain "Advertising sign-off" line, never the engine\'s technical wording', () => {
  const code = readFileSync('listings.js', 'utf8');
  assert.match(code, /\['Advertising sign-off', /);
  assert.match(code, /id: 'ls-signoff'/);
  assert.ok(!/Compliance cleared|Needs a decision outside this screen|victorian-pricing-compliance|Victorian pricing compliance is not cleared/.test(code.replace(/\/Victorian pricing compliance\/i/g, '')));
  // the job's engine issues are translated before staff see them
  const ctx = { window: { addEventListener() {} , __lsPhotoTimings: [] }, document: { getElementById: () => null, createElement: () => ({}), body: { append() {} }, querySelectorAll: () => [], querySelector: () => null }, console, URL, performance, setTimeout, clearTimeout };
  vm.createContext(ctx); vm.runInContext(`${code}\n;globalThis.__p = plainIssue;`, ctx);
  assert.match(ctx.__p('Victorian pricing compliance is not cleared for "contact_agent" (docs/victorian-pricing-compliance.md)'), /^Advertising sign-off needed/);
  assert.ok(!/docs\/|contact_agent/.test(ctx.__p('Victorian pricing compliance is not cleared for "contact_agent" (docs/victorian-pricing-compliance.md)')));
  assert.equal(ctx.__p('The house number appears'), 'The house number appears');
});

test('Rutherford Grove is untouched by any of this: still Published, live and not offered for a draft', async () => {
  const c = await ready();
  const { listRoute } = await import('../api/_lib/routes.js');
  const l = (await call(listRoute, c.w, c.db, VIEWER, { env: PUBLISH_ENV })).json.listings.find((x) => x.id === ID_RG);
  assert.equal(l.deployment.state, 'live'); assert.equal(l.website.version, 1); assert.equal(l.draft, undefined);
});
