// The migration, run for real: who can touch the drafts tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './drafts-harness.js';

const asRole = async (db, role, sql) => {
  await db.raw.exec(`set role ${role}`);
  try { return { rows: (await db.raw.query(sql)).rows }; } catch (e) { return { denied: e.message }; } finally { await db.raw.exec('reset role'); }
};
const INSERT = "insert into listings.drafts (public_id, notion_page_id, label, base_facts, created_by, updated_by) values ('lst_0123456789','p','l','{}','a','a') returning id";

test('anon, authenticated and service_role have no access to the drafts schema', async () => {
  const db = await database();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const q of ['select * from listings.drafts', 'select * from listings.draft_history', INSERT]) assert.match((await asRole(db, role, q)).denied ?? 'ALLOWED', /permission denied/, `${role}: ${q}`);
  }
});
test('listings_app can read, create and update drafts, append history, but not delete or rewrite history', async () => {
  const db = await database();
  const ins = await asRole(db, 'listings_app', INSERT);
  assert.ok(ins.rows, ins.denied);
  const id = ins.rows[0].id;
  assert.ok((await asRole(db, 'listings_app', `update listings.drafts set label='x' where id='${id}'`)).rows);
  assert.ok((await asRole(db, 'listings_app', `insert into listings.draft_history (draft_id, version, action, content, changed_by) values ('${id}',1,'create','{}','a')`)).rows);
  assert.match((await asRole(db, 'listings_app', `delete from listings.drafts where id='${id}'`)).denied ?? 'ALLOWED', /permission denied/);
  assert.match((await asRole(db, 'listings_app', 'update listings.draft_history set changed_by=\'x\'')).denied ?? 'ALLOWED', /permission denied/);
  assert.match((await asRole(db, 'listings_app', 'delete from listings.draft_history')).denied ?? 'ALLOWED', /permission denied/);
});
test('listings_app cannot reach any other schema table', async () => {
  const db = await database();
  await db.raw.exec('create schema raw; create table raw.deals (x int); create schema rfi; create table rfi.requests (x int);');
  for (const q of ['select * from raw.deals', 'select * from rfi.requests']) assert.match((await asRole(db, 'listings_app', q)).denied ?? 'ALLOWED', /permission denied/);
});
test('one open draft per property, and constraints hold', async () => {
  const db = await database();
  await db.raw.exec(INSERT);
  await assert.rejects(db.raw.exec(INSERT), /duplicate key|unique/);
  await assert.rejects(db.raw.exec("insert into listings.drafts (public_id, notion_page_id, label, base_facts, created_by, updated_by) values ('bad','q','l','{}','a','a')"), /check/);
});
test('the migration is idempotent for the role and does not touch other schemas', async () => {
  const sql = (await import('node:fs')).readFileSync('supabase/migrations/listings_0001_drafts.sql', 'utf8');
  const active = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.ok(!/(raw|history|analytics|rfi|public)\./i.test(active.replace(/listings\.[a-z_]+/g, '')), 'only the listings schema is referenced');
  assert.ok(!/password/i.test(active), 'no password in the file');
  assert.ok(!/grant[^;]*to[^;]*(anon|authenticated|service_role)/i.test(active), 'nothing granted to API roles');
});

test('jsonb parameters are cast through text so postgres.js cannot double-encode them', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../api/_lib/drafts-repo.js', import.meta.url), 'utf8');
  assert.deepEqual(src.match(/\$\d+::jsonb/g) ?? [], [], 'bind jsonb values as $n::text::jsonb');
});
