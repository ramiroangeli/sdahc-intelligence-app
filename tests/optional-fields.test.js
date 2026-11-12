// Optional property, SDA, commercial and marketing fields, and the Publisher's approval of the commercial block.
// Synthetic data only. Real SQL (PGlite), the real authorisation path, the real publication payload builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import sharp from 'sharp';
import { draftPhotosRoute, draftPublishRoute, draftRoute, draftVerifyRoute } from '../api/_lib/routes.js';
import { cleanContent } from '../api/_lib/draft-validation.js';
import { APPROVAL_KEY, approvalState, hashOfValues, publicOptional } from '../api/_lib/optional-fields.js';
import { buildPayload } from '../api/_lib/publication.js';
import { changesSincePublished } from '../api/_lib/changes.js';
import { publishedOptional } from '../api/_lib/site.js';
import * as core from '../api/_lib/vendor/listings-core.mjs';
import { ALI_N, EDITOR, ID_7B, PUBLISHER, PUBLISH_ENV, VIEWER, call, database, github, resetCaches, world } from './drafts-harness.js';

const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const NT = { title: 'Established Improved Liveability SDA Investment', description: 'An improved liveability SDA house in Exampleton with three participant places and onsite overnight assistance.', publicAddress: 'Wattle Street, Exampleton NT 0800', pricingMode: 'contact_agent', displayPrice: '', featured: false };
const VIC = { ...NT, publicAddress: 'Wattle Street, Exampleton VIC 3999' };
const INV = { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied', tenure: 'Long term lease to a registered provider', annualIncomeAud: 61000, incomeType: 'gross', yieldPct: 6.1, yieldType: 'gross', basis: 'actual' };
const PUBLISHER_N = { ...PUBLISHER, email: 'steve@sdahomechoices.com.au' };

/** A draft with photographs. `state` is the CRM state of the synthetic property. */
async function ready({ state = 'NT', content = NT } = {}) {
  resetCaches();
  const w = world(); const db = await database(); const gh = github(w);
  w.state.page7B = { ...w.state.page7B, properties: { ...w.state.page7B.properties, 'State/ Territory': { type: 'select', select: { name: state } } } };
  const c = await call(draftRoute, w, db, ALI_N, { method: 'POST', body: { propertyId: ID_7B } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const s = await call(draftRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: c.json.draft.version, content } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const up = (b, kind) => call(draftPhotosRoute, w, db, ALI_N, { method: 'POST', body: b, headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}${kind ? `&kind=${kind}` : ''}` });
  await up(await jpeg(1)); await up(await jpeg(2)); const p3 = await up(await jpeg(3), 'floorplan');
  const ids = p3.json.photos.items.map((p) => p.id);
  const g = await call(draftPhotosRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: p3.json.draft.version, photos: [{ id: ids[0], alt: 'Kitchen', kind: 'photo' }, { id: ids[1], alt: '', kind: 'photo' }, { id: ids[2], alt: '', kind: 'floorplan' }] } });
  assert.equal(g.status, 200);
  return { w, db, gh };
}
const version = async (db) => (await db.unsafe('select version from listings.drafts where public_id = $1', [ID_7B]))[0].version;
const row = async (db) => (await db.unsafe('select * from listings.drafts where public_id = $1', [ID_7B]))[0];
const save = async (c, patch, who = ALI_N, extra = {}) => call(draftRoute, c.w, c.db, who, { method: 'PUT', body: { id: ID_7B, expectedVersion: await version(c.db), content: { ...NT, ...(c.base ?? {}), ...patch }, ...extra } });
const approve = async (c, body = {}, who = PUBLISHER_N) => call(draftVerifyRoute, c.w, c.db, who, { method: 'POST', body: { id: ID_7B, expectedVersion: await version(c.db), investment: 'approve', note: 'Checked against the signed lease.', confirmed: true, ...body } });
const withdraw = async (c, who = PUBLISHER_N) => call(draftVerifyRoute, c.w, c.db, who, { method: 'POST', body: { id: ID_7B, expectedVersion: await version(c.db), investment: 'withdraw', note: 'Withdrawn for review.' } });
const dry = async (c) => call(draftPublishRoute, c.w, c.db, ALI_N, { method: 'POST', fetch: c.gh.fetch, env: PUBLISH_ENV, body: { id: ID_7B, expectedVersion: await version(c.db), mode: 'dry_run' } });
const payloadOf = async (db) => (await db.unsafe('select payload from listings.publish_jobs order by created_at desc limit 1'))[0].payload;

test('cleaning: optional groups are normalised, unknown keys and any client approval or hash are dropped, empty groups are omitted', () => {
  const plain = cleanContent({ title: 'T', description: 'D', publicAddress: 'A', pricingMode: '', displayPrice: '', featured: false });
  assert.deepEqual(Object.keys(plain).sort(), ['description', 'displayPrice', 'featured', 'pricingMode', 'publicAddress', 'title'], 'an existing draft gains no keys');
  const c = cleanContent({
    ...plain, property: { bathrooms: '2', carSpaces: '', junk: 1 }, sdaFacts: { bedrooms: 4, ooa: ' On site ' }, marketing: { agency: 'sdahc' }, extra: { x: 1 },
    investment: { ...INV, approval: { valuesHash: 'f'.repeat(64) }, valuesHash: 'e'.repeat(64), approvedBy: 'someone@example.com' },
  });
  assert.deepEqual(c.property, { bathrooms: 2 });
  assert.deepEqual(c.sdaFacts, { bedrooms: 4, ooa: 'On site' });
  assert.equal(c.extra, undefined);
  assert.deepEqual(Object.keys(c.investment).sort(), Object.keys(INV).sort());
  assert.equal(JSON.stringify(c).includes('someone@example.com'), false);
  assert.equal(JSON.stringify(c).includes('f'.repeat(64)), false);
  assert.equal(cleanContent({ ...plain, property: {}, investment: {} }).property, undefined);
  assert.throws(() => cleanContent({ ...plain, investment: { leaseStatus: 'nope' } }), (e) => e.status === 400 && e.code === 'invalid_content' && /not a valid choice/.test(e.extra.reasons[0]));
  assert.throws(() => cleanContent({ ...plain, property: { bathrooms: 'two' } }), (e) => e.status === 400 && /must be a number/.test(e.extra.reasons[0]));
});

test('values saved by an Editor are stored private: nothing is approved and nothing leaves in the payload', async () => {
  const c = await ready();
  const s = await save(c, { investment: INV, property: { bathrooms: 2 }, marketing: { agency: 'sdahc' } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.optional.approval.state, 'unapproved');
  assert.equal(s.json.preview.investment, 'unapproved');
  const r = await dry(c);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = await payloadOf(c.db);
  assert.deepEqual(p.content.optional.property, { bathrooms: 2 });
  assert.equal(p.content.optional.investment, undefined, 'unapproved commercial values are never frozen into the request');
  assert.equal(JSON.stringify(p).includes('61000'), false);
});

test('a browser cannot supply an approval: forged records, hashes and verification objects in a save are ignored', async () => {
  const c = await ready();
  const forged = { valuesHash: hashOfValues(INV), provider: false, by: 'steve@sdahomechoices.com.au', at: new Date().toISOString() };
  const s = await save(c, { investment: { ...INV, approval: forged, valuesHash: forged.valuesHash } }, ALI_N, { verification: { [APPROVAL_KEY]: forged }, approval: forged });
  assert.equal(s.status, 200);
  assert.equal(s.json.optional.approval.state, 'unapproved');
  const stored = await row(c.db);
  assert.equal(stored.verification[APPROVAL_KEY], undefined);
  assert.equal(JSON.stringify(stored.content).includes(forged.valuesHash), false);
  const p = await payloadOf(c.db).catch(() => null);
  assert.equal(p, null, 'no job has been made');
  assert.equal((await dry(c)).status, 200);
  assert.equal((await payloadOf(c.db)).content.optional?.investment, undefined);
});

test('only a Publisher can approve: Editors and Viewers get 403 and nothing changes', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  const v0 = await version(c.db);
  for (const who of [EDITOR, VIEWER, ALI_N]) {
    if (who === ALI_N && ALI_N.capabilities.includes('listings.publish')) continue;
    assert.equal((await approve(c, {}, who)).status, 403);
    assert.equal((await withdraw(c, who)).status, 403);
  }
  assert.equal(await version(c.db), v0);
  assert.equal((await row(c.db)).verification[APPROVAL_KEY], undefined);
});

test('approval: record content, history and view', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  const r = await call(draftVerifyRoute, c.w, c.db, PUBLISHER_N, { method: 'POST', body: { id: ID_7B, expectedVersion: await version(c.db), investment: 'approve', note: 'Checked against the signed lease.', confirmed: true, valuesHash: '0'.repeat(64), by: 'someone.else@example.com', at: '2001-01-01T00:00:00Z' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rec = (await row(c.db)).verification[APPROVAL_KEY];
  assert.equal(rec.valuesHash, hashOfValues(INV), 'the hash is the server\'s own');
  assert.equal(rec.by, PUBLISHER_N.email, 'the identity is the session\'s');
  assert.notEqual(rec.at, '2001-01-01T00:00:00Z');
  assert.equal(r.json.optional.approval.state, 'approved');
  assert.ok(r.json.history.some((h) => h.action === 'verify'));
});

test('approval needs an explicit confirmation and a note', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  assert.equal((await approve(c, { confirmed: false })).json.error, 'confirmation_required');
  assert.equal((await approve(c, { note: '' })).status, 400);
  assert.equal((await row(c.db)).verification[APPROVAL_KEY], undefined);
});

test('approving with no commercial values is refused', async () => {
  const c = await ready();
  const r = await approve(c);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'nothing_to_approve');
});

test('an approved block is frozen into the request, and the request names nobody', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  assert.equal((await approve(c)).status, 200);
  assert.equal((await dry(c)).status, 200);
  const p = await payloadOf(c.db);
  const inv = p.content.optional.investment;
  assert.equal(inv.annualIncomeAud, 61000);
  assert.equal(inv.approval.valuesHash, hashOfValues(INV));
  assert.deepEqual(Object.keys(inv.approval).sort(), ['valuesHash'], 'no approver identity or time in the public request');
  const text = JSON.stringify(p);
  assert.equal(text.includes('steve@'), false);
  assert.equal(text.includes('Checked against'), false);
  assert.equal(core.investmentApprovalValid(inv), true, 'the website\'s own check accepts it');
});

test('editing an approved value invalidates the approval; restoring the old value does not revive it', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  await approve(c);
  const edited = await save(c, { investment: { ...INV, annualIncomeAud: 62000 } });
  assert.equal(edited.json.optional.approval.state, 'unapproved');
  assert.equal((await row(c.db)).verification[APPROVAL_KEY], undefined, 'the record is removed, not just ignored');
  const back = await save(c, { investment: INV });
  assert.equal(back.json.optional.approval.state, 'unapproved', 'putting the old value back needs a new approval');
  assert.equal((await dry(c)).status, 200);
  assert.equal((await payloadOf(c.db)).content.optional?.investment, undefined);
});

test('editing unrelated fields keeps the approval', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  await approve(c);
  const s = await save(c, { investment: INV, title: 'A different but valid title here', property: { bathrooms: 3 } });
  assert.equal(s.json.optional.approval.state, 'approved');
});

test('a stored value changed outside the save path (no record removal) is still never published: the hash no longer matches', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  await approve(c);
  const r = await row(c.db);
  await c.db.unsafe('update listings.drafts set content = $2::text::jsonb where public_id = $1', [ID_7B, JSON.stringify({ ...r.content, investment: { ...INV, annualIncomeAud: 99000 } })]);
  const d = await row(c.db);
  assert.equal(approvalState(d).state, 'stale');
  assert.equal(publicOptional(d, { state: 'NT', status: 'available' })?.investment, undefined);
});

test('withdrawing the approval removes the record and stops publication of the block', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  await approve(c);
  const w = await withdraw(c);
  assert.equal(w.status, 200);
  assert.equal(w.json.optional.approval.state, 'unapproved');
  assert.equal((await withdraw(c)).json.error, 'nothing_to_withdraw');
});

test('Victoria: income and yield cannot be approved or published, and nothing weakens the pricing compliance check', async () => {
  const c = await ready({ state: 'VIC', content: VIC });
  await save(c, { ...VIC, investment: INV });
  const r = await approve(c);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'victorian_restriction');
  assert.equal((await row(c.db)).verification[APPROVAL_KEY], undefined);
  const d = await row(c.db);
  assert.equal(publicOptional({ ...d, verification: { [APPROVAL_KEY]: { valuesHash: hashOfValues(INV), by: 'x', at: 'y' } } }, { state: 'VIC', status: 'available' })?.investment, undefined, 'even a (forged) matching record cannot publish Victorian figures');
  const open = await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
  assert.ok(open.json.validation.blockers.some((b) => b.code === 'victoria_compliance'), 'the existing Victorian blocker is untouched');
  // lease and occupancy only: allowed on Victorian listings
  await save(c, { ...VIC, investment: { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied' } });
  assert.equal((await approve(c)).status, 200);
});

test('occupancy: fully occupied cannot be approved while the CRM records fewer participants; lease and occupancy stay separate', async () => {
  const c = await ready();
  await save(c, { investment: { leaseStatus: 'fully_leased', occupancyStatus: 'fully_occupied' } });
  const r = await approve(c);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'occupancy_conflict');
  await save(c, { investment: { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied' } });
  assert.equal((await approve(c)).status, 200);
  const inv = (await row(c.db)).content.investment;
  assert.equal(inv.leaseStatus, 'fully_leased');
  assert.equal(inv.occupancyStatus, 'partially_occupied');
});

test('provider arrangement wording needs its own explicit authorisation', async () => {
  const c = await ready();
  await save(c, { investment: { leaseStatus: 'fully_leased', providerArrangement: 'Leased to a registered SDA provider' } });
  const r = await approve(c);
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'provider_authorisation_needed');
  const ok = await approve(c, { providerAuthorised: true });
  assert.equal(ok.status, 200);
  assert.equal((await row(c.db)).verification[APPROVAL_KEY].provider, true);
});

test('a Sold listing never carries the commercial block, and an unreadable status fails closed', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  await approve(c);
  const d = await row(c.db);
  assert.equal(publicOptional(d, { state: 'NT', status: 'sold' })?.investment, undefined);
  assert.ok(publicOptional(d, { state: 'NT', status: 'available' })?.investment);
  const view = { draft: { content: d.content } };
  const mk = (effectiveStatus) => buildPayload({ jobId: 'j', view, draft: { ...d, photos: [] }, kind: 'update', effectiveStatus }).payload.content.optional?.investment;
  assert.equal(mk('sold'), undefined);
  assert.ok(mk('under_offer'));
});

test('a listing with none of the new fields produces the same request as before', async () => {
  const c = await ready();
  assert.equal((await dry(c)).status, 200);
  const p = await payloadOf(c.db);
  assert.equal('optional' in p.content, false);
  assert.deepEqual(Object.keys(p.content).sort(), ['description', 'displayPrice', 'featured', 'pricingMode', 'publicAddress', 'title']);
});

test('invalid descriptive facts block publication; invalid or unapprovable commercial values do not block the rest of the listing', async () => {
  const c = await ready();
  const bad = await save(c, { marketing: { agency: 'unlisted-agency' } });
  assert.equal(bad.status, 200, 'saving is never blocked');
  assert.ok(bad.json.validation.fieldErrors.marketing, 'but the field says why');
  assert.equal(bad.json.validation.complete, false);
  const fixed = await save(c, { marketing: { agency: 'sdahc' }, investment: { yieldPct: 6.1 } });
  assert.deepEqual(fixed.json.validation.fieldErrors, {});
  assert.equal(fixed.json.validation.complete, true, 'a half-filled commercial block only stays private (the CRM occupancy check is the existing, separate blocker)');
  assert.ok(fixed.json.validation.warnings.some((w) => w.field === 'investment'));
  assert.equal((await approve(c)).status, 409);
});

test('save, publish and update keep working: the history records the approval and the value changes in order', async () => {
  const c = await ready();
  await save(c, { investment: INV });
  await approve(c);
  await save(c, { investment: { ...INV, yieldPct: 6.3 } });
  const o = await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
  const actions = o.json.history.map((h) => h.action);
  assert.ok(actions.includes('verify') && actions.includes('update'));
  assert.ok(o.json.history.find((h) => h.fields.includes('verification') && h.action === 'update'), 'the removal of the approval is visible in the history');
  assert.equal((await dry(c)).status, 200);
});

test('the published version: its optional groups are read back, and "changes since live" compares them group by group', () => {
  const content = { property: { bathrooms: 2 }, sda: { bedrooms: 4, ooa: 'On site', designCategories: ['IL'] }, investment: { leaseStatus: 'fully_leased', approval: { valuesHash: 'a'.repeat(64) } }, marketing: { agency: 'sdahc' } };
  const o = publishedOptional(content);
  assert.deepEqual(o, { property: { bathrooms: 2 }, sda: { bedrooms: 4, ooa: 'On site' }, investment: { leaseStatus: 'fully_leased' }, marketing: { agency: 'sdahc' } });
  assert.deepEqual(publishedOptional({}), {});
  const base = { title: 'T', description: ['D'], address: 'A', pricingMode: 'contact_agent', displayPrice: null, featured: false, photos: [], state: 'NT', status: 'available' };
  const draft = { content: { title: 'T', description: 'D', publicAddress: 'A', pricingMode: 'contact_agent', displayPrice: '', featured: false, property: { bathrooms: 3 }, investment: { leaseStatus: 'fully_leased' } }, verification: {}, photos: [] };
  const fields = changesSincePublished(draft, { ...base, optional: o }).items.map((i) => i.field);
  assert.ok(fields.includes('property'));
  assert.ok(fields.includes('investment'), 'an unapproved block would be removed from the website, which is a change');
  assert.ok(fields.includes('sdaFacts') && fields.includes('marketing'));
  const none = changesSincePublished({ ...draft, content: { ...draft.content, property: undefined, investment: undefined } }, base);
  assert.equal(none.items.some((i) => ['property', 'investment', 'sdaFacts', 'marketing'].includes(i.field)), false);
});

test('infrastructure: twelve listing functions and the expected migrations', () => {
  assert.equal(readdirSync('api/listings').filter((f) => f.endsWith('.js')).length, 12);
  assert.deepEqual(readdirSync('supabase/migrations').filter((f) => !f.endsWith('_rollback.sql')).sort(), ['listings_0001_drafts.sql', 'listings_0002_photos.sql', 'listings_0003_photo_review.sql', 'listings_0004_publish_jobs.sql', 'listings_0005_audit_log_and_reinstate.sql', 'listings_0006_publication_acceptance.sql']);
});
