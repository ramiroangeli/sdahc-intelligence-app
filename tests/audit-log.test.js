// Migration 0005 (PROPOSED, NOT APPLIED): the private append-only audit log and the distinct 'reinstate' job kind.
// Runs the real SQL files inside PGlite, then acts as each kind of caller. Proves immutability, privacy of access, preserved records, idempotent
// application and the guarded rollback. Nothing here touches a real database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { AUDIT_ACTIONS, actorFromSession, appendAudit, readAudit } from '../api/_lib/audit-log.js';

const sql = (f) => readFileSync(`supabase/migrations/${f}`, 'utf8');
const UP = sql('listings_0005_audit_log_and_reinstate.sql');
const DOWN = sql('listings_0005_audit_log_and_reinstate_rollback.sql');
const ID = 'lst_454f05d21f';
const SESSION = { identity: { email: 'Ali@SDAHomeChoices.com.au', authUserId: '22222222-2222-4222-8222-222222222222' }, staff: { email: 'ali@sdahomechoices.com.au' } };

/** A database as it is in Production today (migrations 0001 to 0004), with real history in it. */
async function before() {
  const db = new PGlite();
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;');
  for (const f of ['listings_0001_drafts.sql', 'listings_0002_photos.sql', 'listings_0003_photo_review.sql', 'listings_0004_publish_jobs.sql']) await db.exec(sql(f));
  await db.exec(`insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, created_by, updated_by) values ('${ID}', 'page', 'Rutherford', '{}', '{}', 'ali@sdahomechoices.com.au', 'ali@sdahomechoices.com.au')`);
  const d = (await db.query(`select id from listings.drafts where public_id = '${ID}'`)).rows[0].id;
  for (const [i, kind] of ['dry_run', 'publish', 'update', 'withdraw'].entries()) {
    await db.query(`insert into listings.publish_jobs (id, public_id, draft_id, draft_version, kind, status, payload, payload_hash, requested_by, idempotency_key) values (gen_random_uuid(), $1, $2, 1, $3, 'succeeded', '{"k":1}', 'h', 'ali@sdahomechoices.com.au', $4)`, [ID, d, kind, `${ID}:1:${kind}:${i}`]);
  }
  return db;
}
const asRole = async (db, role, fn) => { await db.exec(`set role ${role}`); try { return await fn(); } finally { await db.exec('reset role'); } };
const denied = async (p) => { try { await p; return null; } catch (e) { return String(e.message); } };
/** Runs a script the way the SQL editor does: a refused script leaves its transaction open, so it is rolled back before going on. */
const refused = async (db, script) => { const m = await denied(db.exec(script)); if (m) await db.exec('rollback'); return m; };
const adapter = (db) => ({ unsafe: async (q, p) => (await db.query(q, p)).rows });
const row = (over = {}) => ({ session: SESSION, action: 'withdraw', publicId: ID, draftVersion: 2, reason: 'Vendor asked to pause marketing', ...over });

test('MIGRATION 0005: applies on top of 0001 to 0004, keeps every existing job, and applying it twice is harmless', async () => {
  const db = await before();
  const kinds = async () => (await db.query('select kind, count(*)::int n from listings.publish_jobs group by kind order by kind')).rows.map((r) => `${r.kind}:${r.n}`).join();
  const was = await kinds();
  await db.exec(UP);
  assert.equal(await kinds(), was, 'existing records are untouched');
  await db.exec(UP);
  assert.equal(await kinds(), was);
  assert.equal((await db.query('select count(*)::int n from listings.audit_log')).rows[0].n, 0);
});

