// Publication jobs, increment 1 (dry run): preflight, permissions, dispatch, signed callbacks, idempotency, failure and recovery.
// Real SQL (PGlite), the real authorisation path, a fake GitHub that records every call. Nothing here can publish.
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { draftPhotosRoute, draftPublishRoute, draftRoute, draftVerifyRoute, publishCallbackRoute, publishPayloadRoute } from '../api/_lib/routes.js';
import { reconcile, sanitiseEvent } from '../api/_lib/publication.js';
import * as jobsRepo from '../api/_lib/jobs-repo.js';
import { ALI, ALI_N, EDITOR, GH_TOKEN, ID_7B, PUBLISHER, PUBLISH_ENV, SECRET, VIEWER, call, callSigned, database, github, resetCaches, world } from './drafts-harness.js';

// built at run time so the repository scan for token-shaped strings stays meaningful
const FAKE_PAT = ['github', 'pat', '11ABCDEFG0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('_');
const GOOD = { title: 'Established Improved Liveability SDA Investment', description: 'An improved liveability SDA house in Exampleton with three participant places and onsite overnight assistance.', publicAddress: 'Wattle Street, Exampleton VIC 3999', pricingMode: 'contact_agent', displayPrice: '', featured: false };
const jpeg = (n, w = 1600) => sharp({ create: { width: w + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const upload = (w, db, bytes, kind) => call(draftPhotosRoute, w, db, ALI_N, { method: 'POST', body: bytes, headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}${kind ? `&kind=${kind}` : ''}` });
const open = (w, db, who = ALI_N) => call(draftRoute, w, db, who, { url: `/api/listings/draft?id=${ID_7B}` });

/** A draft that is complete and has photographs (with one floorplan): everything a dry run needs. */
async function ready({ photos = true, content = GOOD } = {}) {
  resetCaches();
  const w = world(); const db = await database(); const gh = github(w);
  const c = await call(draftRoute, w, db, ALI_N, { method: 'POST', body: { propertyId: ID_7B } });
  assert.equal(c.status, 200);
  const s = await call(draftRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: c.json.draft.version, content } });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  if (photos) {
    await upload(w, db, await jpeg(1)); await upload(w, db, await jpeg(2)); const p3 = await upload(w, db, await jpeg(3), 'floorplan');
    const ids = p3.json.photos.items.map((p) => p.id);
    const g = await call(draftPhotosRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: p3.json.draft.version, photos: [{ id: ids[0], alt: 'Kitchen', kind: 'photo' }, { id: ids[1], alt: '', kind: 'photo' }, { id: ids[2], alt: '', kind: 'floorplan' }] } });
    assert.equal(g.status, 200);
  }
  return { w, db, gh };
}
const version = async (db) => (await db.unsafe('select version from listings.drafts where public_id = $1', [ID_7B]))[0].version;
const start = async (ctx, who = ALI_N, over = {}) => call(draftPublishRoute, ctx.w, ctx.db, who, { method: 'POST', fetch: ctx.gh.fetch, env: over.env ?? PUBLISH_ENV, body: { id: ID_7B, expectedVersion: over.expectedVersion ?? await version(ctx.db), mode: over.mode ?? 'dry_run' } });
const jobs = (db) => db.unsafe('select * from listings.publish_jobs order by created_at');
const event = (jobId, step, status, detail) => JSON.stringify({ jobId, step, status, ...(detail ? { detail } : {}) });
const send = (ctx, jobId, step, status, detail, over = {}) => callSigned(publishCallbackRoute, ctx.db, { method: 'POST', url: '/api/listings/publish-callback', body: event(jobId, step, status, detail), secret: SECRET, ...over });

test('only a Publisher can start a dry run; Editors, Viewers and anonymous callers cannot, and nothing is recorded or dispatched', async () => {
  const ctx = await ready();
  for (const who of [EDITOR, VIEWER]) assert.equal((await start(ctx, who)).status, 403);
  assert.equal((await call(draftPublishRoute, ctx.w, ctx.db, ALI_N, { method: 'POST', headers: { authorization: '' }, fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_7B, expectedVersion: 1, mode: 'dry_run' } })).status, 401);
  assert.equal((await jobs(ctx.db)).length, 0);
  assert.equal(ctx.gh.dispatches.length, 0);
  assert.equal((await call(draftPublishRoute, ctx.w, ctx.db, VIEWER, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV })).status, 200, 'everyone with access can read the history');
});

test('PREFLIGHT: an incomplete draft or no photographs stops the dry run with plain reasons, before any job exists', async () => {
  const noPhotos = await ready({ photos: false });
  const a = await start(noPhotos);
  assert.equal(a.status, 409); assert.equal(a.json.error, 'not_ready');
  assert.ok(a.json.reasons.some((r) => /photograph/i.test(r)));
  const incomplete = await ready({ content: { ...GOOD, description: '' } });
  const c = await start(incomplete);
  assert.ok(c.json.reasons.some((r) => /required fields/i.test(r)));
  for (const ctx of [noPhotos, incomplete]) { assert.equal((await jobs(ctx.db)).length, 0); assert.equal(ctx.gh.dispatches.length, 0); }
});

test('missing or weak server configuration fails closed with 503 and records nothing', async () => {
  const ctx = await ready();
  for (const env of [{}, { LISTINGS_CALLBACK_SECRET: SECRET }, { LISTINGS_GITHUB_DISPATCH_TOKEN: GH_TOKEN }, { ...PUBLISH_ENV, LISTINGS_CALLBACK_SECRET: 'short' }]) {
    const r = await start(ctx, ALI_N, { env });
    assert.equal(r.status, 503); assert.equal(r.json.error, 'not_configured');
  }
  assert.equal((await jobs(ctx.db)).length, 0);
  assert.equal(ctx.gh.dispatches.length, 0);
});

test('only dry_run, publish and update are enabled: withdraw and anything else is refused before anything is recorded', async () => {
  const ctx = await ready();
  for (const mode of ['withdraw', '', undefined, 'DROP TABLE', 'PUBLISH']) {
    const r = await start(ctx, ALI_N, { mode: mode ?? 'x' });
    assert.equal(r.status, 400); assert.equal(r.json.error, 'mode_not_enabled');
  }
  assert.equal((await jobs(ctx.db)).length, 0); assert.equal(ctx.gh.dispatches.length, 0);
});

test('START: a ready draft records a job, freezes ONLY the approved public content, and asks GitHub to start the workflow (the token goes out, never back)', async () => {
  const ctx = await ready();
  const r = await start(ctx);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.job.status, 'dispatched'); assert.equal(r.json.job.kind, 'dry_run'); assert.equal(r.json.existing, false);
  assert.equal(ctx.gh.dispatches.length, 1);
  const d = ctx.gh.dispatches[0];
  assert.match(d.url, /\/repos\/o\/r\/actions\/workflows\/publish-listing\.yml\/dispatches$/);
  assert.deepEqual(d.body, { ref: 'main', inputs: { job_id: r.json.job.id, public_id: ID_7B, mode: 'dry_run' } });
  assert.equal(d.headers.Authorization, `Bearer ${GH_TOKEN}`, 'the token is sent to GitHub only');
  for (const secret of [GH_TOKEN, SECRET, 'ghp_']) assert.ok(!r.raw.includes(secret), 'no credential in the response');
  const [row] = await jobs(ctx.db);
  assert.equal(row.requested_by, ALI_N.email); assert.equal(row.approver_notion_user_id, ALI_N.notionUserId);
  const text = JSON.stringify(row.payload);
  // public content only: nothing internal
  for (const internal of ['7B Wattle', '1234567', 'Operating SDA property', '402909c1', 'sharepoint', 'occupied']) assert.ok(!text.includes(internal), `payload leaks ${internal}`);
  assert.equal(row.payload.content.publicAddress, 'Wattle Street, Exampleton VIC 3999');
  assert.equal(row.payload.content.pricingMode, 'contact_agent');
  assert.equal(row.payload.manifest.photos.length, 3);
  assert.ok(row.payload.manifest.photos.every((p) => p.privacyReviewed === true && /^[a-f0-9]{12}$/.test(p.id)), 'photographs are approved with the listing (the automatic checks passed in preflight)');
  assert.deepEqual(row.payload.manifest.photos.map((p) => p.kind ?? 'photo'), ['photo', 'photo', 'floorplan'], 'cover first, floorplan last, same order as the draft');
  assert.deepEqual(row.payload.manifest.photos.map((p) => p.alt), ['Kitchen', '', ''], 'short and empty descriptions stay as typed (the website adds the neutral fallback)');
  // the Listings Manager is the authority: the approval travels with the payload, with a display name (never an email) for the public snapshot
  assert.equal(row.payload.authority, 'listings_manager');
  assert.equal(row.payload.approver.id, ALI_N.notionUserId); assert.equal(row.payload.approver.name, 'SDA Home Choices');
  assert.ok(!JSON.stringify(row.payload.approver).includes('@'), 'no email address in the approver that reaches the public snapshot');
  assert.equal(row.payload.approval.by, ALI_N.email); assert.ok(row.payload.approval.at);
  assert.ok(!('galleryReview' in row.payload), 'no gallery review is part of the payload');
  // a dry run never touches Notion or any public store
  assert.ok(ctx.w.calls.every((c) => c.method === 'GET' || /\/query|\/dispatches/.test(c.url)), JSON.stringify(ctx.w.calls.filter((c) => c.method !== 'GET').map((c) => c.url)));
});

test('IDEMPOTENT: asking again for the same draft version returns the same job and does not dispatch twice; a new version needs the old job to finish', async () => {
  const ctx = await ready();
  const a = await start(ctx); const b = await start(ctx);
  assert.equal(b.json.job.id, a.json.job.id); assert.equal(b.json.existing, true);
  assert.equal(ctx.gh.dispatches.length, 1); assert.equal((await jobs(ctx.db)).length, 1);
  // double click at the same moment: still one job
  const [x, y] = await Promise.all([start(ctx), start(ctx)]);
  assert.ok([x, y].every((r) => r.status === 200 && r.json.job.id === a.json.job.id));
  assert.equal(ctx.gh.dispatches.length, 1);
  // another person or a new draft version cannot start a second ACTIVE job for the same listing
  await db_touch(ctx);
  const c = await start(ctx);
  assert.equal(c.status, 409); assert.equal(c.json.error, 'job_active');
  assert.equal(ctx.gh.dispatches.length, 1);
});
async function db_touch(ctx) { // a new version of the draft (a title edit)
  const v = await version(ctx.db);
  const r = await call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: v, content: { ...GOOD, title: 'Established Improved Liveability SDA Investment, edited' } } });
  assert.equal(r.status, 200); return r;
}

test('the database allows only one active job per listing, and jobs are never deleted', async () => {
  const ctx = await ready();
  await start(ctx);
  const [row] = await jobs(ctx.db);
  await assert.rejects(ctx.db.unsafe(`insert into listings.publish_jobs (public_id, draft_id, draft_version, kind, payload, payload_hash, requested_by, idempotency_key) values ($1,$2,9,'dry_run','{}','h','x','k-other')`, [ID_7B, row.draft_id]), /publish_jobs_one_active_per_listing|unique/);
  await ctx.db.raw.exec("set role listings_app");
  await assert.rejects(ctx.db.raw.exec('delete from listings.publish_jobs'), /permission denied/);
  await ctx.db.raw.exec('reset role');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await ctx.db.raw.exec(`set role ${role}`);
    await assert.rejects(ctx.db.raw.query('select * from listings.publish_jobs'), /permission denied/, role);
    await ctx.db.raw.exec('reset role');
  }
});

test('DISPATCH FAILURE: a refused token, a missing workflow or an unreachable GitHub fails the job with a clear reason, leaks nothing, and retry makes attempt 2', async () => {
  const ctx = await ready();
  for (const [status, re] of [[401, /not valid \(expired, revoked or mistyped\)/], [404, /not found for this token/], [422, /on the main branch/], ['throw', /could not be reached/]]) {
    ctx.gh.status = status;
    const r = await start(ctx);
    assert.equal(r.status, 502); assert.equal(r.json.error, 'dispatch_failed'); assert.match(r.json.reason, re);
    assert.equal(r.json.job.status, 'failed'); assert.equal(r.json.job.error.code, 'dispatch_failed');
    for (const secret of [GH_TOKEN, SECRET]) assert.ok(!r.raw.includes(secret));
  }
  const rows = await jobs(ctx.db);
  assert.equal(rows.length, 4); assert.deepEqual(rows.map((j) => j.attempt), [1, 2, 3, 4]); assert.ok(rows.every((j) => j.status === 'failed'));
  ctx.gh.status = 204;
  const ok = await start(ctx);
  assert.equal(ok.status, 200); assert.equal(ok.json.job.attempt, 5); assert.equal(ok.json.job.status, 'dispatched');
});

test('THE REPORTED INCIDENT: a valid token without "Actions: Read and write" is reported exactly (HTTP 403, GitHub\'s message, the permission needed) and the credential never appears anywhere', async () => {
  const { setAuditSink } = await import('../api/_lib/audit.js');
  const lines = []; setAuditSink((l) => lines.push(l));
  const ctx = await ready();
  ctx.gh.status = 403; ctx.gh.accepted = 'actions=write';
  ctx.gh.body = { message: `Resource not accessible by personal access token (sent ${GH_TOKEN} as Bearer ${GH_TOKEN} ${FAKE_PAT})` };
  const r = await start(ctx);
  assert.equal(r.status, 502); assert.equal(r.json.error, 'dispatch_failed');
  assert.match(r.json.reason, /does not have "Actions: Read and write"/);
  assert.match(r.json.reason, /GitHub HTTP 403: Resource not accessible by personal access token/);
  assert.match(r.json.reason, /needs actions=write/);
  assert.equal(r.json.githubStatus, 403);
  assert.match(r.json.job.error.message, /Actions: Read and write/, 'the job history says the same');
  const hist = await call(draftPublishRoute, ctx.w, ctx.db, VIEWER, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch });
  const everything = [r.raw, hist.raw, lines.join('\n'), JSON.stringify(await jobs(ctx.db))].join('\n');
  for (const secret of [GH_TOKEN, SECRET, FAKE_PAT, 'Bearer ' + GH_TOKEN]) assert.ok(!everything.includes(secret), `a credential leaked: ${secret.slice(0, 12)}`);
  assert.ok(lines.some((l) => /"githubStatus":403/.test(l)), 'the audit log records the exact status');
  assert.ok(!/authorization/i.test(lines.join('')), 'no Authorization header in the log');
  // after the permission is fixed on GitHub, the next attempt simply works (no new credential, no redeploy)
  ctx.gh.status = 204; ctx.gh.body = {}; ctx.gh.accepted = null;
  const ok = await start(ctx);
  assert.equal(ok.status, 200); assert.equal(ok.json.job.attempt, 2); assert.equal(ok.json.job.status, 'dispatched');
});

test('OTHER GITHUB REFUSALS stay distinguishable: an invalid token, a 403 that is not a permission problem, a hidden repository', async () => {
  const ctx = await ready();
  const cases = [[401, 'Bad credentials', null, /not valid/], [403, 'API rate limit exceeded', null, /^GitHub refused the request\. \(GitHub HTTP 403: API rate limit exceeded\)$/], [404, 'Not Found', null, /not found for this token/]];
  for (const [status, message, accepted, re] of cases) {
    ctx.gh.status = status; ctx.gh.body = { message }; ctx.gh.accepted = accepted;
    const r = await start(ctx);
    assert.match(r.json.reason, re); assert.ok(r.json.reason.includes(`GitHub HTTP ${status}`)); assert.ok(!r.raw.includes(GH_TOKEN));
  }
});

test('NOTION CHANGED: a draft whose Notion record moved since it was based on it must be reviewed and saved first', async () => {
  const ctx = await ready();
  const { page7B } = await import('./drafts-harness.js');
  ctx.w.state.page7B = page7B({ 'Gross income': { type: 'number', number: 150000 } }); resetCaches();
  const r = await start(ctx);
  assert.equal(r.status, 409); assert.ok(r.json.reasons.some((x) => /Notion record changed/.test(x)));
  assert.equal(ctx.gh.dispatches.length, 0);
});

test('A STALE VERSION is refused: what the Publisher looked at must be what is approved', async () => {
  const ctx = await ready();
  const v = await version(ctx.db);
  await db_touch(ctx);
  const r = await start(ctx, ALI_N, { expectedVersion: v });
  assert.equal(r.status, 409); assert.equal(r.json.error, 'draft_changed');
  assert.equal((await jobs(ctx.db)).length, 0);
});

test('SIGNED CALLBACKS: progress is recorded in order; the job survives a closed browser (state is in the database, readable by a fresh request)', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  assert.equal((await send(ctx, job.id, 'started', 'running')).status, 200);
  await send(ctx, job.id, 'payload', 'ok', { photos: 3 });
  await send(ctx, job.id, 'engine', 'ok', { kind: 'new', version: 1, slug: 'wattle-street-exampleton-vic', checks: [{ name: 'engine_accepts', ok: true, note: 'Proposed new v1.' }] });
  const mid = await call(draftPublishRoute, ctx.w, ctx.db, VIEWER, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch });
  assert.equal(mid.json.active.status, 'running'); assert.equal(mid.json.active.step, 'engine');
  assert.deepEqual(mid.json.active.steps.map((s) => s.step), ['requested', 'dispatched', 'started', 'payload', 'engine']);
  const fin = await send(ctx, job.id, 'finished', 'succeeded', { dryRun: true, slug: 'wattle-street-exampleton-vic', kind: 'new', version: 1, photos: 3, contentHash: 'a'.repeat(64), checks: [{ name: 'site_tests', ok: true, note: 'ok' }], wouldBlock: ['approver_authorised'] });
  assert.equal(fin.status, 200);
  const done = await call(draftPublishRoute, ctx.w, ctx.db, VIEWER, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch });
  assert.equal(done.json.active, null);
  assert.equal(done.json.jobs[0].status, 'succeeded'); assert.equal(done.json.jobs[0].result.dryRun, true); assert.deepEqual(done.json.jobs[0].result.wouldBlock, ['approver_authorised']);
  // a finished job is immutable: late or repeated events are ignored
  const late = await send(ctx, job.id, 'engine', 'failed', { code: 'x' });
  assert.equal(late.status, 200); assert.equal(late.json.ignored, true);
  assert.equal((await jobsRepo.getJob(ctx.db, job.id)).status, 'succeeded');
  // and a succeeded dry run is returned again, not repeated
  const again = await start(ctx);
  assert.equal(again.json.existing, true); assert.equal(ctx.gh.dispatches.length, 1);
});

test('A FAILED JOB records the reason and the engine issues, and the listing can be retried as a new attempt', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  await send(ctx, job.id, 'engine', 'failed', { kind: 'failed', issues: ['Victorian pricing compliance is not cleared for "contact_agent"'], checks: [{ name: 'approver_authorised', ok: false, note: 'not on the list' }] });
  await send(ctx, job.id, 'finished', 'failed', { code: 'engine_refused', message: 'the engine would not publish this listing (failed, 1 issue(s))' });
  const v = (await call(draftPublishRoute, ctx.w, ctx.db, VIEWER, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch })).json;
  assert.equal(v.jobs[0].status, 'failed'); assert.equal(v.jobs[0].error.code, 'engine_refused');
  assert.match(v.jobs[0].steps.find((s) => s.step === 'engine').detail.issues[0], /Victorian pricing compliance/);
  const retry = await start(ctx);
  assert.equal(retry.status, 200); assert.equal(retry.json.job.attempt, 2); assert.equal(ctx.gh.dispatches.length, 2);
});

test('CALLBACK SECURITY: no signature, a wrong secret, a tampered body, a stale or future timestamp, and an unconfigured server are all refused and change nothing', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  const body = event(job.id, 'started', 'running');
  const post = (over) => callSigned(publishCallbackRoute, ctx.db, { method: 'POST', url: '/api/listings/publish-callback', body, secret: SECRET, ...over });
  assert.equal((await post({ secret: undefined })).status, 401);
  assert.equal((await post({ secret: 'another-secret-another-secret-another-0123' })).status, 401);
  assert.equal((await post({ tamper: body.replace('started', 'finished') })).status, 401);
  assert.equal((await post({ now: Date.now() - 6 * 60 * 1000 })).status, 401, 'stale');
  assert.equal((await post({ now: Date.now() + 6 * 60 * 1000 })).status, 401, 'future');
  assert.equal((await post({ env: {} })).status, 503);
  assert.equal((await post({ env: { LISTINGS_CALLBACK_SECRET: 'short' } })).status, 503);
  assert.equal((await post({})).status, 200);
  assert.equal((await jobsRepo.getJob(ctx.db, job.id)).steps.length, 3, 'only the one valid event was recorded (requested, dispatched, started)');
  assert.equal((await callSigned(publishCallbackRoute, ctx.db, { method: 'GET', url: '/api/listings/publish-callback', secret: SECRET })).status, 405);
});

test('CALLBACK INPUT: unknown jobs, steps and statuses are refused; the detail is reduced to known, bounded fields', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  assert.equal((await send(ctx, '99999999-9999-4999-8999-999999999999', 'started', 'running')).status, 404);
  assert.equal((await send(ctx, job.id, 'rm -rf', 'running')).status, 400);
  assert.equal((await send(ctx, job.id, 'started', 'exploded')).status, 400);
  assert.equal((await send(ctx, 'not-a-uuid', 'started', 'running')).status, 400);
  const clean = sanitiseEvent({ jobId: job.id, step: 'engine', status: 'ok', detail: { slug: '../../etc', contentHash: 'zz', evil: '<script>', message: 'm'.repeat(1000), issues: Array.from({ length: 50 }, () => 'i'.repeat(500)), checks: [{ name: 'a b!c', ok: 'yes', note: 'n'.repeat(5000) }, null], dryRun: 'true', code: 'a-b c!' } });
  assert.deepEqual(Object.keys(clean.detail).sort(), ['checks', 'code', 'issues', 'message']);
  assert.equal(clean.detail.message.length, 300); assert.equal(clean.detail.issues.length, 20); assert.equal(clean.detail.issues[0].length, 300);
  assert.deepEqual(clean.detail.checks, [{ name: 'abc', ok: false, note: 'n'.repeat(1500) }]);
  assert.equal(clean.detail.code, 'abc');
  // event flood on one job is capped
  for (let i = 0; i < 70; i += 1) await send(ctx, job.id, 'tests', 'running');
  assert.ok((await jobsRepo.getJob(ctx.db, job.id)).steps.length <= 60);
});

test('PAYLOAD: served only to a signed request for an ACTIVE job; the signature is bound to the job; never after it finished', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  const url = `/api/listings/publish-payload?job=${job.id}`;
  const ok = await callSigned(publishPayloadRoute, ctx.db, { url, secret: SECRET });
  assert.equal(ok.status, 200); assert.equal(ok.json.publicId, ID_7B); assert.equal(ok.json.mode, 'dry_run'); assert.equal(ok.json.jobId, job.id);
  assert.equal((await callSigned(publishPayloadRoute, ctx.db, { url })).status, 401, 'unsigned');
  assert.equal((await callSigned(publishPayloadRoute, ctx.db, { url, secret: 'another-secret-another-secret-another-0123' })).status, 401);
  const other = `/api/listings/publish-payload?job=99999999-9999-4999-8999-999999999999`;
  const { signedHeaders } = await import('../api/_lib/signing.js');
  const replay = await publishPayloadRoute({ db: ctx.db, env: { LISTINGS_CALLBACK_SECRET: SECRET } });
  const r = (await import('./helpers.js')).res();
  await replay({ method: 'GET', url: other, headers: signedHeaders(SECRET, `GET:${url}`) }, r);
  assert.equal(r.statusCode, 401, 'a signature for one job cannot read another');
  assert.equal((await callSigned(publishPayloadRoute, ctx.db, { url: other, secret: SECRET })).status, 404);
  assert.equal((await callSigned(publishPayloadRoute, ctx.db, { url: '/api/listings/publish-payload?job=x', secret: SECRET })).status, 400);
  await send(ctx, job.id, 'finished', 'succeeded', { dryRun: true });
  assert.equal((await callSigned(publishPayloadRoute, ctx.db, { url, secret: SECRET })).status, 410, 'gone once finished');
});

test('RECOVERY: a run that ended without reporting, a run that finished without its result arriving, and a job that never finishes are all closed out; a finished job is never touched', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  const publish = { githubToken: GH_TOKEN, workflow: 'publish-listing.yml' };
  const R = (j, now, runs) => { ctx.gh.runs = runs; return reconcile(j, { db: ctx.db, publish, repo: 'o/r', fetchImpl: ctx.gh.fetch, now }); };
  const row = () => jobsRepo.getJob(ctx.db, job.id);
  const t0 = new Date((await row()).updated_at).getTime();
  assert.equal((await R(await row(), t0 + 60 * 1000, [])).status, 'dispatched', 'too soon to judge');
  assert.equal((await R(await row(), t0 + 3 * 60 * 1000, [{ id: 7, html_url: 'https://github.com/x/runs/7', display_title: `publish ${job.id}`, status: 'in_progress', conclusion: null }])).status, 'dispatched', 'still running: leave it');
  assert.equal(Number((await row()).run_id), 7, 'the run is linked');
  const failed = await R(await row(), t0 + 3 * 60 * 1000, [{ id: 7, html_url: 'https://github.com/x/runs/7', display_title: `publish ${job.id}`, status: 'completed', conclusion: 'failure' }]);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error_code, 'workflow_ended'); assert.match(failed.error_message, /failure/);
  assert.equal((await R(failed, t0 + 99 * 60 * 1000, [])).status, 'failed', 'a finished job is never changed');
  // finished successfully but the report never arrived
  const retry = (await start(ctx)).json.job;
  const t1 = new Date((await jobsRepo.getJob(ctx.db, retry.id)).updated_at).getTime();
  const noReport = await reconcile(await jobsRepo.getJob(ctx.db, retry.id), { db: ctx.db, publish, repo: 'o/r', fetchImpl: (u, o) => { ctx.gh.runs = [{ id: 8, html_url: 'u', display_title: `publish ${retry.id}`, status: 'completed', conclusion: 'success' }]; return ctx.gh.fetch(u, o); }, now: t1 + 5 * 60 * 1000 });
  assert.equal(noReport.error_code, 'no_report');
  // timed out
  const third = (await start(ctx)).json.job;
  const t2 = new Date((await jobsRepo.getJob(ctx.db, third.id)).created_at).getTime();
  assert.equal((await reconcile(await jobsRepo.getJob(ctx.db, third.id), { db: ctx.db, publish: null, repo: 'o/r', fetchImpl: ctx.gh.fetch, now: t2 + 26 * 60 * 1000 })).error_code, 'timed_out');
  // a failed listing can be tried again straight away
  assert.equal((await start(ctx)).status, 200);
});

test('RECOVERY on read: opening the history closes out a run that ended silently, without anyone clicking anything', async () => {
  const ctx = await ready();
  const { job } = (await start(ctx)).json;
  await ctx.db.unsafe("update listings.publish_jobs set updated_at = now() - interval '5 minutes' where id = $1", [job.id]);
  ctx.gh.runs = [{ id: 11, html_url: 'https://github.com/x/runs/11', display_title: `publish ${job.id}`, status: 'completed', conclusion: 'cancelled' }];
  const v = await call(draftPublishRoute, ctx.w, ctx.db, VIEWER, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV, fetch: ctx.gh.fetch });
  assert.equal(v.json.jobs[0].status, 'failed'); assert.equal(v.json.jobs[0].error.code, 'workflow_ended'); assert.equal(v.json.active, null);
});

test('ACCEPTANCE WITH A SOURCE: a Publisher records the accepted occupancy position with a link to the approved marketing reference; invalid links are refused', async () => {
  const ctx = await ready();
  const v1 = await version(ctx.db);
  const verify = (body, who = ALI_N) => call(draftVerifyRoute, ctx.w, ctx.db, who, { method: 'POST', body: { id: ID_7B, expectedVersion: body.expectedVersion ?? v1, code: 'occupancy_not_full', note: 'Accepted: the SDAHC advertisement prepared by Ali is the approved marketing reference', ...body } });
  for (const bad of ['javascript:alert(1)', 'http://insecure.example.test/x', 'https://x y', 'ftp://x', `https://a.test/${'x'.repeat(400)}`]) assert.equal((await verify({ source: bad })).status, 400, bad);
  assert.equal((await verify({ source: 'https://www.realcommercial.com.au/for-sale/property-example', expectedVersion: v1 }, EDITOR)).status, 403, 'only a Publisher');
  const ok = await verify({ source: 'https://www.realcommercial.com.au/for-sale/property-example' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const item = ok.json.verification.system.find((i) => i.code === 'occupancy_not_full');
  assert.equal(item.status, 'verified'); assert.equal(item.verifiedBy, ALI_N.email); assert.equal(item.source, 'https://www.realcommercial.com.au/for-sale/property-example');
  assert.equal(ok.json.history[0].action, 'verify');
  // the CRM fact is preserved, not overwritten: Notion is only read
  assert.ok(ctx.w.calls.every((c) => c.method === 'GET' || /\/query/.test(c.url)));
  const fresh = await open(ctx.w, ctx.db, VIEWER);
  assert.equal(fresh.json.property.occupancy.occupied, 2, 'the internal CRM fact is untouched');
  assert.equal(fresh.json.verification.open, 0);
});

test('BROWSER FILES hold no credentials, no signing code and no GitHub token name', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['listings.js', 'listings.css', 'index.html']) {
    const s = readFileSync(f, 'utf8');
    for (const re of [/LISTINGS_GITHUB_DISPATCH_TOKEN/, /LISTINGS_CALLBACK_SECRET/, /x-listings-signature/, /api\.github\.com/, /ghp_[A-Za-z0-9]/, /github_pat_/, /createHmac/]) assert.ok(!re.test(s), `${f} matches ${re}`);
  }
});

test('REVIEW SCREEN: a third tab, read-only polling, a dry run, and a confirmed publish that asks for publish or update only', async () => {
  const { readFileSync } = await import('node:fs');
  const code = readFileSync('listings.js', 'utf8');
  assert.match(code, /\(\\\/preview\|\\\/review\)\?\$/);
  assert.match(code, /text: 'Review & publish'/);
  assert.match(code, /mode: 'dry_run'/);
  assert.ok(!/mode: 'withdraw'/.test(code), 'withdrawal is not offered by the browser');
  assert.match(code, /mode: kind/); assert.match(code, /'update' : 'publish'/);
  // publishing needs a second, explicit confirmation; the first button only opens it
  assert.match(code, /id: 'ls-publish-btn'[^]*LS\.confirmPublish = true/); assert.match(code, /id: 'ls-publish-confirm', onclick: lsStartPublish/);
  const startFn = code.slice(code.indexOf('async function lsStartPublish'), code.indexOf('function reviewContent'));
  assert.ok(/lsApi\('POST'/.test(startFn) && !/setInterval|setTimeout/.test(startFn));
  // Live is shown only from the server's verified record (jobs.live), never from the browser's own guess
  assert.match(code, /const live = jobs && jobs\.live;/); assert.ok(!/LS\.live\s*=\s*true|isLive\s*=\s*true/.test(code));
  // polling reads only: the one function that repeats is a GET
  const poll = code.slice(code.indexOf('function lsSchedulePoll'), code.indexOf('function lsRefreshReview'));
  assert.ok(/lsLoadJobs\(\)/.test(poll) && !/lsApi\('(POST|PUT|DELETE)'/.test(poll));
  const load = code.slice(code.indexOf('async function lsLoadJobs'), code.indexOf('/* Polling only READS'));
  assert.match(load, /lsApi\('GET', '\/api\/listings\/draft-publish\?id='/);
  // links from the server render only when they are https
  assert.match(code, /\/\^https:\\\/\\\/github\\\.com\\\//);
  assert.match(code, /i\.source && \/\^https:\\\/\\\//);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(code));
});

test('the status read marks nothing as Live: a dry run never changes the dashboard columns (Notion status, Website, deployment)', async () => {
  const ctx = await ready();
  const { listRoute } = await import('../api/_lib/routes.js');
  const before = (await call(listRoute, ctx.w, ctx.db, VIEWER, { env: PUBLISH_ENV })).json.listings.find((l) => l.id === ID_7B);
  const { job } = (await start(ctx)).json;
  await send(ctx, job.id, 'finished', 'succeeded', { dryRun: true, slug: 'wattle-street-exampleton-vic' });
  const after = (await call(listRoute, ctx.w, ctx.db, VIEWER, { env: PUBLISH_ENV })).json.listings.find((l) => l.id === ID_7B);
  assert.deepEqual(after.deployment, before.deployment); assert.equal(after.website, null); assert.equal(after.notion?.statusKey ?? null, before.notion?.statusKey ?? null);
  assert.equal(after.deployment.state, 'not_published');
});

test('TOKEN CHECK SCRIPT: separates an invalid token, no repository access, a missing Actions permission and a good token; never prints the token', async () => {
  const { checkToken } = await import('../scripts/check-github-dispatch-token.mjs');
  const T = GH_TOKEN;
  const world = (repo, wf, dispatch) => async (url, opts = {}) => {
    const u = String(url); const pick = u.includes('/dispatches') ? dispatch : u.includes('/actions/workflows/') ? wf : repo;
    return { status: pick[0], ok: pick[0] < 300, json: async () => ({ message: pick[1] }), headers: { get: (k) => (/accepted/.test(k) ? pick[2] ?? null : /expiration/.test(k) ? '2026-12-08 15:55:26 UTC' : null) } };
  };
  const run = (...a) => checkToken({ token: T, fetchImpl: world(...a) });
  const a = await run([401, 'Bad credentials'], [401, 'Bad credentials'], [401, 'Bad credentials']);
  assert.match(a.verdict, /^INVALID/);
  assert.match((await run([404, 'Not Found'], [404, 'Not Found'], [404, 'Not Found'])).verdict, /^NO ACCESS/);
  assert.match((await run([200, ''], [404, 'Not Found'], [404, 'Not Found'])).verdict, /^WORKFLOW NOT FOUND/);
  const perm = await run([200, ''], [200, ''], [403, `Resource not accessible by personal access token ${T}`, 'actions=write']);
  assert.match(perm.verdict, /^MISSING PERMISSION: .*Actions: Read and write/); assert.equal(perm.dispatch.needs, 'actions=write'); assert.equal(perm.ok, false);
  const good = await run([200, ''], [200, ''], [422, 'No ref found for: token-check-no-such-ref-nothing-will-run']);
  assert.equal(good.ok, true); assert.match(good.verdict, /Nothing was started/); assert.equal(good.expires, '2026-12-08 15:55:26 UTC');
  assert.ok(!JSON.stringify([a, perm, good]).includes(T), 'the token is never in the output');
  // it can never start a run: the ref it asks for does not exist, and it sends no other write
  const calls = []; await checkToken({ token: T, fetchImpl: async (u, o = {}) => { calls.push([o.method, String(u), o.body]); return { status: 422, json: async () => ({}), headers: { get: () => null } }; } });
  assert.deepEqual(calls.map((c) => c[0]), ['GET', 'GET', 'POST']);
  assert.match(calls[2][2], /token-check-no-such-ref-nothing-will-run/);
});

/* ---------------------------------------------------------------- real publication (publish, update) */
import { promoteMedia, publicPath } from '../api/_lib/public-media.js';
const startReal = (ctx, mode = 'publish', over = {}) => start(ctx, ALI_N, { mode, ...over });
const history = async (ctx, who = ALI_N) => (await call(draftPublishRoute, ctx.w, ctx.db, who, { url: `/api/listings/draft-publish?id=${ID_7B}`, env: PUBLISH_ENV })).json;
const SHA40 = 'a'.repeat(40);
const finishLive = async (ctx, jobId, over = {}) => {
  for (const step of ['started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'media', 'pull_request', 'checks', 'merge', 'deploy', 'verify']) await send(ctx, jobId, step, 'ok');
  return send(ctx, jobId, 'finished', 'succeeded', { dryRun: false, live: true, slug: 'wattle-street-exampleton-vic', kind: 'publish', version: 1, url: 'https://sdahomechoices.com.au/opportunities/wattle-street-exampleton-vic/', mergeCommit: SHA40, photos: 3, ...over });
};

test('PUBLISH: a Publisher copies exactly the approved images (and the manifest) to the public store, then the workflow starts in publish mode', async () => {
  const ctx = await ready();
  const r = await startReal(ctx);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.job.kind, 'publish'); assert.equal(r.json.job.status, 'dispatched');
  assert.equal(ctx.gh.dispatches.length, 1); assert.equal(ctx.gh.dispatches[0].body.inputs.mode, 'publish');
  const paths = [...ctx.w.publicBlob.mem.keys()].sort();
  assert.ok(paths.length >= 4, 'three photographs with their widths plus the manifest');
  assert.ok(paths.every((p) => new RegExp(`^${ID_7B}/([a-f0-9]{12}-\\d{2,4}\\.webp|manifest\\.json)$`).test(p)), 'nothing outside <public id>/<hash>-<width>.webp and manifest.json is ever written: ' + paths.join());
  for (const [p, v] of ctx.w.publicBlob.mem) {
    if (p.endsWith('.webp')) { assert.equal(v.type, 'image/webp'); assert.equal(v.b.toString('ascii', 8, 12), 'WEBP'); assert.ok(v.ttl >= 86400); }
  }
  const manifest = JSON.parse(ctx.w.publicBlob.mem.get(`${ID_7B}/manifest.json`).b.toString());
  const approved = (await jobsRepo.getJob(ctx.db, r.json.job.id, { withPayload: true })).payload.manifest;
  assert.deepEqual(manifest.photos.map((p) => p.id), approved.photos.map((p) => p.id), 'the public manifest lists the approved photographs in the approved order');
  assert.ok(manifest.photos.every((p) => p.privacyReviewed === true && p.files.every((f) => f.file.startsWith(p.id))));
  assert.ok((await history(ctx)).jobs[0].steps.some((s) => s.step === 'media_copy' && s.status === 'ok'));
  assert.ok(ctx.w.publicBlob.mem.size === paths.length && ![...ctx.w.blob.mem.keys()].some((k) => !k.startsWith('listings-staging/')), 'the private staging store is only read, never rewritten');
});

test('PUBLISH is for Publishers only, needs the public store configured, and a dry run never touches the public store', async () => {
  const ctx = await ready();
  for (const who of [EDITOR, VIEWER]) assert.equal((await start(ctx, who, { mode: 'publish' })).status, 403);
  const noStore = await call(draftPublishRoute, { ...ctx.w, publicBlob: undefined }, ctx.db, ALI_N, { method: 'POST', fetch: ctx.gh.fetch, env: PUBLISH_ENV, body: { id: ID_7B, expectedVersion: await version(ctx.db), mode: 'publish' } });
  assert.equal(noStore.status, 503); assert.equal(noStore.json.error, 'public_media_not_configured');
  assert.equal((await jobs(ctx.db)).length, 0); assert.equal(ctx.gh.dispatches.length, 0); assert.equal(ctx.w.publicBlob.mem.size, 0);
  assert.equal((await start(ctx)).status, 200);
  assert.equal(ctx.w.publicBlob.mem.size, 0, 'a dry run publishes no image');
});

test('MEDIA FAILURES stop the job before GitHub is asked: a missing staged image, a corrupt one, or a public store that is down; nothing half-public, retry works', async () => {
  const ctx = await ready();
  const staged = [...ctx.w.blob.mem.keys()].filter((k) => k.endsWith('.webp'));
  const keep = ctx.w.blob.mem.get(staged[0]); ctx.w.blob.mem.delete(staged[0]);
  const missing = await startReal(ctx);
  assert.equal(missing.status, 409); assert.equal(missing.json.error, 'media_failed'); assert.match(missing.json.reason, /missing|WebP/);
  ctx.w.blob.mem.set(staged[0], Buffer.from('not an image at all, really not'));
  assert.equal((await startReal(ctx)).json.error, 'media_failed');
  assert.equal(ctx.w.publicBlob.mem.size, 0, 'every image is verified before any is copied');
  ctx.w.blob.mem.set(staged[0], keep);
  ctx.w.publicBlob.fail = true;
  const down = await startReal(ctx);
  assert.equal(down.status, 502); assert.equal(down.json.error, 'media_failed');
  assert.equal(ctx.gh.dispatches.length, 0);
  assert.ok(!ctx.w.publicBlob.mem.has(`${ID_7B}/manifest.json`), 'the manifest is written last, so it never points at missing files');
  const all = await jobs(ctx.db);
  assert.equal(all.length, 3); assert.ok(all.every((j) => j.status === 'failed' && j.error_code === 'media_failed'));
  ctx.w.publicBlob.fail = false;
  const retry = await startReal(ctx);
  assert.equal(retry.status, 200); assert.equal(retry.json.job.attempt, 4); assert.equal(ctx.gh.dispatches.length, 1);
});

test('the public store wrapper refuses any path outside <public id>/<hash>-<width>.webp and <public id>/manifest.json', async () => {
  for (const [id, file] of [['lst_0123456789', '../x.webp'], ['lst_0123456789', 'a.webp'], ['lst_0123456789', 'index.html'], ['../lst_0123456789', 'manifest.json'], ['lst_0123456789/x', 'manifest.json'], ['', 'manifest.json'], ['lst_012345678', 'manifest.json']]) {
    assert.throws(() => publicPath(id, file), /public_path_refused|Error/, `${id} ${file}`);
  }
  assert.equal(publicPath('lst_0123456789', 'aabbccddeeff-960.webp'), 'lst_0123456789/aabbccddeeff-960.webp');
  const priv = { get: async () => Buffer.from('RIFF0000WEBPxxxx') }; const puts = []; const pub = { put: async (p) => puts.push(p) };
  await assert.rejects(promoteMedia({ publicId: 'lst_0123456789', manifest: { photos: [{ id: 'aabbccddeeff', files: [{ w: 480, file: '../../etc.webp' }] }] }, privateStore: priv, publicStore: pub }), (e) => e.code === 'media_failed' || e.message === 'media_failed');
  await assert.rejects(promoteMedia({ publicId: 'lst_0123456789', manifest: { photos: [{ id: 'aabbccddeeff', files: [{ w: 480, file: '112233445566-480.webp' }] }] }, privateStore: priv, publicStore: pub }), (e) => true, 'a file that does not belong to its photograph is refused');
  assert.equal(puts.length, 0);
});

test('LIVE only after verification: no job state short of a verified success marks the listing Live', async () => {
  const ctx = await ready();
  assert.equal((await history(ctx)).live, null);
  const dry = (await start(ctx)).json.job;
  await send(ctx, dry.id, 'finished', 'succeeded', { dryRun: true, slug: 'wattle-street-exampleton-vic' });
  assert.equal((await history(ctx)).live, null, 'a passed dry run is not Live');
  const a = (await startReal(ctx)).json.job;
  for (const step of ['started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'media', 'pull_request', 'checks', 'merge', 'deploy']) await send(ctx, a.id, step, 'ok');
  assert.equal((await history(ctx)).live, null, 'merged and deployed but not yet verified is not Live');
  await send(ctx, a.id, 'verify', 'failed', { issues: ['The listing page did not answer.'] });
  await send(ctx, a.id, 'finished', 'failed', { code: 'verify_failed', message: 'the live site does not yet serve the listing correctly' });
  const h = await history(ctx);
  assert.equal(h.live, null); assert.equal(h.jobs[0].status, 'failed');
  // success flagged live:false (or without live) is not Live either
  const b = (await startReal(ctx)).json.job;
  await finishLive(ctx, b.id, { live: false });
  assert.equal((await history(ctx)).live, null);
  const c = (await startReal(ctx)).json.job;
  await finishLive(ctx, c.id);
  const done = await history(ctx);
  assert.equal(done.live.jobId, c.id); assert.equal(done.live.url, 'https://sdahomechoices.com.au/opportunities/wattle-street-exampleton-vic/'); assert.equal(done.live.kind, 'publish');
});

test('RETRY after a failure at any step is safe: a new attempt is a new job on the same draft version and can still go live', async () => {
  const ctx = await ready();
  const a = (await startReal(ctx)).json.job;
  await send(ctx, a.id, 'checks', 'failed', { issues: ['The required check did not pass.'] });
  await send(ctx, a.id, 'finished', 'failed', { code: 'checks_failed', message: 'the required check did not pass' });
  const b = (await startReal(ctx)).json;
  assert.equal(b.existing, false); assert.equal(b.job.attempt, 2);
  await finishLive(ctx, b.job.id);
  const again = await startReal(ctx);
  assert.equal(again.json.existing, true, 'asking again for a version that is already live returns that job and does nothing');
  assert.equal(ctx.gh.dispatches.length, 2);
});

test('once live, a first publication is refused and an update is the way to change it; updates copy images again and dispatch update mode', async () => {
  const ctx = await ready();
  const a = (await startReal(ctx)).json.job; await finishLive(ctx, a.id);
  // a changed draft version
  const open1 = await open(ctx.w, ctx.db); const v = open1.json.draft.version;
  const saved = await call(draftRoute, ctx.w, ctx.db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: v, content: { ...GOOD, title: 'Established Improved Liveability SDA Investment, updated' } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const refused = await startReal(ctx, 'publish');
  assert.equal(refused.status, 409); assert.equal(refused.json.error, 'already_live');
  const before = ctx.w.publicBlob.mem.size;
  const u = await startReal(ctx, 'update');
  assert.equal(u.status, 200, JSON.stringify(u.json)); assert.equal(u.json.job.kind, 'update');
  assert.equal(ctx.gh.dispatches.at(-1).body.inputs.mode, 'update');
  assert.equal(ctx.w.publicBlob.mem.size, before, 'same content-hashed names: overwritten in place, no stray files');
  await send(ctx, u.json.job.id, 'finished', 'failed', { code: 'merge_refused', message: 'x' });
  assert.equal((await history(ctx)).live.jobId, a.id, 'a failed update leaves the earlier live record as it was');
});

test('CALLBACKS for the real steps: new steps are accepted, links only from github.com and the SDAHC site, ids only as 40 hex characters', async () => {
  const ev = (detail) => sanitiseEvent({ jobId: '11111111-1111-4111-8111-111111111111', step: 'verify', status: 'ok', detail });
  assert.equal(ev({ url: 'https://sdahomechoices.com.au/opportunities/a-b/', live: true, mergeCommit: SHA40, sha: SHA40, number: 7 }).detail.url, 'https://sdahomechoices.com.au/opportunities/a-b/');
  assert.equal(ev({ url: 'https://github.com/o/r/pull/7' }).detail.url, 'https://github.com/o/r/pull/7');
  for (const bad of ['http://sdahomechoices.com.au/x', 'https://evil.example/x', 'https://sdahomechoices.com.au.evil.example/x', 'javascript:alert(1)', 'https://github.com@evil.example/x', 'https://sdahomechoices.com.au/x" onclick="y']) assert.equal(ev({ url: bad, live: true })?.detail?.url, undefined, bad);
  assert.equal(ev({ mergeCommit: 'not-a-sha', sha: '123' }).detail, null);
  for (const step of ['media', 'pull_request', 'checks', 'merge', 'deploy', 'verify']) assert.doesNotThrow(() => sanitiseEvent({ jobId: '11111111-1111-4111-8111-111111111111', step, status: 'ok' }));
});

test('a real job that is stuck is closed out later than a dry run (40 minutes), and a late success after that is ignored but a retry recovers', async () => {
  const ctx = await ready();
  const a = (await startReal(ctx)).json.job;
  const row = await jobsRepo.getJob(ctx.db, a.id);
  const at = (min) => Date.now() + min * 60 * 1000;
  const same = await reconcile(row, { db: ctx.db, publish: { workflow: 'publish-listing.yml', githubToken: GH_TOKEN }, repo: 'o/r', fetchImpl: ctx.gh.fetch, now: at(30) });
  assert.ok(jobsRepo.isActive(same), 'at 30 minutes a real job is still allowed to run');
  const closed = await reconcile(row, { db: ctx.db, publish: null, repo: 'o/r', fetchImpl: ctx.gh.fetch, now: at(41) });
  assert.equal(closed.status, 'failed'); assert.equal(closed.error_code, 'timed_out');
  const late = await finishLive(ctx, a.id);
  assert.equal((await history(ctx)).live, null, 'a success report that arrives after the job was closed is ignored');
  const retry = await startReal(ctx);
  assert.equal(retry.status, 200); assert.equal(retry.json.job.attempt, 2);
  assert.ok(late);
});

test('MERGED BUT NOT VERIFIED: a failure after the merge is shown as merged-not-live, never as untouched and never as Live; publishing again recovers', async () => {
  const ctx = await ready();
  const a = (await startReal(ctx)).json.job;
  for (const step of ['started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'media', 'pull_request', 'checks', 'merge']) await send(ctx, a.id, step, 'ok');
  await send(ctx, a.id, 'deploy', 'failed');
  await send(ctx, a.id, 'finished', 'failed', { code: 'deploy_failed', message: 'The change is merged into the website but could not be confirmed live.', merged: true, mergeCommit: SHA40 });
  const h = await history(ctx);
  assert.equal(h.live, null, 'never Live');
  assert.equal(h.mergedUnverified.jobId, a.id);
  assert.equal(h.jobs[0].result.merged, true); assert.equal(h.jobs[0].result.mergeCommit, SHA40);
  // a failure BEFORE the merge is not reported as merged
  const b = (await startReal(ctx)).json.job;
  assert.equal(b.attempt, 2);
  await send(ctx, b.id, 'finished', 'failed', { code: 'checks_failed', message: 'x' });
  assert.equal((await history(ctx)).mergedUnverified.jobId, a.id);
  // recovery: a later job verifies it
  const c = (await startReal(ctx)).json.job;
  await finishLive(ctx, c.id);
  const done = await history(ctx);
  assert.equal(done.mergedUnverified, null); assert.equal(done.live.jobId, c.id);
  const code = (await import('node:fs')).readFileSync('listings.js', 'utf8');
  assert.match(code, /Merged, not yet confirmed live/); assert.ok(!/unless a step above shows it merged/.test(code));
});

test('PUBLIC STORE CHECK: administrators only; GET reads, POST also writes a probe; the answer is a verdict, never a credential', async () => {
  const { publicMediaCheckRoute } = await import('../api/_lib/routes.js');
  const { staff } = await import('./drafts-harness.js');
  const ADMIN = staff('admin@sdahomechoices.com.au', ['listings.view', 'listings.edit', 'listings.publish', 'listings.admin']);
  const w = world(); const db = await database(); resetCaches();
  const seen = [];
  w.publicBlob.check = async ({ write }) => { seen.push(write); return { ok: true, verdict: 'READ OK' }; };
  for (const who of [VIEWER, EDITOR, PUBLISHER]) assert.equal((await call(publicMediaCheckRoute, w, db, who, { url: '/api/listings/public-media-check' })).status, 403);
  assert.equal((await call(publicMediaCheckRoute, w, db, ADMIN, { url: '/api/listings/public-media-check' })).json.ok, true);
  assert.equal((await call(publicMediaCheckRoute, w, db, ADMIN, { method: 'POST', url: '/api/listings/public-media-check' })).json.ok, true);
  assert.deepEqual(seen, [false, true]);
  assert.equal((await call(publicMediaCheckRoute, w, db, ADMIN, { method: 'PUT', url: '/api/listings/public-media-check' })).status, 405);
  const none = await (await import('../api/_lib/public-media.js')).checkPublicMedia({ deps: {}, env: {} });
  assert.equal(none.ok, false); assert.match(none.verdict, /NOT CONNECTED/);
});

// ---- GitHub App authentication for the workflow dispatch (replaces the expiring personal token) ----
const APP_KEY = (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 });
const APP_PEM = APP_KEY.privateKey.export({ type: 'pkcs1', format: 'pem' });
const APP_ENV = { LISTINGS_CALLBACK_SECRET: SECRET, LISTINGS_GITHUB_AUTH: 'app', LISTINGS_GITHUB_APP_ID: '123456', LISTINGS_GITHUB_APP_INSTALLATION_ID: '9876543', LISTINGS_GITHUB_APP_PRIVATE_KEY: APP_PEM };
const INSTALL_TOKEN = ['ghs', 'INSTALLATIONTOKEN0123456789abcdefghijklmn'].join('_');
/** GitHub's token endpoint: verifies the JWT with the public key and records exactly what was asked for. */
function appGithub(inner, { status = 201, ttlMs = 3600 * 1000, now = () => Date.now() } = {}) {
  const g = { mints: [], status, token: INSTALL_TOKEN };
  g.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('/app/installations/') && u.endsWith('/access_tokens')) {
      const jwt = String(opts.headers.Authorization).replace(/^Bearer /, ''); const [h, b, s] = jwt.split('.');
      const { createVerify } = await import('node:crypto');
      const valid = createVerify('RSA-SHA256').update(`${h}.${b}`).verify(APP_KEY.publicKey, Buffer.from(s, 'base64url'));
      g.mints.push({ url: u, valid, claims: JSON.parse(Buffer.from(b, 'base64url').toString()), head: JSON.parse(Buffer.from(h, 'base64url').toString()), body: JSON.parse(opts.body) });
      if (g.status === 'throw') throw new Error('network');
      if (g.status !== 201) return { status: g.status, ok: false, json: async () => ({ message: `Bad credentials ${g.token} ${APP_PEM.slice(0, 40)}` }), headers: { get: () => null } };
      return { status: 201, ok: true, json: async () => ({ token: g.token, expires_at: new Date(now() + ttlMs).toISOString(), permissions: { actions: 'write', metadata: 'read' }, repository_selection: 'selected', repositories: [{ full_name: 'o/r' }] }), headers: { get: () => null } };
    }
    if (u.includes('/actions/workflows/') && !u.includes('/dispatches') && !u.includes('/runs')) return { status: 200, ok: true, json: async () => ({ state: 'active' }), headers: { get: () => null } };
    return inner(url, opts);
  };
  return g;
}

test('GITHUB APP: the key is accepted as a PEM, a PEM with escaped line breaks, or base64; anything else is refused without echoing it', async () => {
  const { parsePrivateKey, loadAppConfig } = await import('../api/_lib/github-app.js');
  for (const raw of [APP_PEM, APP_PEM.replace(/\n/g, '\\n'), `"${APP_PEM.replace(/\n/g, '\\n')}"`, Buffer.from(APP_PEM).toString('base64')]) assert.equal(parsePrivateKey(raw).asymmetricKeyType, 'rsa');
  for (const raw of ['', 'not a key', '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----']) assert.throws(() => parsePrivateKey(raw), (e) => e.name === 'Error' && !e.message.includes('AAAA'));
  assert.equal(loadAppConfig({}), null);
  assert.throws(() => loadAppConfig({ LISTINGS_GITHUB_APP_ID: '1' }), /LISTINGS_GITHUB_APP_INSTALLATION_ID, LISTINGS_GITHUB_APP_PRIVATE_KEY/);
  assert.throws(() => loadAppConfig({ ...APP_ENV, LISTINGS_GITHUB_APP_ID: 'abc' }), /numeric App ID/);
  assert.equal(loadAppConfig(APP_ENV).appId, '123456');
});

test('GITHUB APP: the JWT is RS256, signed by the key, issued 60 s in the past and valid for 9 minutes at most', async () => {
  const { appJwt, loadAppConfig } = await import('../api/_lib/github-app.js');
  const now = Date.UTC(2026, 10, 9, 12, 0, 0);
  const [h, b, s] = appJwt(loadAppConfig(APP_ENV), now).split('.');
  const { createVerify } = await import('node:crypto');
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(APP_KEY.publicKey, Buffer.from(s, 'base64url')));
  const c = JSON.parse(Buffer.from(b, 'base64url').toString());
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.equal(c.iss, '123456'); assert.equal(c.iat, now / 1000 - 60); assert.equal(c.exp - c.iat, 600);
  assert.ok(c.exp - now / 1000 <= 600, 'GitHub rejects a JWT that expires more than 10 minutes ahead');
});

test('GITHUB APP: the installation token is limited to the website repository and Actions write, cached, refreshed before expiry, never cached on failure', async () => {
  const { installationToken, loadAppConfig, clearInstallationTokens, GithubAppError } = await import('../api/_lib/github-app.js');
  clearInstallationTokens();
  const app = loadAppConfig(APP_ENV); let clock = Date.UTC(2026, 10, 9, 12, 0, 0);
  const g = appGithub(async () => { throw new Error('unexpected'); }, { now: () => clock });
  const get = () => installationToken(app, { repo: 'o/r', fetchImpl: g.fetch, now: () => clock });
  const [a, b] = await Promise.all([get(), get()]);
  assert.equal(g.mints.length, 1, 'concurrent callers share one mint');
  assert.equal(a.token, INSTALL_TOKEN); assert.equal(b.token, INSTALL_TOKEN);
  const m = g.mints[0];
  assert.ok(m.valid); assert.ok(m.url.endsWith('/app/installations/9876543/access_tokens'));
  assert.deepEqual(m.body, { repositories: ['r'], permissions: { actions: 'write' } });
  clock += 54 * 60 * 1000; await get(); assert.equal(g.mints.length, 1, 'still cached 54 minutes in');
  clock += 2 * 60 * 1000; await get(); assert.equal(g.mints.length, 2, 'refreshed once fewer than 5 minutes remain');
  for (const status of [401, 403, 404, 422, 500, 'throw']) {
    clearInstallationTokens(); g.status = status;
    const e = await get().then(() => null, (x) => x);
    assert.ok(e instanceof GithubAppError, `status ${status}`);
    assert.ok(!e.message.includes(INSTALL_TOKEN) && !e.message.includes('BEGIN') && !e.reason.includes('Bad credentials'), 'GitHub\'s body is never relayed');
  }
  g.status = 201; const ok = await get(); assert.equal(ok.token, INSTALL_TOKEN, 'a failure is not remembered');
});

test('GITHUB APP: configuration. Default stays the personal token; app mode needs the App variables and not the personal token; a bad mode fails closed', async () => {
  const { loadPublishConfig } = await import('../api/_lib/config.js');
  const tok = loadPublishConfig(PUBLISH_ENV); assert.equal(tok.authMode, 'token'); assert.equal(tok.githubToken, GH_TOKEN); assert.equal(tok.githubApp, null);
  const both = loadPublishConfig({ ...PUBLISH_ENV, ...APP_ENV, LISTINGS_GITHUB_AUTH: undefined }); assert.equal(both.authMode, 'token', 'App variables alone never switch the mode');
  const app = loadPublishConfig(APP_ENV); assert.equal(app.authMode, 'app'); assert.equal(app.githubToken, ''); assert.ok(app.githubApp);
  assert.throws(() => loadPublishConfig({ LISTINGS_CALLBACK_SECRET: SECRET, LISTINGS_GITHUB_AUTH: 'app' }), /LISTINGS_GITHUB_APP_ID/);
  assert.throws(() => loadPublishConfig({ ...APP_ENV, LISTINGS_GITHUB_AUTH: 'pat' }), /"token" or "app"/);
  assert.throws(() => loadPublishConfig({ ...APP_ENV, LISTINGS_CALLBACK_SECRET: 'short' }), /LISTINGS_CALLBACK_SECRET/);
});

test('GITHUB APP DISPATCH: with LISTINGS_GITHUB_AUTH=app the workflow is dispatched with the installation token, the personal token is not used, and the job is recorded as usual', async () => {
  const { clearInstallationTokens } = await import('../api/_lib/github-app.js');
  clearInstallationTokens();
  const ctx = await ready(); const g = appGithub(ctx.gh.fetch); ctx.gh.fetch = g.fetch;
  const r = await start(ctx, ALI_N, { env: { ...APP_ENV, LISTINGS_GITHUB_DISPATCH_TOKEN: GH_TOKEN } });
  assert.equal(r.status, 200, r.raw);
  assert.equal(ctx.gh.dispatches.length, 1);
  assert.equal(ctx.gh.dispatches[0].headers.Authorization, `Bearer ${INSTALL_TOKEN}`);
  assert.ok(![...ctx.gh.dispatches].some((d) => JSON.stringify(d.headers).includes(GH_TOKEN)), 'the personal token is not used in app mode');
  assert.deepEqual(ctx.gh.dispatches[0].body.inputs.mode, 'dry_run');
  assert.equal(g.mints.length, 1, 'one token served both the dispatch and the run lookup');
  assert.equal((await jobs(ctx.db)).length, 1);
  for (const text of [r.raw, JSON.stringify(await jobs(ctx.db))]) assert.ok(!text.includes(INSTALL_TOKEN) && !text.includes('BEGIN RSA') && !text.includes(APP_PEM.slice(40, 80)), 'no token or key is ever returned or stored');
  // and the default mode still dispatches with the personal token
  const ctx2 = await ready(); const r2 = await start(ctx2);
  assert.equal(r2.status, 200); assert.equal(ctx2.gh.dispatches[0].headers.Authorization, `Bearer ${GH_TOKEN}`);
});

test('GITHUB APP DISPATCH: a refused token or a refused dispatch fails the job with a plain reason and echoes nothing from GitHub\'s body', async () => {
  const { clearInstallationTokens } = await import('../api/_lib/github-app.js');
  for (const status of [401, 404, 'throw']) {
    clearInstallationTokens();
    const ctx = await ready(); const g = appGithub(ctx.gh.fetch, { status }); ctx.gh.fetch = g.fetch;
    const r = await start(ctx, ALI_N, { env: APP_ENV });
    assert.equal(r.status, 502, `mint ${status}`); assert.equal(r.json.error, 'dispatch_failed');
    assert.equal(ctx.gh.dispatches.length, 0);
    const all = r.raw + JSON.stringify(await jobs(ctx.db));
    assert.ok(!all.includes(INSTALL_TOKEN) && !all.includes('BEGIN') && !/Bad credentials/.test(all));
    assert.equal((await jobs(ctx.db))[0].status, 'failed');
  }
  clearInstallationTokens();
  const ctx = await ready(); const g = appGithub(ctx.gh.fetch); ctx.gh.fetch = g.fetch; ctx.gh.status = 403; ctx.gh.body = { message: `Resource not accessible by integration ${INSTALL_TOKEN}` };
  const r = await start(ctx, ALI_N, { env: APP_ENV });
  assert.equal(r.status, 502); assert.match(r.json.reason, /GitHub App does not have "Actions: Read and write"/); assert.ok(!r.raw.includes(INSTALL_TOKEN));
});

test('GITHUB APP CHECK: administrators only, read only, answers a verdict and the token scope, never the token', async () => {
  const { githubAppCheckRoute } = await import('../api/_lib/routes.js');
  const { clearInstallationTokens } = await import('../api/_lib/github-app.js');
  const { staff } = await import('./drafts-harness.js');
  const ADMIN = staff('admin@sdahomechoices.com.au', ['listings.view', 'listings.edit', 'listings.publish', 'listings.admin']);
  const w = world(); const db = await database(); resetCaches(); clearInstallationTokens();
  const g = appGithub(w.fetch);
  const url = '/api/listings/github-app-check';
  for (const who of [VIEWER, EDITOR, PUBLISHER]) assert.equal((await call(githubAppCheckRoute, w, db, who, { url, fetch: g.fetch, env: APP_ENV })).status, 403);
  assert.equal(g.mints.length, 0, 'nothing is minted for a caller who is not an administrator');
  const ok = await call(githubAppCheckRoute, w, db, ADMIN, { url, fetch: g.fetch, env: APP_ENV });
  assert.equal(ok.status, 200); assert.equal(ok.json.ok, true); assert.deepEqual(ok.json.repositories, ['o/r']); assert.equal(ok.json.permissions.actions, 'write');
  assert.ok(!ok.raw.includes(INSTALL_TOKEN) && !ok.raw.includes('BEGIN'));
  assert.equal((await call(githubAppCheckRoute, w, db, ADMIN, { method: 'POST', url, fetch: g.fetch, env: APP_ENV })).status, 405);
  assert.equal(ctxDispatches(g), 0, 'the check never dispatches a workflow');
  const none = await call(githubAppCheckRoute, w, db, ADMIN, { url, fetch: g.fetch, env: {} });
  assert.equal(none.json.ok, false); assert.match(none.json.verdict, /NOT CONFIGURED/);
  clearInstallationTokens(); g.status = 401;
  const bad = await call(githubAppCheckRoute, w, db, ADMIN, { url, fetch: g.fetch, env: APP_ENV });
  assert.equal(bad.json.ok, false); assert.match(bad.json.verdict, /FAILED/); assert.ok(!bad.raw.includes('Bad credentials'));
});
const ctxDispatches = (g) => g.mints.filter((m) => /dispatches/.test(m.url)).length;
