// Withdrawing a published listing from public marketing (a Publisher's decision). Same lifecycle as a publication: the portal records a job, the
// existing GitHub App starts the website workflow in mode "withdraw", and the listing shows as Withdrawn only after the website has been verified.
//
// PRIVACY. The website repository, its pull requests, commits, Actions logs and workflow inputs are public. The reason for a withdrawal and the person
// who asked therefore NEVER leave the Listings Manager: the payload sent to the website job carries only the listing id, the action and a timestamp.
// Both are stored in the private, append-only listings.audit_log (migration 0005), written here from the verified session before anything is dispatched.
import { createHash, randomUUID } from 'node:crypto';
import { appendAudit } from './audit-log.js';
import { audit } from './audit.js';
import { loadPublishConfig } from './config.js';
import * as drafts from './drafts-repo.js';
import { HttpError } from './http.js';
import * as jobs from './jobs-repo.js';
import { dispatchWorkflow, findRun, jobView } from './publication.js';
import { loadSnapshots } from './site.js';

/** The public address as visitors read it, with whitespace and case ignored, for the typed confirmation. */
export const normaliseAddress = (s) => String(s ?? '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim().toLowerCase();

export const REASON_MAX = 300;
export function cleanReason(raw) {
  const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim() : '';
  if (!text) throw new HttpError(400, 'reason_required');
  if (text.length > REASON_MAX) throw new HttpError(400, 'invalid_reason');
  return text;
}

/** What the website shows for this listing: { approved: snapshot|null, withdrawn: bool }, or null when the website cannot be read. */
export async function websiteState(cfg, id, fetchImpl) {
  try { const s = await loadSnapshots(cfg, { fetchImpl }); return { approved: s.approved.get(id) ?? null, withdrawn: s.withdrawn.has(id) }; } catch { return null; }
}

export async function startWithdrawal({ cfg, db, id, body, actor, session, fetchImpl, env }) {
  if (typeof id !== 'string' || !/^lst_[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'invalid_id');
  const publish = loadPublishConfig(env); // fail closed first: nothing is recorded if the job could never start
  const recheck = body?.recheck === true;
  const draft = await drafts.getDraft(db, id);
  if (!draft) throw new HttpError(409, 'draft_required', { reasons: ['This listing has no draft in the Listings Manager. Import the published listing first.'] });
  const site = await websiteState(cfg, id, fetchImpl);
  if (!site) throw new HttpError(503, 'website_unreadable');
  if (!site.approved) throw new HttpError(409, 'not_published', { reasons: ['This listing is not published, so there is nothing to withdraw.'] });

  const prior = await jobs.withdrawalState(db, id);
  const unconfirmed = site.withdrawn && prior?.status === 'failed' && prior.result?.merged === true;   // merged into the website, but the 404 was not confirmed
  if (recheck) {
    if (!unconfirmed) throw new HttpError(409, 'nothing_to_recheck', { reasons: ['There is no unconfirmed withdrawal to re-check.'] });
  } else {
    if (site.withdrawn) throw new HttpError(409, 'already_withdrawn', { reasons: ['This listing is already withdrawn.'] });
    // the typed address is the confirmation that the right property is being withdrawn: it must be the PUBLIC address as the website shows it
    const a = site.approved.address;
    if (!a || normaliseAddress(body?.confirmAddress) !== normaliseAddress(a)) throw new HttpError(409, 'address_mismatch', { reasons: ['The address you typed does not match the listing. Nothing was changed.'] });
  }
  const reason = recheck ? null : cleanReason(body?.reason);

  // two clicks, or a second tab: the job already running is the answer
  const active = (await jobs.listJobs(db, id, 5)).find((j) => jobs.isActive(j));
  if (active) { if (active.kind === 'withdraw') return { job: jobView(active), existing: true }; throw new HttpError(409, 'job_active'); }

  const attempt = (await jobs.countAttempts(db, id, draft.version, 'withdraw')) + 1;
  const jobId = randomUUID();
  const at = new Date().toISOString();
  // NOTHING private in the payload: the website job downloads it, and what it handles can end up in a public place
  const payload = { version: 1, jobId, mode: 'withdraw', publicId: id, authority: 'listings_manager', action: 'withdraw', at };
  let job;
  try {
    job = await jobs.createJob(db, {
      id: jobId, publicId: id, draftId: draft.id, draftVersion: draft.version, kind: 'withdraw', attempt, payload, payloadHash: createHash('sha256').update(`withdraw:${id}:${at}`).digest('hex'),
      requestedBy: actor.email, requestedByAuthUser: actor.authUserId, approverNotionUserId: null, idempotencyKey: `${id}:${draft.version}:withdraw:${attempt}`,
    });
  } catch (e) {
    // a simultaneous second click lost the race: the job that won is the answer
    if (e instanceof HttpError && (e.code === 'job_exists' || e.code === 'job_active')) {
      const winner = (await jobs.listJobs(db, id, 5)).find((j) => jobs.isActive(j));
      if (winner?.kind === 'withdraw') return { job: jobView(winner), existing: true };
    }
    throw e;
  }
  audit({ action: 'listings.withdraw.request', outcome: 'ok', actor, detail: { id, jobId: job.id, recheck } });   // the reason is never written to a log

  if (!recheck) {
    // the private audit trail comes first and is required: without a durable record of who and why, nothing is dispatched
    try { await appendAudit(db, { session, action: 'withdraw', publicId: id, draftVersion: draft.version, jobId: job.id, reason }); }
    catch (e) {
      const failed = await jobs.failJob(db, job.id, 'audit_failed', 'The private audit record could not be written, so nothing was started.');
      audit({ action: 'listings.withdraw.audit', outcome: 'failed', actor, detail: { id, jobId: job.id } });
      throw new HttpError(500, 'audit_failed', { job: jobView(failed ?? job) });
    }
  }

  try {
    await dispatchWorkflow({ publish, repo: cfg.repo, ref: 'main', job, kind: 'withdraw' }, fetchImpl);
  } catch (e) {
    const failed = await jobs.failJob(db, job.id, 'dispatch_failed', e.extra?.reason ?? 'The workflow could not be started.');
    audit({ action: 'listings.withdraw.dispatch', outcome: 'failed', actor, detail: { id, jobId: job.id, githubStatus: e.extra?.status ?? null } });
    throw new HttpError(502, 'dispatch_failed', { reason: e.extra?.reason, githubStatus: e.extra?.status ?? null, job: jobView(failed ?? job) });
  }
  const run = await findRun({ publish, repo: cfg.repo }, job.id, fetchImpl);
  const dispatched = (await jobs.markDispatched(db, job.id, run)) ?? job;
  audit({ action: 'listings.withdraw.dispatch', outcome: 'ok', actor, detail: { id, jobId: job.id } });
  return { job: jobView(dispatched), existing: false };
}
