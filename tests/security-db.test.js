// Runs the REAL production schema file (sync/schema.sql, verified against the production catalog on 8 Nov 2026)
// and the proposed fix inside an in-process Postgres (PGlite), then impersonates each kind of caller the way
// PostgREST does: SET ROLE plus request.jwt.claims. Proves who can read what before and after the fix, and the rollback.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const schemaSql = readFileSync('sync/schema.sql', 'utf8');
const fixSql = readFileSync('supabase/proposed/001_analytics_microsoft_only.sql', 'utf8');
const rollbackSql = fixSql.split('-- ROLLBACK')[1].split('\n').filter((l) => l.startsWith('-- ') && !l.startsWith('-- ROLLBACK')).map((l) => l.slice(3)).join('\n');

const AZURE = { role: 'authenticated', sub: 'a1', app_metadata: { provider: 'azure', providers: ['azure'] } };
const EMAIL = { role: 'authenticated', sub: 'e1', app_metadata: { provider: 'email', providers: ['email'] } };
const NOMETA = { role: 'authenticated', sub: 'n1' };

async function freshDb() {
  const db = new PGlite();
  // Supabase provides these roles and auth.jwt(); the schema file expects them to exist.
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
  `);
  await db.exec(schemaSql);
  await db.exec(`
    insert into raw.deals (notion_page_id, name, transaction_value, advisory_fee) values ('d1', 'Deal One', 1000000, 25000), ('d2', 'Deal Two', 2000000, 50000);
    insert into raw.contacts (notion_page_id, name, email) values ('c1', 'Private Contact', 'private@example.com');
    insert into raw.tasks (notion_page_id, name) values ('t1', 'A task');
    insert into raw.groups (notion_page_id, name) values ('g1', 'A group');
    insert into history.deal_snapshots (notion_page_id, snapshot_date, transaction_value) values ('d1', '2026-01-01', 1000000);
  `);
  return db;
}

/** Runs one statement as a caller. Returns { rows } or { denied: message }. */
async function as(db, claims, query) {
  await db.exec(`set role ${claims ? claims.role : 'anon'}; select set_config('request.jwt.claims', '${JSON.stringify(claims ?? {})}', false);`);
  try { return { rows: (await db.query(query)).rows }; } catch (e) { return { denied: e.message }; } finally { await db.exec('reset role;'); }
}
const count = async (db, who, rel) => (await as(db, who, `select count(*)::int c from ${rel}`));

test('BEFORE the fix (current production): an email-provider session can read every deal', async () => {
  const db = await freshDb();
  assert.equal((await count(db, EMAIL, 'analytics.deals')).rows[0].c, 2, 'exposure reproduced');
  assert.equal((await count(db, EMAIL, 'raw.deals')).rows[0].c, 2);
  assert.equal((await count(db, AZURE, 'analytics.deals')).rows[0].c, 2);
});

test('AFTER the fix: Microsoft staff keep access, everyone else sees nothing', async () => {
  const db = await freshDb();
  await db.exec(fixSql);
  assert.equal((await count(db, AZURE, 'analytics.deals')).rows[0].c, 2, 'staff still read deals through the view');
  assert.equal((await count(db, AZURE, 'raw.deals')).rows[0].c, 2);
  const cols = (await as(db, AZURE, 'select transaction_value, advisory_fee from analytics.deals order by 1')).rows;
  assert.equal(cols.length, 2, 'financial columns still readable by staff');
  for (const who of [EMAIL, NOMETA, { ...EMAIL, app_metadata: { provider: 'email', providers: ['email', 'azure'] } }]) {
    assert.equal((await count(db, who, 'analytics.deals')).rows[0].c, 0, `view: ${JSON.stringify(who.app_metadata)}`);
    assert.equal((await count(db, who, 'raw.deals')).rows[0].c, 0, 'raw table');
  }
  const anon = await count(db, null, 'analytics.deals');
  assert.match(anon.denied, /permission denied/);
  assert.match((await count(db, null, 'raw.deals')).denied, /permission denied/);
});

test('AFTER the fix: nothing else is reachable by authenticated users or anon (all roles)', async () => {
  const db = await freshDb();
  await db.exec(fixSql);
  for (const rel of ['raw.contacts', 'raw.tasks', 'raw.groups', 'history.deal_snapshots', 'history.deal_stage_events', 'history.deal_outcome_events']) {
    for (const who of [AZURE, EMAIL, null]) assert.match((await count(db, who, rel)).denied ?? '', /permission denied/, `${rel} must stay closed`);
  }
  // no write paths either
  for (const who of [AZURE, EMAIL]) {
    assert.match((await as(db, who, "update raw.deals set name = 'x'")).denied ?? '', /permission denied/);
    assert.match((await as(db, who, "delete from raw.deals")).denied ?? '', /permission denied/);
  }
});

test('service_role (the nightly sync) is unaffected by the fix', async () => {
  const db = await freshDb();
  await db.exec(fixSql);
  await db.exec("set role service_role");
  assert.equal((await db.query('select count(*)::int c from raw.deals')).rows[0].c, 2);
  await db.exec("insert into raw.deals (notion_page_id, name) values ('d3','Synced') on conflict (notion_page_id) do update set name = excluded.name");
  assert.equal((await db.query('select count(*)::int c from raw.deals')).rows[0].c, 3);
});

test('the fix touches only the raw.deals policy: no grants, no other policies', async () => {
  const db = await freshDb();
  const snap = async () => JSON.stringify((await db.query(`
    select (select json_agg(x order by x) from (select schemaname||'.'||tablename||':'||policyname||':'||roles::text as x from pg_policies) p) pol,
           (select json_agg(x order by x) from (select c.oid::regclass::text||':'||coalesce(c.relacl::text,'')||':'||coalesce(array_to_string(c.reloptions,','),'') as x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('raw','analytics','history')) q) acl,
           (select json_agg(x order by x) from (select a.attrelid::regclass::text||'.'||a.attname||':'||coalesce(a.attacl::text,'') as x from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('raw','analytics','history') and a.attnum>0 and not a.attisdropped) r) cols`)).rows[0]);
  const before = JSON.parse(await snap());
  await db.exec(fixSql);
  const after = JSON.parse(await snap());
  assert.deepEqual(after.acl, before.acl, 'table grants and view options unchanged');
  assert.deepEqual(after.cols, before.cols, 'column grants unchanged');
  const changed = after.pol.filter((p) => !before.pol.includes(p));
  assert.deepEqual(changed, [], 'same policy name and roles; only the expression differs');
  assert.equal(after.pol.length, before.pol.length);
});

test('ROLLBACK restores the previous behaviour exactly', async () => {
  const db = await freshDb();
  await db.exec(fixSql);
  assert.equal((await count(db, EMAIL, 'analytics.deals')).rows[0].c, 0);
  assert.ok(rollbackSql.includes('using (true)'));
  await db.exec(rollbackSql);
  assert.equal((await count(db, EMAIL, 'analytics.deals')).rows[0].c, 2, 'back to the original behaviour');
  assert.equal((await db.query("select qual from pg_policies where tablename='deals'")).rows[0].qual, 'true');
});

test('the fix is idempotent (safe to run twice)', async () => {
  const db = await freshDb();
  await db.exec(fixSql); await db.exec(fixSql);
  assert.equal((await count(db, AZURE, 'analytics.deals')).rows[0].c, 2);
});
