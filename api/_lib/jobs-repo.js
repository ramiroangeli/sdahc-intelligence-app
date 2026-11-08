// SQL for publication jobs. Every statement is parameterised. `db` is anything with unsafe(query, params) (postgres.js or the PGlite adapter).
import { HttpError } from './http.js';

const COLS = `id, public_id, draft_id, draft_version, kind, attempt, status, step, steps, payload_hash, requested_by, approver_notion_user_id,
  idempotency_key, run_id, run_url, result, error_code, error_message, created_at, updated_at, started_at, finished_at`;
export const ACTIVE = ['queued', 'dispatched', 'running'];
export const isActive = (j) => ACTIVE.includes(j?.status);

export async function getJob(db, id, { withPayload = false } = {}) {
  const rows = await db.unsafe(`select ${COLS}${withPayload ? ', payload' : ''} from listings.publish_jobs where id = $1`, [id]);
  return rows[0] ?? null;
}
export async function listJobs(db, publicId, limit = 10) {
  return db.unsafe(`select ${COLS} from listings.publish_jobs where public_id = $1 order by created_at desc limit $2`, [publicId, limit]);
}
export async function latestJob(db, publicId, draftVersion, kind) {
  return (await db.unsafe(`select ${COLS} from listings.publish_jobs where public_id = $1 and draft_version = $2 and kind = $3 order by attempt desc limit 1`, [publicId, draftVersion, kind]))[0] ?? null;
}
export async function countAttempts(db, publicId, draftVersion, kind) {
  return (await db.unsafe('select count(*)::int c from listings.publish_jobs where public_id = $1 and draft_version = $2 and kind = $3', [publicId, draftVersion, kind]))[0].c;
}

/** Insert. The partial unique index makes a second ACTIVE job for the same listing fail with 409 (two clicks, two people). */
export async function createJob(db, j) {
  try {
    const rows = await db.unsafe(
      `insert into listings.publish_jobs (id, public_id, draft_id, draft_version, kind, attempt, payload, payload_hash, requested_by, requested_by_auth_user, approver_notion_user_id, idempotency_key, steps)
       values ($13,$1,$2,$3,$4,$5,$6::text::jsonb,$7,$8,$9,$10,$11,$12::text::jsonb) returning ${COLS}`,
      [j.publicId, j.draftId, j.draftVersion, j.kind, j.attempt, JSON.stringify(j.payload), j.payloadHash, j.requestedBy, j.requestedByAuthUser ?? null, j.approverNotionUserId ?? null, j.idempotencyKey,
        JSON.stringify([{ step: 'requested', status: 'ok', at: new Date().toISOString() }]), j.id]);
    return rows[0];
  } catch (e) {
    if (/publish_jobs_one_active_per_listing/.test(e.message)) throw new HttpError(409, 'job_active');
    if (/idempotency_key/.test(e.message)) throw new HttpError(409, 'job_exists');
    throw e;
  }
}

/** Marks the job dispatched and stores the run. Only moves a queued job forward. */
export async function markDispatched(db, id, run) {
  const rows = await db.unsafe(
    `update listings.publish_jobs set status = 'dispatched', step = 'dispatched', run_id = coalesce($2, run_id), run_url = coalesce($3, run_url), updated_at = now(),
            steps = steps || $4::text::jsonb where id = $1 and status = 'queued' returning ${COLS}`,
    [id, run?.id ?? null, run?.url ?? null, JSON.stringify([{ step: 'dispatched', status: 'ok', at: new Date().toISOString() }])]);
  return rows[0] ?? null;
}
export async function setRun(db, id, run) {
  await db.unsafe('update listings.publish_jobs set run_id = $2, run_url = $3, updated_at = now() where id = $1 and run_id is null', [id, run.id, run.url]);
}

/**
 * Applies one progress event from the job. A finished job is immutable: late or repeated events are ignored (idempotent). Moves only forward.
 * One statement, so two events arriving together cannot lose each other.
 */
export async function applyEvent(db, id, ev) {
  const at = new Date().toISOString();
  const entry = [{ step: ev.step, status: ev.status, at, ...(ev.detail ? { detail: ev.detail } : {}) }];
  const terminal = ev.step === 'finished' && (ev.status === 'succeeded' || ev.status === 'failed');
  const newStatus = terminal ? ev.status : 'running';
  const rows = await db.unsafe(
    `update listings.publish_jobs set status = $2, step = $3, steps = steps || $4::text::jsonb, updated_at = now(),
            started_at = coalesce(started_at, now()),
            finished_at = case when $5 then now() else finished_at end,
            result = case when $5 then $6::text::jsonb else result end,
            error_code = case when $5 and $2 = 'failed' then $7 else error_code end,
            error_message = case when $5 and $2 = 'failed' then $8 else error_message end
     where id = $1 and status in ('queued','dispatched','running') and jsonb_array_length(steps) < 60 returning ${COLS}`,
    [id, newStatus, ev.step, JSON.stringify(entry), terminal, terminal && ev.detail ? JSON.stringify(ev.detail) : null, ev.detail?.code ?? null, ev.detail?.message ?? null]);
  return rows[0] ?? null; // null = already finished (or flooded): ignored
}

/** Marks an unfinished job failed from outside (the workflow ended without reporting, or it timed out). */
export async function failJob(db, id, code, message) {
  const rows = await db.unsafe(
    `update listings.publish_jobs set status = 'failed', step = 'finished', error_code = $2, error_message = $3, finished_at = now(), updated_at = now(),
            steps = steps || $4::text::jsonb where id = $1 and status in ('queued','dispatched','running') returning ${COLS}`,
    [id, code, message.slice(0, 300), JSON.stringify([{ step: 'finished', status: 'failed', at: new Date().toISOString(), detail: { code, message: message.slice(0, 300) } }])]);
  return rows[0] ?? null;
}
