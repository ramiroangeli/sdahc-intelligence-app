// The Publisher's declaration on the REAL publication route: Prepare, Preview, tick the responsibility checkbox, Publish.
// Synthetic listing, real SQL (PGlite running migrations 0001 to 0006 locally), the real authorisation path, the real draft-publish route and the real signed
// payload route. Nothing here reaches GitHub, Notion, Blob or any real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { draftPhotosRoute, draftPublishRoute, draftRoute, publishPayloadRoute, publishCallbackRoute } from '../api/_lib/routes.js';
import { reviewedContentHash } from '../api/_lib/publication-acceptance.js';
import { ALI_N, EDITOR, ID_7B, PUBLISH_ENV, SECRET, SECRETS, VIEWER, call, callSigned, database, github, resetCaches, world } from './drafts-harness.js';
import * as core from '../api/_lib/vendor/listings-core.mjs';
import { reviewedSdaFor } from '../api/_lib/draft-service.js';

const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const BASE = { title: 'Established Improved Liveability SDA Investment', description: 'An improved liveability SDA house in Exampleton with three participant places and onsite overnight assistance.', publicAddress: 'Wattle Street, Exampleton VIC 3999', pricingMode: 'contact_agent', displayPrice: '', featured: false };
const FIN_TEXT = 'An established SDA investment.\n\nInvestment summary:\n- Gross income: $61,000 p.a.\n- Net yield: 6.1%\n- Leased to a registered SDA provider';
const INV = { leaseStatus: 'partially_leased', occupancyStatus: 'partially_occupied', tenure: 'Long term lease to a registered provider', annualIncomeAud: 61000, incomeType: 'gross', yieldPct: 6.1, yieldType: 'gross', basis: 'actual' };
const WORDING = 'I confirm that I am authorised to publish this listing, have reviewed the information, and accept responsibility for its accuracy, authorisation and compliance with applicable requirements.';

