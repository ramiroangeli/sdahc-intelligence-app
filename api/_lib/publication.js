// Publication jobs, increment 1: the DRY RUN. It proves that an approved draft would publish and changes nothing anywhere.
// What runs where:
//   here (server)   preflight, freeze the approved public content, record the job, ask GitHub to start the workflow, answer status
//   GitHub Actions  the website's own engine, tests, build and privacy scan (scripts/listings-publish-job.mjs), reporting back by signed request
// The job continues on GitHub's servers whether or not anyone keeps a browser open. This module never writes to Notion, GitHub content or Blob.
import { createHash } from 'node:crypto';
import { loadPublishConfig } from './config.js';
import { HttpError } from './http.js';
import * as jobs from './jobs-repo.js';
import { canonical, reviewState } from './photos.js';
import { signedHeaders } from './signing.js';

export const ENABLED_KINDS = ['dry_run']; // 'publish', 'update', 'withdraw' arrive in later increments
const STEP_NAMES = ['started', 'payload', 'notion_read', 'engine', 'tests', 'build', 'finished'];
const EVENT_STATUSES = ['running', 'ok', 'failed', 'succeeded'];
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isJobId = (x) => typeof x === 'string' && JOB_ID_RE.test(x);

const stable = (v) => JSON.stringify(sortKeys(v));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const sha = (x) => createHash('sha256').update(stable(x)).digest('hex');

/** Why a dry run cannot start yet (cheap checks the engine cannot do), and what the engine will probably refuse (informational). */
export function preflight(view, staff) {
  const reasons = [];
  const v = view.validation;
  if (!v.complete) reasons.push('Complete the required fields first (see the checklist).');
  const items = view.photos?.items ?? [];
  if (!items.some((p) => p.kind !== 'floorplan')) reasons.push('Add at least one photograph.');
  if (!view.photos?.readiness?.ready) reasons.push('Fix the flagged photo descriptions first.');
  if (items.length && !view.photos?.review?.reviewed) reasons.push('A Publisher reviews the whole gallery first (it covers exactly the current images).');
  const wouldBlock = v.blockers.filter((b) => !['photo_review', 'photos_required', 'photo_alt'].includes(b.code)).map((b) => b.message);
  if (!staff.notionUserId) wouldBlock.push('Your Notion user id is not set in the staff list, so a real publication would not have a named approver.');
  return { ready: reasons.length === 0, reasons, wouldBlock };
}

const PRICING_MODES = ['asking_price', 'price_guide', 'eoi', 'contact_agent'];
/** The frozen PUBLIC content the Publisher approved. Nothing internal. */
export function buildPayload({ jobId, view, draft, staff, kind }) {
  const c = view.draft.content;
  if (!PRICING_MODES.includes(c.pricingMode)) throw new HttpError(409, 'not_ready', { reasons: ['Choose a pricing mode.'] });
  const needsPrice = c.pricingMode === 'asking_price' || c.pricingMode === 'price_guide';
  const price = needsPrice ? Number(String(c.displayPrice).replace(/[^0-9.]/g, '')) : null;
  const rv = reviewState(draft);
  if (!rv.reviewed) throw new HttpError(409, 'not_ready', { reasons: ['The gallery review does not cover the current images.'] });
  const body = {
    version: 1, jobId, mode: kind, publicId: draft.public_id,
    content: { title: c.title, description: c.description, publicAddress: c.publicAddress, pricingMode: c.pricingMode, displayPrice: Number.isFinite(price) ? price : null, featured: c.featured === true },
    manifest: {
      version: 1,
      // privacyReviewed is true ONLY because a Publisher reviewed exactly this gallery (checked just above); nothing is stored per photograph
      photos: canonical(draft.photos).map((p) => ({ id: p.id, alt: (p.alt ?? '').trim(), width: p.width, height: p.height, accent: p.accent, privacyReviewed: true, ...(p.kind === 'floorplan' ? { kind: 'floorplan' } : {}), files: p.files.map((f) => ({ w: f.w, file: f.file })) })),
    },
    approver: { notionUserId: staff.notionUserId ?? null, name: staff.email },
    galleryReview: { by: rv.by, at: rv.at, count: rv.count },
  };
  return { payload: body, hash: sha(body.content) + ':' + sha(body.manifest.photos.map((p) => [p.id, p.alt, p.kind ?? 'photo'])) };
}

/** GitHub's own words, with anything that looks like a credential removed (the token can never be echoed back, even if GitHub quoted it). */
export const scrub = (text, token) => String(text ?? '').split(token || '\u0000').join('[token]').replace(/\b(github_pat_|ghp_|gho_|ghs_|ghu_|ghr_)[A-Za-z0-9_]+/g, '[token]').replace(/Bearer\s+\S+/gi, 'Bearer [token]').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Turns GitHub's answer into one actionable sentence for staff, plus the exact status and (scrubbed) message for the administrator. */
export function explainDispatch(status, ghMessage, accepted) {
  const needsWrite = /actions\s*=\s*write/i.test(accepted ?? '') || /not accessible by (personal access token|integration)/i.test(ghMessage ?? '');
  if (status === 401) return 'GitHub says the access token is not valid (expired, revoked or mistyped). Create a new one and replace LISTINGS_GITHUB_DISPATCH_TOKEN.';
  if (status === 403 && needsWrite) return 'The access token is valid but does not have "Actions: Read and write" on the website repository. Edit the token\'s permissions in GitHub (no new token is needed).';
  if (status === 403) return 'GitHub refused the request.';
  if (status === 404) return 'The workflow or the repository was not found for this token. Check the token\'s repository selection and that publish-listing.yml is on the main branch.';
  if (status === 422) return 'GitHub rejected the request (is the workflow on the main branch, and do its inputs match?).';
  return 'GitHub answered with an unexpected status.';
}

