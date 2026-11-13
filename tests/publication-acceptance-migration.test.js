import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = (n) => readFileSync(`supabase/migrations/${n}`, 'utf8');
const files = ['listings_0001_drafts.sql', 'listings_0002_photos.sql', 'listings_0003_photo_review.sql', 'listings_0004_publish_jobs.sql', 'listings_0005_audit_log_and_reinstate.sql'];

test('acceptance migration preserves audit history and rejects incomplete acceptance records', async () => {
  const db = new PGlite();
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;');
  for (const f of files) await db.exec(migration(f));
  await db.exec(`insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, created_by, updated_by) values ('lst_1234567890', 'synthetic', 'Synthetic', '{}', '{}', 'staff@example.com', 'staff@example.com');`);
  const draft = (await db.query(`select id from listings.drafts`)).rows[0].id;
  const job = (await db.query(`insert into listings.publish_jobs (public_id,draft_id,draft_version,kind,payload,payload_hash,requested_by,requested_by_auth_user,idempotency_key) values ('lst_1234567890',$1,1,'publish','{}',$2,'staff@example.com','22222222-2222-4222-8222-222222222222','synthetic') returning id`, [draft, 'a'.repeat(64)])).rows[0].id;
  await db.query(`insert into listings.audit_log (actor_email, action, public_id, reason) values ('staff@example.com','withdraw','lst_1234567890','test')`);
  const up = migration('listings_0006_publication_acceptance.sql');
  await db.exec(up); await db.exec(up);
  assert.equal((await db.query('select count(*)::int n from listings.audit_log')).rows[0].n, 1);
  const insert = (detail, auth = '22222222-2222-4222-8222-222222222222') => db.query(`insert into listings.audit_log (actor_email,actor_auth_user,action,public_id,draft_version,job_id,detail) values ('staff@example.com',$1,'publication_acceptance','lst_1234567890',1,$2,$3::jsonb)`, [auth, job, JSON.stringify(detail)]);
  const valid = { accepted: true, content_hash: 'a'.repeat(64), terms_version: 'internal-v1' };
  await assert.rejects(insert({ ...valid, accepted: false }), /check|match/i);
  await assert.rejects(insert({ content_hash: valid.content_hash, terms_version: valid.terms_version }), /check|match/i);
  await assert.rejects(insert({ ...valid, content_hash: 'bad' }), /check|match/i);
  await assert.rejects(insert({ ...valid, terms_version: '' }), /check/i);
  await assert.rejects(insert(valid, null), /check|match/i);
  await assert.rejects(insert({ ...valid, content_hash: 'b'.repeat(64) }), /match/i);
  await assert.rejects(insert(valid, '11111111-1111-4111-8111-111111111111'), /match/i);
  await insert(valid);
  await assert.rejects(db.query(`update listings.publish_jobs set payload = '{"tampered":true}' where id = $1`, [job]), /immutable/i);
  await assert.rejects(db.query(`update listings.publish_jobs set payload_hash = $1 where id = $2`, ['b'.repeat(64), job]), /immutable/i);
  await db.query(`update listings.publish_jobs set status = 'failed', error_code = 'test_failure' where id = $1`, [job]);
  assert.equal((await db.query(`select status from listings.publish_jobs where id = $1`, [job])).rows[0].status, 'failed');
  await assert.rejects(db.query(`update listings.audit_log set detail = '{}' where action = 'publication_acceptance'`), /append-only/i);
  await assert.rejects(db.exec(migration('listings_0006_publication_acceptance_rollback.sql')), /Cannot roll back/);
  await db.exec('rollback');
  await db.close();
});
