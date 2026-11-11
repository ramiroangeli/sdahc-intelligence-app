// Starting a publication job (dry run, first publication, update) and answering status. See publication.js.
import { randomUUID } from 'node:crypto';
import { audit } from './audit.js';
import { loadPublishConfig } from './config.js';
import { HttpError, PUBLIC_ID_RE } from './http.js';
import * as jobs from './jobs-repo.js';
import { COMMERCIAL_STATUSES, ENABLED_KINDS, REAL_KINDS, buildPayload, dispatchWorkflow, findRun, jobView, preflight, reconcile } from './publication.js';
import { photoStore } from './photo-store.js';
import { promoteMedia, publicMediaConfigured, publicStore } from './public-media.js';
import * as drafts from './drafts-repo.js';
import { openDraft } from './draft-service.js';
import { loadSnapshots } from './site.js';
import { appendAudit, readAudit } from './audit-log.js';
import { websiteState } from './withdrawal.js';
import { changesSincePublished } from './changes.js';

/**
 * Is this listing already on the website (an approved snapshot exists)? true / false, or null when the website cannot be read.
 * A listing can be published without any successful portal job (for example one imported from the website), so "Live" alone cannot decide
 * between a first publication and an update. The website's approved snapshots are the evidence. A withdrawn listing is not "published" here.
 */
export async function approvedOnWebsite(cfg, id, fetchImpl) {
  try { return (await loadSnapshots(cfg, { fetchImpl })).approved.has(id); } catch { return null; }
}
/** The commercial status the website shows for this listing: available, under_offer, sold, or null (not on the website), or undefined (unreadable). */
export async function websiteStatusOf(cfg, id, fetchImpl) {
  try { return (await loadSnapshots(cfg, { fetchImpl })).approved.get(id)?.commercialStatus ?? null; } catch { return undefined; }
}

/**
 * The real difference between the saved draft and the version on the website, or null when there is nothing to compare (not published, withdrawn,
 * or the website could not be read). Values are compared, not edit events (see changes.js). One thing the content cannot show is a change in the CRM
 * that was accepted into the draft after the last publication, so that adds one item.
 */
export async function changesFor(db, draft, { site, live }) {
  if (!draft || !site || !site.approved || !site.approved.public || site.withdrawn) return null;
  const result = changesSincePublished(draft, { ...site.approved.public, address: site.approved.address });
  const base = live ? (live.draft_id === draft.id ? live.draft_version : null) : await drafts.importedVersion(db, draft.id);
  if (base != null && await drafts.notionRefreshedSince(db, draft.id, base)) { result.items.push({ field: 'crm', label: 'CRM details you accepted' }); result.count += 1; }
  return result;
}

const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };

export const publishingConfigured = (env) => { try { loadPublishConfig(env); return true; } catch { return false; } };

