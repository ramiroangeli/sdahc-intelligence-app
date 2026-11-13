// Draft implementation: acceptance and job creation must share a transaction.
// This module is not yet connected to the publication route or UI.
import { createHash } from 'node:crypto';
import { HttpError } from './http.js';
import { actorFromSession, appendAudit } from './audit-log.js';
import { createJob } from './jobs-repo.js';

export const INTERNAL_TERMS_VERSION = 'internal-draft-v1';
const sortKeys = (value) => Array.isArray(value) ? value.map(sortKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])])) : value;

/** Hash all server-frozen public content, including the photo manifest and the Notion-derived facts the publisher reviewed. */
export function reviewedContentHash(payload, { publicId, draftVersion } = {}) {
  if (!publicId || !Number.isInteger(draftVersion) || !payload?.content || !payload?.manifest || !payload?.reviewedSda) throw new HttpError(400, 'review_snapshot_missing');
  return createHash('sha256').update(JSON.stringify(sortKeys({ publicId, draftVersion, content: payload.content, manifest: payload.manifest, reviewedSda: payload.reviewedSda }))).digest('hex');
}

/**
 * `reviewedHash` is an optimistic concurrency token previously produced by the server, never evidence of identity or acceptance.
 * Verify it against the server-built payload and use a database lock to stop a save racing the job insertion.
 */
export async function createAcceptedJob(db, { session, job, reviewedHash, declarationAccepted }) {
  if (declarationAccepted !== true) throw new HttpError(400, 'declaration_required');
  const actor = actorFromSession(session);
  if (!actor.authUserId) throw new HttpError(401, 'authenticated_identity_required');
  const hash = reviewedContentHash(job.payload, { publicId: job.publicId, draftVersion: job.draftVersion });
  if (typeof reviewedHash !== 'string' || reviewedHash !== hash) throw new HttpError(409, 'preview_changed');
  try {
    return await recordAcceptedJob(db, { job, hash, session });
  } catch (e) {
    // The database was not migrated to 0006 (the audit action is not allowed yet): fail closed with a clear, non-secret answer. Nothing was recorded or started.
    if (/audit_log_action_check|publication_acceptance/.test(String(e?.message)) && !(e instanceof HttpError)) throw new HttpError(503, 'migration_required', { reasons: ['Publishing is paused: the database update for publisher confirmations has not been applied. Nothing was recorded. Tell an administrator.'] });
    throw e;
  }
}

async function recordAcceptedJob(db, { job, hash, session }) {
  const actor = actorFromSession(session);
  return db.begin(async (tx) => {
    const rows = await tx.unsafe('select id, version from listings.drafts where public_id = $1 and discarded_at is null for update', [job.publicId]);
    if (!rows[0] || rows[0].id !== job.draftId || rows[0].version !== job.draftVersion) throw new HttpError(409, 'draft_changed');
    const created = await createJob(tx, { ...job, payloadHash: hash, requestedBy: actor.email, requestedByAuthUser: actor.authUserId });
    await appendAudit(tx, { session, action: 'publication_acceptance', publicId: job.publicId, draftVersion: job.draftVersion, jobId: created.id,
      detail: { accepted: true, content_hash: hash, terms_version: INTERNAL_TERMS_VERSION } });
    return created;
  });
}

/** Is migration 0006 in place (the audit trail accepts publication acceptances)? Checked when a Publisher previews, so nobody ticks a box that cannot be recorded. */
export async function assertMigrated(db) {
  const rows = await db.unsafe("select 1 from pg_constraint where conname = 'audit_log_action_check' and pg_get_constraintdef(oid) like '%publication_acceptance%' limit 1");
  if (rows.length !== 1) throw new HttpError(503, 'migration_required', { reasons: ['Publishing is paused: the database update for publisher confirmations has not been applied. Nothing was recorded. Tell an administrator.'] });
}
