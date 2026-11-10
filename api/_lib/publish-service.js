// Starting a publication job (dry run, first publication, update) and answering status. See publication.js.
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { loadPublishConfig } from './config.js';
import { HttpError, PUBLIC_ID_RE } from './http.js';
import * as jobs from './jobs-repo.js';
import { ENABLED_KINDS, REAL_KINDS, buildPayload, dispatchWorkflow, findRun, jobView, preflight, reconcile } from './publication.js';
import { photoStore } from './photo-store.js';
import { promoteMedia, publicMediaConfigured, publicStore } from './public-media.js';
import * as drafts from './drafts-repo.js';
import { openDraft } from './draft-service.js';
import { loadSnapshots } from './site.js';

/**
 * Is this listing already on the website (an approved snapshot exists)? true / false, or null when the website cannot be read.
 * A listing can be published without any successful portal job (for example one imported from the website), so "Live" alone cannot decide
 * between a first publication and an update. The website's approved snapshots are the evidence. A withdrawn listing is not "published" here.
 */
export async function approvedOnWebsite(cfg, id, fetchImpl) {
  try { return (await loadSnapshots(cfg, { fetchImpl })).approved.has(id); } catch { return null; }
}

const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };

export const publishingConfigured = (env) => { try { loadPublishConfig(env); return true; } catch { return false; } };

export async function startPublication({ cfg, db, id, expectedVersion, kind, actor, staff, fetchImpl, env, caps, deps = {} }) {
  requireId(id);
  if (!ENABLED_KINDS.includes(kind)) throw new HttpError(400, 'mode_not_enabled');
  if (!Number.isInteger(expectedVersion)) throw new HttpError(400, 'expected_version_required');
  const publish = loadPublishConfig(env); // fail closed first: nothing is recorded if the job could never start
  const real = REAL_KINDS.includes(kind);
  if (real && !publicMediaConfigured(deps, env)) throw new HttpError(503, 'public_media_not_configured');
  const view = await openDraft({ cfg, db, id, fetchImpl, caps });
  const draft = await drafts.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  if (draft.version !== expectedVersion || view.draft.version !== expectedVersion) throw new HttpError(409, 'draft_changed');
  if (view.notion.changed.length) throw new HttpError(409, 'not_ready', { reasons: ['The Notion record changed since this draft was based on it. Review the changes and save the draft first.'], wouldBlock: [] });
  const pf = preflight(view);
  if (!pf.ready) throw new HttpError(409, 'not_ready', { reasons: pf.reasons, wouldBlock: pf.wouldBlock });

  // idempotent: asking again for the same draft version returns the job already running or already succeeded
  const latest = await jobs.latestJob(db, id, draft.version, kind);
  const finishedOk = latest?.status === 'succeeded' && (!real || latest.result?.live === true);
  if (latest && (jobs.isActive(latest) || finishedOk)) return { job: jobView(latest), existing: true, wouldBlock: pf.wouldBlock };

  if (real && kind === 'publish' && await jobs.liveJob(db, id)) throw new HttpError(409, 'already_live', { reasons: ['This listing is already live. Publish your changes as an update.'] });
  // refused before any image is copied or job recorded; the website job would refuse it later anyway (wrong_mode)
  if (real && kind === 'publish' && await approvedOnWebsite(cfg, id, fetchImpl) === true) throw new HttpError(409, 'already_published', { reasons: ['This listing is already published on the website. Publish your changes as an update.'] });
  const attempt = (await jobs.countAttempts(db, id, draft.version, kind)) + 1;
  const jobId = randomUUID();
  const { payload, hash } = buildPayload({ jobId, view, draft, staff, kind });
  const job = await jobs.createJob(db, {
    id: jobId, publicId: id, draftId: draft.id, draftVersion: draft.version, kind, attempt, payload, payloadHash: hash, requestedBy: actor.email, requestedByAuthUser: actor.authUserId,
    approverNotionUserId: staff.notionUserId ?? null, idempotencyKey: `${id}:${draft.version}:${kind}:${attempt}`,
  });
  audit({ action: 'listings.publish.request', outcome: 'ok', actor, detail: { id, kind, jobId: job.id, draftVersion: draft.version } });

  if (real) {
    // the approved images go to the public store BEFORE the website job starts; the job verifies them and refuses to continue if any is missing
    try {
      const copied = await promoteMedia({ publicId: id, manifest: payload.manifest, privateStore: photoStore(deps, env), publicStore: publicStore(deps, env) });
      await jobs.appendStep(db, job.id, 'media_copy', 'ok', { photos: copied.photos });
      audit({ action: 'listings.publish.media', outcome: 'ok', actor, detail: { id, jobId: job.id, photos: copied.photos, files: copied.files } });
    } catch (e) {
      const reason = e.extra?.reason ?? 'The images could not be copied to the public store.';
      const failed = await jobs.failJob(db, job.id, 'media_failed', reason);
      audit({ action: 'listings.publish.media', outcome: 'failed', actor, detail: { id, jobId: job.id, reason } });
      throw new HttpError(e.status && e.status < 500 ? e.status : 502, 'media_failed', { reason, job: jobView(failed ?? job) });
    }
  }

  try {
    await dispatchWorkflow({ publish, repo: cfg.repo, ref: 'main', job, kind }, fetchImpl);
  } catch (e) {
    const failed = await jobs.failJob(db, job.id, 'dispatch_failed', e.extra?.reason ?? 'The workflow could not be started.');
    audit({ action: 'listings.publish.dispatch', outcome: 'failed', actor, detail: { id, jobId: job.id, githubStatus: e.extra?.status ?? null, reason: e.extra?.reason ?? null } });
    throw new HttpError(502, 'dispatch_failed', { reason: e.extra?.reason, githubStatus: e.extra?.status ?? null, job: jobView(failed ?? job) });
  }
  const run = await findRun({ publish, repo: cfg.repo }, job.id, fetchImpl);
  const dispatched = (await jobs.markDispatched(db, job.id, run)) ?? job;
  audit({ action: 'listings.publish.dispatch', outcome: 'ok', actor, detail: { id, jobId: job.id } });
  return { job: jobView(dispatched), existing: false, wouldBlock: pf.wouldBlock };
}

const liveView = (j) => ({ jobId: j.id, kind: j.kind, draftVersion: j.draft_version, since: j.finished_at, url: j.result?.url ?? null, version: j.result?.version ?? null });

export async function jobsFor({ cfg, db, id, fetchImpl, env }) {
  requireId(id);
  let publish = null; try { publish = loadPublishConfig(env); } catch { /* status still works without it */ }
  const list = await jobs.listJobs(db, id, 10);
  const out = [];
  for (const j of list) out.push(jobView(jobs.isActive(j) ? await reconcile(j, { db, publish, repo: cfg.repo, fetchImpl }) : j));
  const live = await jobs.liveJob(db, id);
  const stuck = await jobs.mergedUnverified(db, id);
  const publishedOnWebsite = live ? true : await approvedOnWebsite(cfg, id, fetchImpl);
  return { jobs: out, active: out.find((j) => j.active) ?? null, configured: Boolean(publish), publishedOnWebsite, enabledKinds: ENABLED_KINDS, live: live ? liveView(live) : null, mergedUnverified: stuck ? { jobId: stuck.id, kind: stuck.kind, draftVersion: stuck.draft_version, at: stuck.finished_at } : null };
}