test('MIGRATION 0005: the job kind check now allows reinstate and still refuses anything else; idempotency keys and active-job rule are unchanged', async () => {
  const db = await before(); await db.exec(UP);
  const d = (await db.query(`select id from listings.drafts where public_id = '${ID}'`)).rows[0].id;
  const add = (kind, key, status = 'succeeded') => db.query(`insert into listings.publish_jobs (id, public_id, draft_id, draft_version, kind, status, payload, payload_hash, requested_by, idempotency_key) values (gen_random_uuid(), $1, $2, 1, $3, $5, '{}', 'h', 'x@y.co', $4)`, [ID, d, kind, key, status]);
  await add('reinstate', 'k-reinstate');
  assert.match(await denied(add('purge', 'k-purge')), /check/i);
  assert.match(await denied(add('reinstate', 'k-reinstate')), /unique|duplicate/i, 'the idempotency key is still unique');
  await add('update', 'k-a1', 'running');
  assert.match(await denied(add('reinstate', 'k-a2', 'queued')), /publish_jobs_one_active_per_listing|unique|duplicate/i, 'one active job per listing still holds for the new kind');
  const defs = (await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'listings.publish_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dry_run%'`)).rows;
  assert.equal(defs.length, 1); assert.match(defs[0].d, /reinstate/);
});

test('AUDIT LOG: only the app role can read and append; nobody else can touch it', async () => {
  const db = await before(); await db.exec(UP);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.match(await denied(asRole(db, role, () => db.query('select * from listings.audit_log'))), /permission denied|denied/i, `${role} cannot read`);
    assert.match(await denied(asRole(db, role, () => db.query(`insert into listings.audit_log (actor_email, action, public_id, reason) values ('a@b.co','withdraw','${ID}','x')`))), /permission denied|denied/i, `${role} cannot write`);
  }
  await asRole(db, 'listings_app', async () => {
    await appendAudit(adapter(db), row());
    assert.equal((await db.query('select count(*)::int n from listings.audit_log')).rows[0].n, 1);
  });
});

test('AUDIT LOG: append-only at the database level (update, delete, truncate refused for the app role and for the owner); the timestamp and writer cannot be set', async () => {
  const db = await before(); await db.exec(UP);
  await appendAudit(adapter(db), row());
  for (const q of ['update listings.audit_log set reason = \'changed\'', 'delete from listings.audit_log', 'truncate listings.audit_log']) {
    assert.match(await denied(asRole(db, 'listings_app', () => db.query(q))), /permission denied|append-only/i, `app role: ${q}`);
    assert.match(await denied(db.query(q)), /append-only/i, `owner: ${q}`);
  }
  assert.equal((await db.query('select reason from listings.audit_log')).rows[0].reason, 'Vendor asked to pause marketing');
  await db.query(`insert into listings.audit_log (at, recorded_by, actor_email, action, public_id, reason) values ('2001-01-01', 'someone_else', 'x@y.co', 'withdraw', '${ID}', 'backdated')`);
  const r = (await db.query(`select at, recorded_by from listings.audit_log where reason = 'backdated'`)).rows[0];
  assert.ok(new Date(r.at).getFullYear() >= 2026, 'a caller cannot backdate a row'); assert.notEqual(r.recorded_by, 'someone_else');
});

test('AUDIT LOG: the database enforces the rules too (a withdrawal needs a reason of at most 300 characters; a status change needs two different statuses; a reinstatement needs a status)', async () => {
  const db = await before(); await db.exec(UP);
  const ins = (cols, vals) => db.query(`insert into listings.audit_log (${cols}) values (${vals})`);
  assert.match(await denied(ins('actor_email, action, public_id', `'a@b.co','withdraw','${ID}'`)), /audit_withdraw_needs_reason|check/i);
  assert.match(await denied(ins('actor_email, action, public_id, reason', `'a@b.co','withdraw','${ID}','${'x'.repeat(301)}'`)), /check/i);
  assert.match(await denied(ins('actor_email, action, public_id, status_from, status_to', `'a@b.co','status_change','${ID}','sold','sold'`)), /check/i);
  assert.match(await denied(ins('actor_email, action, public_id', `'a@b.co','reinstate','${ID}'`)), /check/i);
  assert.match(await denied(ins('actor_email, action, public_id, reason', `'A@B.co','withdraw','${ID}','x'`)), /check/i, 'emails are stored lower case');
  assert.match(await denied(ins('actor_email, action, public_id, reason', `'a@b.co','delete','${ID}','x'`)), /check/i);
  assert.match(await denied(ins('actor_email, action, public_id, reason', `'a@b.co','withdraw','not-an-id','x'`)), /check/i);
  await ins('actor_email, action, public_id, status_from, status_to', `'a@b.co','status_change','${ID}','available','sold'`);
  await ins('actor_email, action, public_id, status_to', `'a@b.co','reinstate','${ID}','available'`);
});

test('AUDIT LOG MODULE: the actor comes from the verified session only, is stored lower case, and no request field can name someone else', async () => {
  const db = await before(); await db.exec(UP);
  const a = adapter(db);
  assert.deepEqual(actorFromSession(SESSION), { email: 'ali@sdahomechoices.com.au', authUserId: '22222222-2222-4222-8222-222222222222' });
  await assert.rejects(() => appendAudit(a, row({ session: null })), (e) => e.status === 401);
  await assert.rejects(() => appendAudit(a, row({ session: { identity: {} } })), (e) => e.status === 401);
  const { id } = await appendAudit(a, row({ actor: 'someone.else@example.com', actor_email: 'someone.else@example.com', detail: { note: 'x' } }));
  const r = (await db.query('select actor_email, actor_auth_user, detail from listings.audit_log where id = $1', [id])).rows[0];
  assert.equal(r.actor_email, 'ali@sdahomechoices.com.au', 'extra fields cannot name another actor');
  assert.equal(r.actor_auth_user, '22222222-2222-4222-8222-222222222222');
  await assert.rejects(() => appendAudit(a, row({ action: 'delete' })), (e) => e.status === 400);
  await assert.rejects(() => appendAudit(a, row({ reason: null })), (e) => e.code === 'reason_required');
  await assert.rejects(() => appendAudit(a, row({ reason: 'x'.repeat(301) })), (e) => e.code === 'invalid_reason');
  await assert.rejects(() => appendAudit(a, row({ action: 'status_change', reason: null, statusFrom: 'sold', statusTo: 'bogus' })), (e) => e.code === 'invalid_status');
  await appendAudit(a, row({ action: 'status_change', reason: null, statusFrom: 'available', statusTo: 'sold' }));
  assert.deepEqual(AUDIT_ACTIONS, ['status_change', 'withdraw', 'reinstate']);
  const trail = await readAudit(a, ID);
  assert.equal(trail.length, 2); assert.ok(trail[0].id > trail[1].id, 'newest first');
});

test('ROLLBACK: refuses while audit rows exist unless confirmed, refuses while reinstate jobs exist, and otherwise restores the old state without touching other records', async () => {
  const db = await before(); await db.exec(UP);
  const jobs = async () => (await db.query('select count(*)::int n from listings.publish_jobs')).rows[0].n;
  const n = await jobs();
  await appendAudit(adapter(db), row());
  assert.match(await refused(db, DOWN), /audit log has rows/i);
  assert.equal((await db.query('select count(*)::int n from listings.audit_log')).rows[0].n, 1, 'a refused rollback changes nothing');
  const d = (await db.query(`select id from listings.drafts where public_id = '${ID}'`)).rows[0].id;
  await db.query(`insert into listings.publish_jobs (id, public_id, draft_id, draft_version, kind, status, payload, payload_hash, requested_by, idempotency_key) values (gen_random_uuid(), $1, $2, 1, 'reinstate', 'succeeded', '{}', 'h', 'x@y.co', 'k-r')`, [ID, d]);
  await db.exec("set listings.confirm_drop_audit = 'yes'");
  assert.match(await refused(db, DOWN), /reinstate jobs exist/i);
  await db.query("delete from listings.publish_jobs where kind = 'reinstate'");
  await db.exec(DOWN);
  assert.equal(await jobs(), n, 'every job that existed before 0005 is still there');
  assert.equal((await db.query("select to_regclass('listings.audit_log') t")).rows[0].t, null);
  assert.match(await denied(db.query(`insert into listings.publish_jobs (id, public_id, draft_id, draft_version, kind, status, payload, payload_hash, requested_by, idempotency_key) values (gen_random_uuid(), '${ID}', '${d}', 1, 'reinstate', 'succeeded', '{}', 'h', 'x@y.co', 'k-r2')`)), /check/i);
  await db.exec(UP);   // and it can be applied again
  assert.equal((await db.query('select count(*)::int n from listings.audit_log')).rows[0].n, 0);
});

test('ROLLBACK: an empty audit log can be rolled back without confirmation', async () => {
  const db = await before(); await db.exec(UP); await db.exec(DOWN);
  assert.equal((await db.query("select to_regclass('listings.audit_log') t")).rows[0].t, null);
});

test('FILES: the migration touches only the listings schema, and only the withdrawal and publication services use the audit log module', () => {
  assert.match(UP, /APPLIED to Production/);
  const objects = [...UP.matchAll(/(?:create|alter|drop)\s+(?:table|index|function|trigger)\s+(?:if (?:not )?exists\s+)?(?:\w+\s+on\s+)?([a-z_]+)\./gi)].map((m) => m[1].toLowerCase());
  assert.ok(objects.length > 0 && objects.every((s) => s === 'listings'), `only the listings schema is touched: ${[...new Set(objects)].join()}`);
  assert.ok(!/\b(raw|history|analytics|public|rfi)\./i.test(UP.replace(/--.*$/gm, '')), 'no other schema is named');
  const used = [...readdirSync('api/_lib'), ...readdirSync('api/listings').map((f) => `../listings/${f}`)].filter((f) => f.endsWith('.js') && f !== 'audit-log.js').filter((f) => /from '\.\/audit-log\.js'|audit-log\.js'/.test(readFileSync(`api/_lib/${f}`, 'utf8')));
  assert.deepEqual(used.sort(), ['publish-service.js', 'withdrawal.js'], 'the audit trail is written by the withdrawal and the status change, nowhere else');
});
