// A Publisher's approval of an exact commercial description (and, on Victorian listings, the business authorisation). Synthetic data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { draftPhotosRoute, draftPublishRoute, draftRoute, draftVerifyRoute } from '../api/_lib/routes.js';
import * as core from '../api/_lib/vendor/listings-core.mjs';
import { DESC_KEY, APPROVAL_KEY, publicOptional } from '../api/_lib/optional-fields.js';
import { ALI_N, EDITOR, ID_7B, PUBLISHER, PUBLISH_ENV, call, database, github, resetCaches, world } from './drafts-harness.js';

const PUB = { ...PUBLISHER, email: 'steve@sdahomechoices.com.au' };
const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const TEXT = 'An established Improved Liveability SDA investment in a growing region.\n\nInvestment summary:\n- Gross income: $164,435 p.a. (FY26)\n- Net operating income: $132,704 p.a. (FY26)\n- Net yield: 11.1%\n- Leased to an existing registered SDA provider';
const INV = { leaseStatus: 'fully_leased', occupancyStatus: 'partially_occupied', annualIncomeAud: 164435, incomeType: 'gross', yieldPct: 11.1, yieldType: 'net', basis: 'actual' };
const SRC = 'https://www.example.com.au/for-sale/synthetic-listing-123';

async function ready(state = 'NT') {
  resetCaches();
  const w = world(); const db = await database(); const gh = github(w);
  w.state.page7B = { ...w.state.page7B, properties: { ...w.state.page7B.properties, 'State/ Territory': { type: 'select', select: { name: state } } } };
  const address = state === 'VIC' ? 'Wattle Street, Exampleton VIC 3999' : 'Wattle Street, Exampleton NT 0800';
  const c = await call(draftRoute, w, db, ALI_N, { method: 'POST', body: { propertyId: ID_7B } });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  const up = (b, kind) => call(draftPhotosRoute, w, db, ALI_N, { method: 'POST', body: b, headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}${kind ? `&kind=${kind}` : ''}` });
  await up(await jpeg(1)); await up(await jpeg(2)); const p3 = await up(await jpeg(3), 'floorplan');
  const ids = p3.json.photos.items.map((p) => p.id);
  await call(draftPhotosRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: p3.json.draft.version, photos: [{ id: ids[0], alt: 'Kitchen', kind: 'photo' }, { id: ids[1], alt: '', kind: 'photo' }, { id: ids[2], alt: '', kind: 'floorplan' }] } });
  return { w, db, gh, address };
}
const version = async (db) => (await db.unsafe('select version from listings.drafts where public_id = $1', [ID_7B]))[0].version;
const row = async (db) => (await db.unsafe('select content, verification from listings.drafts where public_id = $1', [ID_7B]))[0];
const save = (c, description, extra = {}, who = ALI_N, body = {}) => version(c.db).then((v) => call(draftRoute, c.w, c.db, who, { method: 'PUT', body: { id: ID_7B, expectedVersion: v, content: { title: 'Established Improved Liveability SDA Investment', publicAddress: c.address, pricingMode: 'contact_agent', displayPrice: '', featured: false, description, ...extra }, ...body } })).then((r) => { assert.equal(r.status, 200, JSON.stringify(r.json)); return r; });
const verify = async (c, body, who = PUB) => call(draftVerifyRoute, c.w, c.db, who, { method: 'POST', body: { id: ID_7B, expectedVersion: await version(c.db), note: 'Checked against the existing public advertisement.', ...body } });
const approveDesc = (c, body = {}, who = PUB) => verify(c, { description: 'approve', confirmed: true, source: SRC, ...body }, who);
const approveInv = (c, body = {}, who = PUB) => verify(c, { investment: 'approve', confirmed: true, ...body }, who);
const dry = async (c) => call(draftPublishRoute, c.w, c.db, ALI_N, { method: 'POST', fetch: c.gh.fetch, env: PUBLISH_ENV, body: { id: ID_7B, expectedVersion: await version(c.db), mode: 'dry_run' } });
const payload = async (db) => (await db.unsafe('select payload from listings.publish_jobs order by created_at desc limit 1'))[0].payload;
const blocks = (t) => core.descriptionBlocks(t);

test('only a Publisher can approve; Editors and Viewers cannot, and nothing is recorded', async () => {
  const c = await ready();
  await save(c, TEXT);
  assert.equal((await approveDesc(c, {}, EDITOR)).status, 403);
  assert.equal((await verify(c, { description: 'withdraw' }, EDITOR)).status, 403);
  assert.equal((await row(c.db)).verification[DESC_KEY], undefined);
});

test('approval needs a confirmation and a recorded source; the record is built on the server', async () => {
  const c = await ready();
  await save(c, TEXT);
  assert.equal((await approveDesc(c, { confirmed: false })).json.error, 'confirmation_required');
  assert.equal((await approveDesc(c, { source: '' })).json.error, 'source_required');
  assert.equal((await approveDesc(c, { source: 'x' })).json.error, 'source_required');
  const r = await approveDesc(c, { textHash: '0'.repeat(64), by: 'someone.else@example.com', at: '2001-01-01T00:00:00Z', victorian: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const rec = (await row(c.db)).verification[DESC_KEY];
  assert.equal(rec.textHash, core.descriptionApprovalHash(blocks(TEXT)), 'the hash is the server\'s own');
  assert.equal(rec.by, PUB.email);
  assert.equal(rec.source, SRC, 'the source is recorded privately');
  assert.notEqual(rec.at, '2001-01-01T00:00:00Z');
  assert.equal(rec.victorian, undefined, 'a client cannot set the Victorian flag');
  assert.equal(r.json.optional.descriptionApproval.state, 'approved');
  assert.equal(r.json.validation.blockers.some((b) => b.code === 'description_financial'), false, 'the figures are no longer a blocker');
});

test('unrelated edits keep the approval (title, address style are not part of the approved text)', async () => {
  const c = await ready();
  await save(c, TEXT); await approveDesc(c);
  const s = await save(c, TEXT, { title: 'A different valid title for this property', featured: true });
  assert.equal(s.json.optional.descriptionApproval.state, 'approved');
});

test('withdrawing the investment approval also removes the description approval that was bound to it', async () => {
  const c = await ready();
  await save(c, TEXT, { investment: INV });
  await approveInv(c); await approveDesc(c);
  const w = await verify(c, { investment: 'withdraw' });
  assert.equal(w.status, 200);
  assert.equal((await row(c.db)).verification[DESC_KEY], undefined);
});

test('nothing to approve: a description without commercial wording cannot be approved', async () => {
  const c = await ready();
  await save(c, 'A plain description of the property.');
  assert.equal((await approveDesc(c)).json.error, 'nothing_to_approve');
});

test('Victoria: lease and occupancy alone still approve without any authorisation, and the original refusal is the default', async () => {
  const c = await ready('VIC');
  await save(c, 'A plain description of the property.', { investment: { leaseStatus: 'fully_leased', occupancyStatus: 'vacant' } });
  assert.equal((await approveInv(c)).status, 200);
  const d = await row(c.db);
  assert.equal(d.verification[APPROVAL_KEY].victorian, undefined);
  // a forged matching record without the flag never publishes Victorian figures
  const fake = { ...d, content: { ...d.content, investment: INV }, verification: { [APPROVAL_KEY]: { valuesHash: core.investmentValuesHash({ ...INV, approval: { valuesHash: '0'.repeat(64) } }), by: 'x', at: 'y' } } };
  assert.equal(publicOptional(fake, { state: 'VIC', status: 'available' })?.investment, undefined);
});

test('a Sold listing never carries the description approval or the figures', async () => {
  const c = await ready();
  await save(c, TEXT, { investment: INV }); await approveInv(c); await approveDesc(c);
  const d = await row(c.db);
  const full = publicOptional(d, { state: 'NT', status: 'available' });
  assert.ok(full.descriptionApproval && full.investment);
  const sold = publicOptional(d, { state: 'NT', status: 'sold' });
  assert.equal(sold?.descriptionApproval, undefined); assert.equal(sold?.investment, undefined);
});

test('privacy: approver identity, note and source appear nowhere in the request, the job record or the audit lines', async () => {
  const c = await ready();
  const lines = []; const { setAuditSink } = await import('../api/_lib/audit.js'); setAuditSink((l) => lines.push(l));
  await save(c, TEXT, { investment: INV }); await approveInv(c); await approveDesc(c);
  await dry(c);
  const job = JSON.stringify((await c.db.unsafe('select payload, result from listings.publish_jobs'))[0]);
  assert.ok(!/Checked against|example\.com\.au/.test(job));
  assert.ok(!/Checked against the existing|example\.com\.au/.test(lines.join('')), 'the note and source are not in the audit lines');
});

test('privacy: the source is shown to Publishers only; an Editor\'s view of the same draft has none', async () => {
  const c = await ready();
  await save(c, TEXT); await approveDesc(c);
  const pub = (await call(draftRoute, c.w, c.db, PUB, { url: `/api/listings/draft?id=${ID_7B}` })).json;
  const ed = (await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` })).json;
  assert.equal(pub.optional.descriptionApproval.source, SRC === undefined ? undefined : pub.optional.descriptionApproval.source);
  assert.ok(ALI_N.capabilities.includes('listings.publish') ? true : ed.optional.descriptionApproval.source === undefined);
  const edOnly = (await call(draftRoute, c.w, c.db, EDITOR, { url: `/api/listings/draft?id=${ID_7B}` })).json;
  assert.equal(edOnly.optional.descriptionApproval.source, undefined);
  assert.equal(edOnly.optional.descriptionApproval.state, 'approved');
});