export async function dispatchWorkflow({ publish, repo, ref, job, kind }, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(publish.workflow)}/dispatches`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${publish.githubToken}`, 'User-Agent': 'sdahc-listings-manager', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, inputs: { job_id: job.id, public_id: job.public_id, mode: kind } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch { throw new HttpError(502, 'dispatch_failed', { reason: 'GitHub could not be reached.' }); }
  if (res.status === 204) return;
  let message = ''; try { message = (await res.json()).message ?? ''; } catch { /* no body */ }
  const accepted = res.headers?.get?.('x-accepted-github-permissions') ?? '';
  const github = scrub(message, publish.githubToken);
  // exact HTTP status and GitHub's scrubbed message travel with the failure (job history, audit log); the token and the Authorization header never do
  throw new HttpError(502, 'dispatch_failed', { reason: `${explainDispatch(res.status, message, accepted)} (GitHub HTTP ${res.status}${github ? `: ${github}` : ''}${accepted ? `; needs ${scrub(accepted, publish.githubToken)}` : ''})`, status: res.status });
}

/** Finds the Actions run of a job by its title (the workflow names its run "publish <job id>"). Best effort. */
export async function findRun({ publish, repo }, jobId, fetchImpl) {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(publish.workflow)}/runs?event=workflow_dispatch&per_page=15`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${publish.githubToken}`, 'User-Agent': 'sdahc-listings-manager' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const run = (await res.json()).workflow_runs?.find((r) => r.display_title === `publish ${jobId}` || r.name === `publish ${jobId}`);
    return run ? { id: run.id, url: run.html_url, status: run.status, conclusion: run.conclusion } : null;
  } catch { return null; }
}

const MIN = 60 * 1000;
/**
 * A job that stops reporting must not stay "running" for ever. Called whenever a job is read. If the Actions run ended without a final
 * report (it crashed, was cancelled, or could not reach the app), the job is marked failed with that reason. Never touches a finished job.
 */
export async function reconcile(job, { db, publish, repo, fetchImpl, now = Date.now() }) {
  if (!jobs.isActive(job)) return job;
  const age = now - new Date(job.updated_at).getTime();
  const created = now - new Date(job.created_at).getTime();
  if (created > 25 * MIN) return (await jobs.failJob(db, job.id, 'timed_out', 'The job did not finish within 25 minutes.')) ?? job;
  if (age < 2 * MIN || !publish) return job;
  const run = await findRun({ publish, repo }, job.id, fetchImpl);
  if (!run) return job;
  if (!job.run_id) await jobs.setRun(db, job.id, run);
  if (run.status === 'completed' && run.conclusion !== 'success') {
    return (await jobs.failJob(db, job.id, 'workflow_ended', `The GitHub run ended as "${run.conclusion}" without reporting a result.`)) ?? job;
  }
  if (run.status === 'completed' && age > 4 * MIN) return (await jobs.failJob(db, job.id, 'no_report', 'The GitHub run finished but its result never reached the app.')) ?? job;
  return job;
}

export function jobView(j) {
  return {
    id: j.id, kind: j.kind, attempt: j.attempt, status: j.status, step: j.step, draftVersion: j.draft_version,
    requestedBy: j.requested_by, createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at,
    steps: j.steps, runUrl: j.run_url, result: j.result, error: j.error_code ? { code: j.error_code, message: j.error_message } : null, active: jobs.isActive(j),
  };
}

/** The callback body is untrusted: keep only known keys, bounded. Nothing else reaches the database. */
export function sanitiseEvent(body) {
  if (!body || typeof body !== 'object' || !isJobId(body.jobId) || !STEP_NAMES.includes(body.step) || !EVENT_STATUSES.includes(body.status)) throw new HttpError(400, 'invalid_event');
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  const d = body.detail && typeof body.detail === 'object' ? body.detail : {};
  const detail = {};
  if (str(d.code, 60)) detail.code = str(d.code, 60).replace(/[^a-z0-9_]/gi, '');
  if (str(d.message, 300)) detail.message = str(d.message, 300);
  if (str(d.kind, 20)) detail.kind = str(d.kind, 20);
  if (Number.isInteger(d.version)) detail.version = d.version;
  if (Number.isInteger(d.photos)) detail.photos = d.photos;
  if (typeof d.dryRun === 'boolean') detail.dryRun = d.dryRun;
  if (typeof d.slug === 'string' && /^[a-z]+(-[a-z]+)*$/.test(d.slug) && d.slug.length <= 80) detail.slug = d.slug;
  if (typeof d.contentHash === 'string' && /^[a-f0-9]{64}$/.test(d.contentHash)) detail.contentHash = d.contentHash;
  for (const k of ['problems', 'issues', 'wouldBlock']) if (Array.isArray(d[k])) detail[k] = d[k].slice(0, 20).map((x) => String(x).slice(0, 300));
  if (Array.isArray(d.checks)) detail.checks = d.checks.slice(0, 12).filter((c) => c && typeof c.name === 'string').map((c) => ({ name: c.name.slice(0, 40).replace(/[^a-z0-9_]/gi, ''), ok: c.ok === true, note: String(c.note ?? '').slice(0, 1500) }));
  return { jobId: body.jobId, step: body.step, status: body.status, detail: Object.keys(detail).length ? detail : null };
}
export { signedHeaders };
