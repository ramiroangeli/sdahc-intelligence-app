// Starting a publication job (increment 1: the dry run only) and answering status. See publication.js.
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { loadPublishConfig } from './config.js';
import { HttpError, PUBLIC_ID_RE } from './http.js';
import * as jobs from './jobs-repo.js';
import { ENABLED_KINDS, buildPayload, dispatchWorkflow, findRun, jobView, preflight, reconcile } from './publication.js';
import * as drafts from './drafts-repo.js';
import { openDraft } from './draft-service.js';

const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };

export const publishingConfigured = (env) => { try { loadPublishConfig(env); return true; } catch { return false; } };

export async function startPublication({ cfg, db, id, expectedVersion, kind, actor, staff, fetchImpl, env, caps }) {
  requireId(id);
  if (!ENABLED_KINDS.includes(kind)) throw new HttpError(400, 'mode_not_enabled');
  if (!Number.isInteger(expectedVersion)) throw new HttpError(400, 'expected_version_required');
  const publish = loadPublishConfig(env); // fail closed first: nothing is recorded if the job could never start
  const view = await openDraft({ cfg, db, id, fetchImpl, caps });
  const draft = await drafts.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  if (draft.version !== expectedVersion || view.draft.version !== expectedVersion) throw new HttpError(409, 'draft_changed');
  if (view.notion.changed.length) throw new HttpError(409, 'not_ready', { reasons: ['The Notion record changed since this draft was based on it. Review the changes and save the draft first.'], wouldBlock: [] });
  const pf = preflight(view, staff);
  if (!pf.ready) throw new HttpError(409, 'not_ready', { reasons: pf.reasons, wouldBlock: pf.wouldBlock });

  // idempotent: asking again for the same draft version returns the job already running or already succeeded
  const latest = await jobs.latestJob(db, id, draft.version, kind);
  if (latest && (jobs.isActive(latest) || latest.status === 'succeeded')) return { job: jobView(latest), existing: true, wouldBlock: pf.wouldBlock };

  const attempt = (await jobs.countAttempts(db, id, draft.version, kind)) + 1;
  const jobId = randomUUID();
  const { payload, hash } = buildPayload({ jobId, view, draft, staff, kind });
  const job = await jobs.createJob(db, {
    id: jobId, publicId: id, draftId: draft.id, draftVersion: draft.version, kind, attempt, payload, payloadHash: hash, requestedBy: actor.email, requestedByAuthUser: actor.authUserId,
    approverNotionUserId: staff.notionUserId ?? null, idempotencyKey: `${id}:${draft.version}:${kind}:${attempt}`,
  });
  audit({ action: 'listings.publish.request', outcome: 'ok', actor, detail: { id, kind, jobId: job.id, draftVersion: draft.version } });

  try {
    await dispatchWorkflow({ publish, repo: cfg.repo, ref: 'main', job, kind }, fetchImpl);
  } catch (e) {
    const failed = await jobs.failJob(db, job.id, 'dispatch_failed', e.extra?.reason ?? 'The workflow could not be started.');
    audit({ action: 'listings.publish.dispatch', outcome: 'failed', actor, detail: { id, jobId: job.id } });
    throw new HttpError(502, 'dispatch_failed', { reason: e.extra?.reason, job: jobView(failed ?? job) });
  }
  const run = await findRun({ publish, repo: cfg.repo }, job.id, fetchImpl);
  const dispatched = (await jobs.markDispatched(db, job.id, run)) ?? job;
  audit({ action: 'listings.publish.dispatch', outcome: 'ok', actor, detail: { id, jobId: job.id } });
  return { job: jobView(dispatched), existing: false, wouldBlock: pf.wouldBlock };
}

export async function jobsFor({ cfg, db, id, fetchImpl, env }) {
  requireId(id);
  let publish = null; try { publish = loadPublishConfig(env); } catch { /* status still works without it */ }
  const list = await jobs.listJobs(db, id, 10);
  const out = [];
  for (const j of list) out.push(jobView(jobs.isActive(j) ? await reconcile(j, { db, publish, repo: cfg.repo, fetchImpl }) : j));
  return { jobs: out, active: out.find((j) => j.active) ?? null, configured: Boolean(publish), enabledKinds: ENABLED_KINDS };
}
