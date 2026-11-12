// Draft implementation: acceptance and job creation must share a transaction.
// This module is not yet connected to the publication route or UI.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
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

/** Issue a short-lived server-signed review token, bound to the authenticated Publisher and the exact reviewed version. */
export function issueReviewToken({ session, job, secret, now = Date.now() }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'review_not_configured');
  const actor = actorFromSession(session);
  if (!actor.authUserId) throw new HttpError(401, 'authenticated_identity_required');
  const body = { publicId: job.publicId, draftVersion: job.draftVersion, actorId: actor.authUserId,
    contentHash: reviewedContentHash(job.payload, { publicId: job.publicId, draftVersion: job.draftVersion }),
    terms: INTERNAL_TERMS_VERSION, expiresAt: now + 15 * 60 * 1000 };
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`publisher-review-v1.${encoded}`).digest('hex');
  return `${encoded}.${sig}`;
}

/** The token proves the server issued this review; identity, version and current content are checked again on submission. */
export async function createAcceptedJob(db, { session, job, reviewToken, secret, declarationAccepted, now = Date.now() }) {
  if (declarationAccepted !== true) throw new HttpError(400, 'declaration_required');
  if (typeof secret !== 'string' || secret.length < 32) throw new HttpError(503, 'review_not_configured');
  const actor = actorFromSession(session);
  if (!actor.authUserId) throw new HttpError(401, 'authenticated_identity_required');
  const hash = reviewedContentHash(job.payload, { publicId: job.publicId, draftVersion: job.draftVersion });
  const parts = typeof reviewToken === 'string' ? reviewToken.split('.') : [];
  if (parts.length !== 2 || !/^[a-f0-9]{64}$/.test(parts[1])) throw new HttpError(409, 'preview_changed');
  const expected = createHmac('sha256', secret).update(`publisher-review-v1.${parts[0]}`).digest();
  const supplied = Buffer.from(parts[1], 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(409, 'preview_changed');
  let review;
  try { review = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw new HttpError(409, 'preview_changed'); }
  if (review.publicId !== job.publicId || review.draftVersion !== job.draftVersion || review.actorId !== actor.authUserId || review.contentHash !== hash
      || review.terms !== INTERNAL_TERMS_VERSION || !Number.isFinite(review.expiresAt) || review.expiresAt < now) throw new HttpError(409, 'preview_changed');
  return db.begin(async (tx) => {
    const rows = await tx.unsafe('select id, version from listings.drafts where public_id = $1 and discarded_at is null for update', [job.publicId]);
    if (!rows[0] || rows[0].id !== job.draftId || rows[0].version !== job.draftVersion) throw new HttpError(409, 'draft_changed');
    const created = await createJob(tx, { ...job, payloadHash: hash, requestedBy: actor.email, requestedByAuthUser: actor.authUserId });
    await appendAudit(tx, { session, action: 'publication_acceptance', publicId: job.publicId, draftVersion: job.draftVersion, jobId: created.id,
      detail: { accepted: true, content_hash: hash, terms_version: INTERNAL_TERMS_VERSION } });
    return created;
  });
}