export async function startPublication({ cfg, db, id, expectedVersion, kind, actor, staff, fetchImpl, env, caps, deps = {}, commercialStatus, expectedStatus, session }) {
  requireId(id);
  if (!ENABLED_KINDS.includes(kind)) throw new HttpError(400, 'mode_not_enabled');
  if (!Number.isInteger(expectedVersion)) throw new HttpError(400, 'expected_version_required');
  // a withdrawn listing is not published, updated, re-statused or rehearsed: withdrawal is permanent in the Listings Manager
  const siteNow = await websiteState(cfg, id, fetchImpl);
  // The website cannot be read, so whether this is a first publication, an update, or a withdrawn listing is unknown: a real publication or status change waits
  // until the website can be verified (a test without publishing does not change anything, so it is still allowed). Nothing is recorded.
  if (siteNow === null && REAL_KINDS.includes(kind)) throw new HttpError(503, 'website_unreadable', { reasons: ['Unable to verify the website right now, so publishing is paused. Nothing was changed. Try again in a minute.'] });
  if (siteNow?.withdrawn === true) throw new HttpError(409, 'withdrawn', { reasons: ['This listing is withdrawn from public marketing. Withdrawal is permanent in the Listings Manager, so it cannot be published or changed.'] });
  // Commercial status (Publisher only, which the route already requires). Asked for as "set to X"; X must be a real status, and the Publisher must
  // say which status they saw, so a stale tab cannot silently undo someone else's change.
  let statusChange = null;
  if (commercialStatus !== undefined && commercialStatus !== null) {
    if (!COMMERCIAL_STATUSES.includes(commercialStatus)) throw new HttpError(400, 'invalid_status');
    if (kind === 'publish') { if (commercialStatus !== 'available') throw new HttpError(409, 'status_not_allowed', { reasons: ['A first publication is always Available. Change the status after it is live.'] }); }
    else {
      const current = await websiteStatusOf(cfg, id, fetchImpl);
      if (current === undefined) throw new HttpError(503, 'website_unreadable');
      if (current === null) throw new HttpError(409, 'not_published', { reasons: ['This listing is not on the website yet, so it has no status to change.'] });
      if (expectedStatus !== current) throw new HttpError(409, 'status_changed', { reasons: ['The status on the website has changed since you opened this page. Reload and check it.'], current });
      if (commercialStatus !== current) statusChange = { from: current, to: commercialStatus };
    }
  }
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

  // idempotent: asking again for the same draft version AND the same frozen content (including a requested status) returns the job already running or already succeeded
  const jobId = randomUUID();
  const { payload, hash } = buildPayload({ jobId, view, draft, kind, commercialStatus: statusChange?.to });
  const latest = await jobs.latestJob(db, id, draft.version, kind);
  const finishedOk = latest?.status === 'succeeded' && (!real || latest.result?.live === true);
  if (latest && latest.payload_hash === hash && (jobs.isActive(latest) || finishedOk)) return { job: jobView(latest), existing: true, wouldBlock: pf.wouldBlock };
  if (latest && jobs.isActive(latest)) throw new HttpError(409, 'job_active');

  // nothing to publish: no job is recorded. The saved draft is compared with the version on the website (values, not edit events); a requested status
  // change, a merge that was not confirmed, or an unreadable website all mean "there may be something to do".
  {
    const live = await jobs.liveJob(db, id);
    if (!statusChange && (kind === 'dry_run' || (real && live))) {
      const changes = await changesFor(db, draft, { site: await websiteState(cfg, id, fetchImpl), live });
      if (changes && changes.count === 0 && !(await jobs.mergedUnverified(db, id))) throw new HttpError(409, 'no_changes', { reasons: ['No changes to publish. This listing already matches what is on the website.'] });
    }
  }
  if (real && kind === 'publish' && await jobs.liveJob(db, id)) throw new HttpError(409, 'already_live', { reasons: ['This listing is already live. Publish your changes as an update.'] });
  // refused before any image is copied or job recorded; the website job would refuse it later anyway (wrong_mode)
  if (real && kind === 'publish' && await approvedOnWebsite(cfg, id, fetchImpl) === true) throw new HttpError(409, 'already_published', { reasons: ['This listing is already published on the website. Publish your changes as an update.'] });
  const attempt = (await jobs.countAttempts(db, id, draft.version, kind)) + 1;
  const job = await jobs.createJob(db, {
    id: jobId, publicId: id, draftId: draft.id, draftVersion: draft.version, kind, attempt, payload, payloadHash: hash, requestedBy: actor.email, requestedByAuthUser: actor.authUserId,
    approverNotionUserId: staff.notionUserId ?? null, idempotencyKey: `${id}:${draft.version}:${kind}:${attempt}`,
  });
  audit({ action: 'listings.publish.request', outcome: 'ok', actor, detail: { id, kind, jobId: job.id, draftVersion: draft.version, ...(statusChange ? { status: statusChange } : {}) } });
  if (statusChange) {
    // the private audit trail records who changed the public status, and from what to what; without it nothing is started
    try { await appendAudit(db, { session, action: 'status_change', publicId: id, draftVersion: draft.version, jobId: job.id, statusFrom: statusChange.from, statusTo: statusChange.to }); }
    catch { const failed = await jobs.failJob(db, job.id, 'audit_failed', 'The private audit record could not be written, so nothing was started.'); throw new HttpError(500, 'audit_failed', { job: jobView(failed ?? job) }); }
  }

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

export async function jobsFor({ cfg, db, id, fetchImpl, env, canPublish = false }) {
  requireId(id);
  let publish = null; try { publish = loadPublishConfig(env); } catch { /* status still works without it */ }
  const list = await jobs.listJobs(db, id, 10);
  const out = [];
  for (const j of list) out.push(jobView(jobs.isActive(j) ? await reconcile(j, { db, publish, repo: cfg.repo, fetchImpl }) : j));
  const live = await jobs.liveJob(db, id);
  const wjForFresh = await jobs.withdrawalState(db, id);
  const stuck = await jobs.mergedUnverified(db, id);
  const publishedOnWebsite = live ? true : await approvedOnWebsite(cfg, id, fetchImpl);
  // right after a publication the website's files have just changed: read them fresh for a couple of minutes so the screen never shows stale "changes"
  const justFinished = [live, wjForFresh].some((j) => j && j.finished_at && Date.now() - new Date(j.finished_at).getTime() < 120000);
  const site = await websiteState(cfg, id, fetchImpl, justFinished ? { ttlMs: 0 } : {});
  const websiteStatus = publishedOnWebsite ? (site?.approved?.commercialStatus ?? null) : null;
  // withdrawal: the tombstone on the website's main branch, and what the last withdrawal job proved
  const wj = await jobs.withdrawalState(db, id);
  const withdrawn = site ? site.withdrawn : null;
  const withdrawal = wj ? { jobId: wj.id, status: wj.status, merged: wj.result?.merged === true, verified: wj.status === 'succeeded' && wj.result?.withdrawn === true, at: wj.finished_at ?? wj.created_at } : null;
  const audit = canPublish ? (await readAudit(db, id, 20)).map((r) => ({ id: r.id, at: r.at, by: r.actor_email, action: r.action, from: r.status_from, to: r.status_to, reason: r.reason, jobId: r.job_id })) : null;
  const changes = await changesFor(db, await drafts.getDraft(db, id), { site, live });
  const noChanges = !!changes && changes.count === 0 && !stuck && !out.some((j) => j.active);
  return { jobs: out, active: out.find((j) => j.active) ?? null, configured: Boolean(publish), publishedOnWebsite, websiteStatus, changes, websiteVerified: site !== null, websiteAddress: site?.approved?.address ?? null, withdrawn, withdrawal, ...(audit ? { audit } : {}), noChanges, enabledKinds: ENABLED_KINDS, live: live ? liveView(live) : null, mergedUnverified: stuck ? { jobId: stuck.id, kind: stuck.kind, draftVersion: stuck.draft_version, at: stuck.finished_at } : null };
}
