// The private operational audit trail (listings.audit_log, migration 0005). Server side only.
// The actor is ALWAYS the verified session (email and Supabase user id from authorise()); there is no parameter through which a request body,
// a query string or a header could name someone else. The reason and the person never leave the Listings Manager: they are not part of any
// payload, pull request, commit, log line or public file. It is written by the withdrawal and by a public status change. 'reinstate' is allowed by the database (migration 0005) but is unused: reinstatement was cancelled by decision, and the extra permitted value stays harmlessly in place.
import { HttpError } from './http.js';

export const AUDIT_ACTIONS = ['status_change', 'withdraw', 'reinstate', 'publication_acceptance'];
const STATUSES = ['available', 'under_offer', 'sold'];

/** The actor as recorded: taken from the authenticated session only. Throws if there is not one. */
export function actorFromSession(session) {
  const email = String(session?.identity?.email ?? session?.staff?.email ?? '').trim().toLowerCase();
  if (!email) throw new HttpError(401, 'unauthenticated');
  const auth = session?.identity?.authUserId ?? null;
  return { email, authUserId: typeof auth === 'string' && /^[0-9a-f-]{36}$/i.test(auth) ? auth.toLowerCase() : null };
}

/** Appends one row. Validation errors are 400s; the database enforces the same rules again (checks, append-only triggers, grants). */
export async function appendAudit(db, { session, action, publicId, draftVersion = null, jobId = null, statusFrom = null, statusTo = null, reason = null, detail = {} }) {
  const actor = actorFromSession(session);
  if (!AUDIT_ACTIONS.includes(action)) throw new HttpError(400, 'invalid_audit_action');
  for (const s of [statusFrom, statusTo]) if (s !== null && !STATUSES.includes(s)) throw new HttpError(400, 'invalid_status');
  const text = reason === null || reason === undefined ? null : String(reason).trim();
  if (text !== null && (text.length < 1 || text.length > 300)) throw new HttpError(400, 'invalid_reason');
  if (action === 'withdraw' && text === null) throw new HttpError(400, 'reason_required');
  const rows = await db.unsafe(
    `insert into listings.audit_log (actor_email, actor_auth_user, action, public_id, draft_version, job_id, status_from, status_to, reason, detail)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text::jsonb) returning id, at`,
    [actor.email, actor.authUserId, action, publicId, draftVersion, jobId, statusFrom, statusTo, text, JSON.stringify(detail ?? {})]);
  return rows[0];
}

/** The trail for one listing, newest first. For Publishers and Administrators only (the caller enforces that). */
export async function readAudit(db, publicId, limit = 50) {
  return db.unsafe('select id, at, actor_email, action, draft_version, job_id, status_from, status_to, reason from listings.audit_log where public_id = $1 order by id desc limit $2', [publicId, Math.min(Math.max(1, limit | 0), 200)]);
}
