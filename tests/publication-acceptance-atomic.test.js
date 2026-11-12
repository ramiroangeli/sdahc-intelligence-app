import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { database } from './drafts-harness.js';
import { createAcceptedJob, reviewedContentHash } from '../api/_lib/publication-acceptance.js';

const session = { identity: { email: 'publisher@example.com', authUserId: '22222222-2222-4222-8222-222222222222' } };
const payload = { content: { description: 'Synthetic property' }, manifest: { photos: [{ id: 'abc', alt: 'Room' }] }, reviewedSda: { designCategories: ['IL'], buildingType: 'House' } };
const hashFor = (job, content = job.payload) => reviewedContentHash(content, { publicId: job.publicId, draftVersion: job.draftVersion });
const setup = async () => {
  const db = await database();
  await db.raw.exec(readFileSync('supabase/migrations/listings_0006_publication_acceptance.sql', 'utf8'));
  const [draft] = await db.unsafe(`insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, created_by, updated_by) values ('lst_1234567890', 'synthetic', 'Synthetic', '{}', '{}', 'publisher@example.com', 'publisher@example.com') returning id, version`);
  const job = { id: randomUUID(), publicId: 'lst_1234567890', draftId: draft.id, draftVersion: draft.version, kind: 'publish', attempt: 1, payload, idempotencyKey: 'synthetic' };
  return { db, job };
};

test('only explicit acceptance of the matching server snapshot creates a job and private acceptance together', async () => {
  const { db, job } = await setup(); const hash = hashFor(job);
  await assert.rejects(createAcceptedJob(db, { session, job, reviewedHash: hash, declarationAccepted: false }), /declaration_required/);
  await assert.rejects(createAcceptedJob(db, { session, job, reviewedHash: 'a'.repeat(64), declarationAccepted: true }), /preview_changed/);
  await assert.rejects(createAcceptedJob(db, { session, job: { ...job, draftVersion: 999 }, reviewedHash: hashFor({ ...job, draftVersion: 999 }), declarationAccepted: true }), /draft_changed/);
  assert.equal((await db.unsafe('select count(*)::int n from listings.publish_jobs'))[0].n, 0);
  assert.equal((await db.unsafe('select count(*)::int n from listings.audit_log'))[0].n, 0);
  const created = await createAcceptedJob(db, { session, job, reviewedHash: hash, declarationAccepted: true });
  assert.equal(created.status, 'queued');
  const [audit] = await db.unsafe('select * from listings.audit_log where job_id = $1', [created.id]);
  assert.equal(audit.actor_auth_user, session.identity.authUserId); assert.equal(audit.detail.content_hash, hash);
  assert.equal(audit.detail.terms_version, 'internal-draft-v1'); assert.equal(audit.detail.accepted, true);
  await db.raw.close();
});

test('the server hash changes when text, images or reviewed SDA facts change', () => {
  const job = { publicId: 'lst_1234567890', draftVersion: 1, payload };
  const h = hashFor(job);
  assert.notEqual(h, hashFor(job, { ...payload, content: { description: 'Changed' } }));
  assert.notEqual(h, hashFor(job, { ...payload, manifest: { photos: [{ id: 'abc', alt: 'Changed' }] } }));
  assert.notEqual(h, hashFor(job, { ...payload, reviewedSda: { designCategories: ['HPS'], buildingType: 'House' } }));
  assert.notEqual(h, hashFor({ ...job, publicId: 'lst_abcdefabcd' }));
  assert.notEqual(h, hashFor({ ...job, draftVersion: 2 }));
});

test('an audit write failure rolls back the job and no publication is recorded', async () => {
  const { db, job } = await setup();
  const failing = { begin: (fn) => db.begin((tx) => fn({ unsafe: (q, p) => {
    if (/insert into listings\.audit_log/i.test(q)) throw new Error('audit unavailable');
    return tx.unsafe(q, p);
  } })) };
  await assert.rejects(createAcceptedJob(failing, { session, job, reviewedHash: hashFor(job), declarationAccepted: true }), /audit unavailable/);
  assert.equal((await db.unsafe('select count(*)::int n from listings.publish_jobs'))[0].n, 0);
  assert.equal((await db.unsafe('select count(*)::int n from listings.audit_log'))[0].n, 0);
  await db.raw.close();
});

test('a failed attempt retains its acceptance and an explicit retry creates a separate trace', async () => {
  const { db, job } = await setup();
  const first = await createAcceptedJob(db, { session, job, reviewedHash: hashFor(job), declarationAccepted: true });
  await db.unsafe(`update listings.publish_jobs set status = 'failed', error_code = 'checks_failed' where id = $1`, [first.id]);
  const retry = { ...job, id: randomUUID(), attempt: 2, idempotencyKey: 'synthetic-retry' };
  await assert.rejects(createAcceptedJob(db, { session, job: retry, reviewedHash: hashFor(retry), declarationAccepted: false }), /declaration_required/);
  const next = await createAcceptedJob(db, { session, job: retry, reviewedHash: hashFor(retry), declarationAccepted: true });
  const rows = await db.unsafe('select j.status, a.job_id from listings.publish_jobs j join listings.audit_log a on a.job_id = j.id order by j.attempt');
  assert.deepEqual(rows.map((row) => row.status), ['failed', 'queued']);
  assert.deepEqual(rows.map((row) => row.job_id), [first.id, next.id]);
  await db.raw.close();
});

test('the signed payload route refuses a version 2 job without its matching private acceptance', async () => {
  const { callSigned, SECRET } = await import('./drafts-harness.js');
  const { publishPayloadRoute } = await import('../api/_lib/routes.js');
  const { db, job } = await setup();
  job.payload = { ...payload, version: 2, publicId: job.publicId, mode: 'publish' };
  const accepted = await createAcceptedJob(db, { session, job, reviewedHash: hashFor(job), declarationAccepted: true });
  const result = await callSigned(publishPayloadRoute, db, { url: `/api/listings/publish-payload?job=${accepted.id}`, secret: SECRET });
  assert.equal(result.status, 200); assert.equal(result.json.version, 2);
  assert.ok(!result.raw.includes(session.identity.email));
  const other = randomUUID();
  await db.unsafe(`update listings.publish_jobs set status = 'failed' where id = $1`, [accepted.id]);
  await db.unsafe(`insert into listings.publish_jobs (id,public_id,draft_id,draft_version,kind,attempt,payload,payload_hash,requested_by,idempotency_key) values ($1,$2,$3,$4,'publish',2,$5::text::jsonb,$6,'publisher@example.com','no-acceptance')`, [other, job.publicId, job.draftId, job.draftVersion, JSON.stringify(job.payload), hashFor(job)]);
  const rejected = await callSigned(publishPayloadRoute, db, { url: `/api/listings/publish-payload?job=${other}`, secret: SECRET });
  assert.equal(rejected.status, 409); assert.equal(rejected.json.error, 'declaration_not_verified');
  await db.raw.close();
});
