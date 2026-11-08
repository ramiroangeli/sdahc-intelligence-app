// The single-statement compare-and-set that makes saves fast (one database round trip instead of five), and the round-trip budget of
// the photo operations. Real SQL (PGlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as repo from '../api/_lib/drafts-repo.js';
import { database } from './drafts-harness.js';

const actor = { email: 'ali@sdahomechoices.com.au', authUserId: '00000000-0000-4000-8000-000000000001' };
const ID = 'lst_0123456789';

async function setup() {
  const db = await database();
  let n = 0;
  const counted = { raw: db.raw, unsafe: (q, p) => { n += 1; return db.unsafe(q, p); }, begin: (fn) => { n += 2; return db.begin((tx) => fn({ unsafe: (q, p) => { n += 1; return tx.unsafe(q, p); } })); } };
  const d = await repo.createDraft(counted, { publicId: ID, notionPageId: 'p', label: 'Example Street, Exampleton VIC 3999', content: { title: '' }, baseFacts: {}, baseEditedAt: null, actor });
  return { db: counted, d, count: () => n, reset: () => { n = 0; } };
}
const upd = (db, d, patch, over = {}) => repo.updateDraft(db, { publicId: ID, expectedVersion: d.version, action: 'update', patch, actor, current: d, ...over });

test('an update with the row already in hand is ONE database round trip and still writes the history row with the actor', async () => {
  const { db, d, count, reset } = await setup();
  reset();
  const saved = await upd(db, d, { content: { title: 'A new title for the draft' } });
  assert.equal(count(), 1, 'one statement');
  assert.equal(saved.version, d.version + 1);
  assert.equal(saved.content.title, 'A new title for the draft');
  const h = (await db.unsafe('select version, action, changed_fields, changed_by from listings.draft_history order by id desc limit 1'))[0];
  assert.deepEqual([h.version, h.action, h.changed_fields, h.changed_by], [saved.version, 'update', ['title'], actor.email]);
});

test('the slow path (no row in hand) gives the same result', async () => {
  const { db, d } = await setup();
  const saved = await repo.updateDraft(db, { publicId: ID, expectedVersion: d.version, action: 'update', patch: { content: { title: 'Slow path title here' } }, actor });
  assert.equal(saved.version, d.version + 1);
  assert.equal((await db.unsafe('select count(*)::int c from listings.draft_history'))[0].c, 2);
});

test('a stale row is refused with 409 and writes nothing; a missing draft is 404', async () => {
  const { db, d } = await setup();
  await upd(db, d, { content: { title: 'First change to the draft' } });
  await assert.rejects(upd(db, d, { content: { title: 'Second change from a stale row' } }), (e) => e.status === 409 && e.code === 'draft_changed');
  assert.equal((await db.unsafe('select content from listings.draft_history order by id desc limit 1'))[0].content.title, 'First change to the draft');
  assert.equal((await db.unsafe('select count(*)::int c from listings.draft_history'))[0].c, 2, 'the refused save left no history');
  await assert.rejects(repo.updateDraft(db, { publicId: 'lst_ffffffffff', expectedVersion: 1, action: 'update', patch: { content: {} }, actor, current: { ...d, public_id: 'lst_ffffffffff' } }), (e) => e.status === 404);
});

test('a discarded draft cannot be updated from a row read earlier', async () => {
  const { db, d } = await setup();
  await repo.discardDraft(db, { publicId: ID, expectedVersion: d.version, actor });
  await assert.rejects(upd(db, d, { content: { title: 'Too late to change this' } }), (e) => [404, 409].includes(e.status));
});

test('two writers holding the same row: exactly one wins, the other gets 409, history has no gap or duplicate version', async () => {
  const { db, d } = await setup();
  const results = await Promise.allSettled([upd(db, d, { content: { title: 'Writer one title here' } }), upd(db, d, { content: { title: 'Writer two title here' } })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  const versions = (await db.unsafe('select version from listings.draft_history order by version')).map((r) => r.version);
  assert.deepEqual(versions, [1, 2]);
});

test('a change that changes nothing makes no query, no new version and no history', async () => {
  const { db, d, count, reset } = await setup();
  reset();
  const same = await upd(db, d, { content: d.content });
  assert.equal(count(), 0);
  assert.equal(same.version, d.version);
});
