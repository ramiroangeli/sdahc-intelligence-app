import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { database } from './drafts-harness.js';
import { createAcceptedJob, reviewedContentHash } from '../api/_lib/publication-acceptance.js';

const session = { identity: { email: 'publisher@example.com', authUserId: '22222222-2222-4222-8222-222222222222' } };
const payload = { content: { description: 'Synthetic property' }, manifest: { photos: [{ id: 'abc', alt: 'Room' }] }, reviewedSda: { designCategories: ['IL'], buildingType: 'House' } };
const setup = async () => {
  const db = await database();
  await db.raw.exec(readFileSync('supabase/migrations/listings_0006_publication_acceptance.sql', 'utf8'));
  const [draft] = await db.unsafe(`insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, created_by, updated_by) values ('lst_1234567890', 'synthetic', 'Synthetic', '{}', '{}', 'publisher@example.com', 'publisher@example.com') returning id, version`);
  const job = { id: randomUUID(), publicId: 'lst_1234567890', draftId: draft.id, draftVersion: draft.version, kind: 'publish', attempt: 1, payload, idempotencyKey: 'synthetic' };
  return { db, job };
};

test('only explicit acceptance of the matching server snapshot creates a job and private acceptance together', async () => {
  const { db, job } = await setup(); const hash = reviewedContentHash(payload);
  await assert.rejects(createAcceptedJob(db, { session, job, reviewedHash: hash, declarationAccepted: false }), /declaration_required/);
  await assert.rejects(createAcceptedJob(db, { session, job, reviewedHash: 'a'.repeat(64), declarationAccepted: true }), /preview_changed/);
  await assert.rejects(createAcceptedJob(db, { session, job: { ...job, draftVersion: 999 }, reviewedHash: hash, declarationAccepted: true }), /draft_changed/);
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
  const h = reviewedContentHash(payload);
  assert.notEqual(h, reviewedContentHash({ ...payload, content: { description: 'Changed' } }));
  assert.notEqual(h, reviewedContentHash({ ...payload, manifest: { photos: [{ id: 'abc', alt: 'Changed' }] } }));
  assert.notEqual(h, reviewedContentHash({ ...payload, reviewedSda: { designCategories: ['HPS'], buildingType: 'House' } }));
});

test('an audit write failure rolls back the job and no publication is recorded', async () => {
  const { db, job } = await setup();
  const failing = { begin: (fn) => db.begin((tx) => fn({ unsafe: (q, p) => {
    if (/insert into listings\.audit_log/i.test(q)) throw new Error('audit unavailable');
    return tx.unsafe(q, p);
  } })) };
  await assert.rejects(createAcceptedJob(failing, { session, job, reviewedHash: reviewedContentHash(payload), declarationAccepted: true }), /audit unavailable/);
  assert.equal((await db.unsafe('select count(*)::int n from listings.publish_jobs'))[0].n, 0);
  assert.equal((await db.unsafe('select count(*)::int n from listings.audit_log'))[0].n, 0);
  await db.raw.close();
});