async function ready(content = BASE) {
  resetCaches();
  const w = world(); const db = await database(); const gh = github(w);
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
const save = async (c, patch, who = ALI_N) => call(draftRoute, c.w, c.db, who, { method: 'PUT', body: { id: ID_7B, expectedVersion: await version(c.db), content: { ...BASE, ...patch } } });
const route = (c, who, opts) => call(draftPublishRoute, c.w, c.db, who, { fetch: c.gh.fetch, env: PUBLISH_ENV, ...opts });
const preview = async (c, who = ALI_N, kind = 'publish', v) => route(c, who, { url: `/api/listings/draft-publish?id=${ID_7B}&version=${v ?? await version(c.db)}&preview=${kind}` });
const publish = async (c, body = {}, who = ALI_N) => route(c, who, { method: 'POST', body: { id: ID_7B, expectedVersion: await version(c.db), mode: 'publish', ...body } });
const counts = async (c) => ({ jobs: (await c.db.unsafe('select count(*)::int n from listings.publish_jobs'))[0].n, audit: (await c.db.unsafe("select count(*)::int n from listings.audit_log where action = 'publication_acceptance'"))[0].n, dispatches: c.gh.dispatches.length });
const signedPayload = (c, jobId) => callSigned(publishPayloadRoute, c.db, { url: `/api/listings/publish-payload?job=${jobId}`, secret: SECRET });

test('FULL SEQUENCE: Save, Preview, Checkbox, Publish route, Audit and Job, Signed payload, Publication result', async () => {
  const c = await ready();
  // Save is done (ready). Preview: the server prepares the exact content and returns its hash; nothing is recorded.
  const pv = await preview(c);
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  assert.match(pv.json.preview.reviewedHash, /^[a-f0-9]{64}$/); assert.equal(pv.json.preview.declarationRequired, true);
  assert.deepEqual(await counts(c), { jobs: 0, audit: 0, dispatches: 0 });
  // Checkbox ticked, Publish
  const r = await publish(c, { declarationAccepted: true, reviewedHash: pv.json.preview.reviewedHash });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.job.status, 'dispatched'); assert.equal(c.gh.dispatches.length, 1);
  // Audit + Job, written together, by the verified session
  const [job] = await c.db.unsafe('select * from listings.publish_jobs');
  const [audit] = await c.db.unsafe("select * from listings.audit_log where action = 'publication_acceptance'");
  assert.equal(audit.job_id, job.id); assert.equal(audit.draft_version, job.draft_version); assert.equal(audit.actor_email, 'ali@sdahomechoices.com.au'); assert.ok(audit.actor_auth_user);
  assert.equal(audit.detail.accepted, true); assert.equal(audit.detail.content_hash, pv.json.preview.reviewedHash); assert.equal(job.payload_hash, pv.json.preview.reviewedHash);
  // Signed payload: what the website engine receives
  const p = await signedPayload(c, job.id);
  assert.equal(p.status, 200); assert.equal(p.json.version, 2); assert.equal(p.json.mode, 'publish');
  assert.deepEqual(p.json.declaration, { accepted: true, termsVersion: 'internal-draft-v1', draftVersion: job.draft_version, contentHash: pv.json.preview.reviewedHash });
  assert.ok(p.json.reviewedSda && typeof p.json.reviewedSda === 'object');
  assert.equal(reviewedContentHash(p.json, { publicId: ID_7B, draftVersion: job.draft_version }), p.json.declaration.contentHash, 'the website can recompute the same hash from what it received');
  assert.ok(!p.raw.includes('ali@') && !p.raw.includes('@'), 'the payload names nobody');
  // Publication result reported back by the website engine
  for (const step of ['started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'media', 'pull_request', 'checks', 'merge', 'deploy', 'verify']) {
    assert.equal((await callSigned(publishCallbackRoute, c.db, { method: 'POST', url: '/api/listings/publish-callback', body: JSON.stringify({ jobId: job.id, step, status: 'ok' }), secret: SECRET })).status, 200);
  }
  const fin = await callSigned(publishCallbackRoute, c.db, { method: 'POST', url: '/api/listings/publish-callback', body: JSON.stringify({ jobId: job.id, step: 'finished', status: 'succeeded', detail: { dryRun: false, live: true, slug: 'wattle-street-exampleton-vic', kind: 'publish', version: 1, url: 'https://sdahomechoices.com.au/opportunities/wattle-street-exampleton-vic/', photos: 3 } }), secret: SECRET });
  assert.equal(fin.status, 200);
  assert.equal((await c.db.unsafe('select status from listings.publish_jobs'))[0].status, 'succeeded');
  assert.equal((await signedPayload(c, job.id)).status, 410, 'a finished job no longer serves its payload');
});

test('CHECKBOX NOT ACCEPTED: absent, false, a string, a number or an object never publishes; nothing is recorded or dispatched', async () => {
  const c = await ready();
  const { reviewedHash } = (await preview(c)).json.preview;
  for (const declarationAccepted of [undefined, false, 'true', 1, 'yes', {}, [true], null]) {
    const r = await publish(c, { declarationAccepted, reviewedHash });
    assert.equal(r.status, 400, JSON.stringify(declarationAccepted)); assert.equal(r.json.error, 'declaration_required');
  }
  assert.deepEqual(await counts(c), { jobs: 0, audit: 0, dispatches: 0 });
});

test('EDITOR WITHOUT PUBLISHER PERMISSION: cannot preview or publish, even with a valid hash taken from a Publisher', async () => {
  const c = await ready();
  const { reviewedHash } = (await preview(c)).json.preview;
  for (const who of [EDITOR, VIEWER]) {
    assert.equal((await preview(c, who)).status, 403);
    assert.equal((await publish(c, { declarationAccepted: true, reviewedHash }, who)).status, 403);
  }
  assert.equal((await route(c, ALI_N, { method: 'POST', headers: { authorization: '' }, body: { id: ID_7B, mode: 'publish', declarationAccepted: true, reviewedHash } })).status, 401);
  assert.deepEqual(await counts(c), { jobs: 0, audit: 0, dispatches: 0 });
});

test('STALE CONTENT: a draft saved after the preview, or a hash from another version, is refused and nothing is recorded', async () => {
  const c = await ready();
  const v1 = await version(c.db);
  const { reviewedHash } = (await preview(c)).json.preview;
  await save(c, { title: 'Established Improved Liveability SDA Investment, edited' });
  const stale = await publish(c, { expectedVersion: v1, declarationAccepted: true, reviewedHash });
  assert.equal(stale.status, 409); assert.equal(stale.json.error, 'draft_changed');
  const old = await publish(c, { declarationAccepted: true, reviewedHash });
  assert.equal(old.status, 409); assert.equal(old.json.error, 'preview_changed');
  assert.deepEqual(await counts(c), { jobs: 0, audit: 0, dispatches: 0 });
  const fresh = (await preview(c)).json.preview.reviewedHash;
  assert.notEqual(fresh, reviewedHash);
  assert.equal((await publish(c, { declarationAccepted: true, reviewedHash: fresh })).status, 200);
});

test('FORGED ACCEPTANCE: a made-up hash, client-supplied acceptance fields, a hand-inserted job and a legacy request are all refused', async () => {
  const c = await ready();
  const { reviewedHash } = (await preview(c)).json.preview;
  assert.equal((await publish(c, { declarationAccepted: true, reviewedHash: 'a'.repeat(64) })).json.error, 'preview_changed');
  assert.equal((await publish(c, { declarationAccepted: true })).json.error, 'preview_changed');
  // acceptance fields invented by a browser are never stored: only the server's own record counts
  const r = await publish(c, { declarationAccepted: true, reviewedHash, acceptedBy: 'someone.else@example.com', acceptedAt: '2020-01-01T00:00:00Z', declaration: { accepted: true, contentHash: 'b'.repeat(64) }, termsVersion: 'other' });
  assert.equal(r.status, 200);
  const [audit] = await c.db.unsafe("select * from listings.audit_log where action = 'publication_acceptance'");
  assert.equal(audit.actor_email, 'ali@sdahomechoices.com.au'); assert.equal(audit.detail.terms_version, 'internal-draft-v1'); assert.ok(!JSON.stringify(audit).includes('someone.else'));
  // a job row written around the route (no acceptance) is never served
  const [real] = await c.db.unsafe('select * from listings.publish_jobs');
  await c.db.unsafe("update listings.publish_jobs set status = 'failed' where id = $1", [real.id]);
  const hand = randomUUID();
  await c.db.unsafe("insert into listings.publish_jobs (id,public_id,draft_id,draft_version,kind,attempt,payload,payload_hash,requested_by,idempotency_key) values ($1,$2,$3,$4,'publish',9,$5::text::jsonb,$6,'ali@sdahomechoices.com.au','hand')", [hand, ID_7B, real.draft_id, real.draft_version, JSON.stringify(real.payload), real.payload_hash]);
  assert.equal((await signedPayload(c, hand)).json.error, 'declaration_not_verified');
  await c.db.unsafe("update listings.publish_jobs set status = 'failed' where id = $1", [hand]);
  // a legacy version 1 payload for a real job is never served either, so the old request cannot bypass the declaration
  const legacy = randomUUID();
  await c.db.unsafe("insert into listings.publish_jobs (id,public_id,draft_id,draft_version,kind,attempt,payload,payload_hash,requested_by,idempotency_key) values ($1,$2,$3,$4,'update',9,$5::text::jsonb,'x','ali@sdahomechoices.com.au','legacy')", [legacy, ID_7B, real.draft_id, real.draft_version, JSON.stringify({ ...real.payload, version: 1, mode: 'update' })]);
  assert.equal((await signedPayload(c, legacy)).json.error, 'declaration_not_verified');
  // an acceptance row cannot be written for another content hash or after the fact
  await assert.rejects(c.db.unsafe("insert into listings.audit_log (actor_email, actor_auth_user, action, public_id, draft_version, job_id, detail) values ('ali@sdahomechoices.com.au', $1, 'publication_acceptance', $2, $3, $4, $5::text::jsonb)", [audit.actor_auth_user, ID_7B, real.draft_version, hand, JSON.stringify({ accepted: true, content_hash: 'c'.repeat(64), terms_version: 'x' })]), /does not match its queued job/);
});

test('VICTORIA WITH FINANCIAL FIGURES: income, yield, occupancy and a financial description publish under the declaration, with no separate approval', async () => {
  const c = await ready({ ...BASE, description: FIN_TEXT, investment: INV });
  const rec = await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
  assert.equal(rec.json.validation.complete, true, JSON.stringify(rec.json.validation));
  assert.ok(!rec.json.validation.blockers.some((b) => b.code === 'description_financial'), 'financial wording is not a blocker');
  assert.equal(rec.json.draft.content.publicAddress.includes('VIC'), true);
  const pv = await preview(c);
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  const r = await publish(c, { declarationAccepted: true, reviewedHash: pv.json.preview.reviewedHash });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const [job] = await c.db.unsafe('select * from listings.publish_jobs');
  assert.equal(job.payload.content.optional.investment.annualIncomeAud, 61000);
  assert.equal(job.payload.content.optional.investment.yieldPct, 6.1);
  assert.equal(job.payload.content.optional.investment.approval, undefined, 'no approval record travels: the website computes what it stores');
  assert.equal(job.payload.content.optional.descriptionApproval, undefined);
  assert.match(job.payload.content.description, /\$61,000/);
  const v = (await c.db.unsafe('select verification from listings.drafts'))[0].verification;
  assert.equal(v.investment_disclosure, undefined); assert.equal(v.description_disclosure, undefined, 'no separate approval was ever recorded');
});

test('FAILURE AND RETRY: a failed dispatch keeps its acceptance; a retry needs a fresh declaration and leaves a separate trace', async () => {
  const c = await ready();
  c.gh.status = 500;
  const pv = await preview(c);
  const first = await publish(c, { declarationAccepted: true, reviewedHash: pv.json.preview.reviewedHash });
  assert.equal(first.status, 502); assert.equal(first.json.job.status, 'failed');
  assert.deepEqual({ ...(await counts(c)), dispatches: 0 }, { jobs: 1, audit: 1, dispatches: 0 }, 'the failed attempt and its acceptance are both kept');
  c.gh.status = 204;
  const noBox = await publish(c, { reviewedHash: (await preview(c)).json.preview.reviewedHash });
  assert.equal(noBox.status, 400, 'a retry is a new publication: it needs the checkbox again');
  const retry = await publish(c, { declarationAccepted: true, reviewedHash: (await preview(c)).json.preview.reviewedHash });
  assert.equal(retry.status, 200, JSON.stringify(retry.json));
  const rows = await c.db.unsafe('select j.status, j.attempt, a.id as audit from listings.publish_jobs j join listings.audit_log a on a.job_id = j.id order by j.attempt');
  assert.deepEqual(rows.map((x) => [x.status, x.attempt]), [['failed', 1], ['dispatched', 2]]);
  assert.notEqual(rows[0].audit, rows[1].audit);
});

test('SENSITIVE PARTICIPANT INFORMATION: a named participant, an email or a phone number is refused before any job exists', async () => {
  for (const line of ['Participant Jane Smith lives here and has a medical diagnosis.', 'Contact jo@example.com about the resident.', 'Call 0412 345 678 about the tenant.']) {
    const c = await ready({ ...BASE, description: `${BASE.description}\n\n${line}` });
    const open = await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
    assert.equal(open.json.validation.publishable, false, line);
    const pv = await preview(c);
    assert.equal(pv.status, 409, line); assert.equal(pv.json.error, 'not_ready');
    assert.deepEqual(await counts(c), { jobs: 0, audit: 0, dispatches: 0 });
  }
});

test('EXISTING OPTIONAL FIELDS: property, SDA facts and agency still travel, and the SDA facts are part of what the Publisher declared', async () => {
  const c = await ready({ ...BASE, property: { bathrooms: 2, carSpaces: 1 }, sdaFacts: { bedrooms: 4, ooa: 'Onsite overnight assistance room' }, marketing: { agency: 'sdahc' } });
  const pv = await preview(c);
  assert.equal((await publish(c, { declarationAccepted: true, reviewedHash: pv.json.preview.reviewedHash })).status, 200);
  const [job] = await c.db.unsafe('select * from listings.publish_jobs');
  assert.deepEqual(job.payload.content.optional.property, { bathrooms: 2, carSpaces: 1 });
  assert.deepEqual(job.payload.content.optional.sda, { bedrooms: 4, ooa: 'Onsite overnight assistance room' });
  assert.deepEqual(job.payload.content.optional.marketing, { agency: 'sdahc' });
  assert.equal(job.payload.reviewedSda.bedrooms, 4); assert.equal(job.payload.reviewedSda.buildingType, 'House'); assert.deepEqual(job.payload.reviewedSda.designCategories, ['IL']);
});

test('A DRY RUN needs no declaration and records no acceptance, and its payload is served without one', async () => {
  const c = await ready();
  const r = await route(c, ALI_N, { method: 'POST', body: { id: ID_7B, expectedVersion: await version(c.db), mode: 'dry_run' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((await counts(c)).audit, 0);
  const p = await signedPayload(c, r.json.job.id);
  assert.equal(p.status, 200); assert.equal(p.json.declaration, undefined);
});

test('the declaration wording is exactly the approved text and the box starts unchecked (screen source)', () => {
  const ui = readFileSync('listings.js', 'utf8');
  assert.ok(ui.includes(`const DECLARATION_TEXT = '${WORDING}';`));
  assert.match(ui, /id: 'ls-declare', checked: ready && LS\.declared === true/);
  assert.match(ui, /declared: false/);
  assert.match(ui, /declarationAccepted: LS\.declared === true, reviewedHash: LS\.preview\.reviewedHash/);
  assert.ok(!/—/.test(ui));
});

test('CRM OCCUPANCY DIFFERENCE is a visible warning, not a blocker: the Publisher sees it, the declaration covers it, publication proceeds', async () => {
  const c = await ready();
  const open = await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
  assert.ok(open.json.validation.advisories.some((a) => a.code === 'occupancy_not_full' && /2 of 3/.test(a.message)), 'the warning is shown with its reason');
  assert.ok(!open.json.validation.blockers.some((b) => b.code === 'verification'), 'and is not a blocker');
  const pv = await preview(c);
  assert.equal((await publish(c, { declarationAccepted: true, reviewedHash: pv.json.preview.reviewedHash })).status, 200);
});

test('A KNOWN MATERIALLY FALSE CLAIM is not overridden by the declaration: "fully leased" in the text or "fully occupied" in the commercial block, against a CRM that records 2 of 3', async () => {
  for (const patch of [{ description: `${BASE.description} The property is fully occupied.` }, { investment: { occupancyStatus: 'fully_occupied', leaseStatus: 'fully_leased' } }]) {
    const c = await ready({ ...BASE, ...patch });
    const open = await call(draftRoute, c.w, c.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
    const b = open.json.validation.blockers.find((x) => x.code === 'public_text_claims_full');
    assert.ok(b && /2 of 3/.test(b.message), 'the screen can say exactly why');
    const pv = await preview(c);
    assert.equal(pv.status, 409); assert.equal(pv.json.error, 'not_ready'); assert.ok(pv.json.reasons.some((r) => /2 of 3/.test(r)));
    assert.deepEqual(await counts(c), { jobs: 0, audit: 0, dispatches: 0 });
  }
});

test('PRIVATE CRM INFORMATION: a house number in the text is refused even with financial wording; no CRM figure ever reaches the payload', async () => {
  const bad = await ready({ ...BASE, description: `${FIN_TEXT}\n\nThe property is at 7B Wattle Street, Exampleton.` });
  const open = await call(draftRoute, bad.w, bad.db, ALI_N, { url: `/api/listings/draft?id=${ID_7B}` });
  assert.equal(open.json.validation.complete, false); assert.ok(open.json.validation.errors.some((e) => e.code === 'private_address'));
  assert.equal((await preview(bad)).status, 409);
  const c = await ready({ ...BASE, description: FIN_TEXT, investment: INV });
  const pv = await preview(c);
  assert.equal((await publish(c, { declarationAccepted: true, reviewedHash: pv.json.preview.reviewedHash })).status, 200);
  const [job] = await c.db.unsafe('select payload from listings.publish_jobs');
  const wire = JSON.stringify(job.payload);
  for (const secret of SECRETS) assert.ok(!wire.includes(secret), `the CRM value ${secret} must never be in the payload`);
  assert.ok(!/7B Wattle|sharepoint|notion\.so/i.test(wire));
});

test('A DATABASE WITHOUT MIGRATION 0006 FAILS CLOSED: preview and publish answer 503 migration_required and nothing is recorded or dispatched', async () => {
  const c = await ready();
  await c.db.raw.exec("alter table listings.audit_log drop constraint audit_publication_acceptance_details; alter table listings.audit_log drop constraint audit_log_action_check; alter table listings.audit_log add constraint audit_log_action_check check (action in ('status_change','withdraw','reinstate'));");
  const pv = await preview(c);
  assert.equal(pv.status, 503); assert.equal(pv.json.error, 'migration_required');
  const r = await publish(c, { declarationAccepted: true, reviewedHash: 'a'.repeat(64) });
  assert.equal(r.status, 503); assert.equal(r.json.error, 'migration_required');
  assert.equal((await c.db.unsafe('select count(*)::int n from listings.publish_jobs'))[0].n, 0); assert.equal(c.gh.dispatches.length, 0);
});

test('SDA MAPPING: the app reads the CRM design categories with the website\'s own function (every spelling), so the frozen facts cannot disagree with the engine', () => {
  for (const labels of [['HPS', 'IL', 'R', 'FA', 'Basic'], ['High Physical Support', 'improved liveability', 'Robust'], ['il', 'IL']]) {
    assert.deepEqual(reviewedSdaFor({ designCategories: labels, buildType: ' House ' }, { content: {} }), { designCategories: core.mapDesignCategories(labels).values, buildingType: 'House' });
  }
  assert.ok(!/DESIGN_TO_WEBSITE/.test(readFileSync('api/_lib/draft-service.js', 'utf8')), 'no second hand-written mapping');
});

test('THE SCREEN SAYS WHAT BLOCKS PUBLICATION and shows warnings next to the confirmation (screen source)', () => {
  const ui = readFileSync('listings.js', 'utf8');
  assert.match(ui, /for \(const b of v\.blockers\) if \(!\['photos_required', 'photo_alt'\]\.includes\(b\.code\) && !pf\.includes\(b\.message\)\) pf\.push\(b\.message\)/);
  assert.ok(!ui.includes('Finish the items in "Preview and check".'), 'no generic message that hides the reason');
  assert.match(ui, /id: 'ls-advisories'/);
});
