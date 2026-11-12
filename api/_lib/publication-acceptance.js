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
  return db.begin(async (tx) => {
    const rows = await tx.unsafe('select id, version from listings.drafts where public_id = $1 and discarded_at is null for update', [job.publicId]);
    if (!rows[0] || rows[0].id !== job.draftId || rows[0].version !== job.draftVersion) throw new HttpError(409, 'draft_changed');
    const created = await createJob(tx, { ...job, payloadHash: hash, requestedBy: actor.email, requestedByAuthUser: actor.authUserId });
    await appendAudit(tx, { session, action: 'publication_acceptance', publicId: job.publicId, draftVersion: job.draftVersion, jobId: created.id,
      detail: { accepted: true, content_hash: hash, terms_version: INTERNAL_TERMS_VERSION } });
    return created;
  });
}
