// SQL for drafts. Every statement is parameterised. `db` is anything with unsafe(query, params) and begin(fn):
// postgres.js in production, a PGlite adapter in the tests (the same SQL runs against a real Postgres).
import { HttpError } from './http.js';

const COLS = `id, public_id, notion_page_id, label, status, content, notes, verification, base_facts, base_notion_edited_at,
  version, created_by, created_at, updated_by, updated_at, photos, photo_review`;

const changedKeys = (a, b) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])).sort();
};

export async function listDrafts(db) {
  return db.unsafe(`select ${COLS} from listings.drafts where discarded_at is null order by updated_at desc limit 200`);
}

export async function getDraft(db, publicId) {
  const rows = await db.unsafe(`select ${COLS} from listings.drafts where public_id = $1 and discarded_at is null`, [publicId]);
  return rows[0] ?? null;
}

export async function getHistory(db, draftId, limit = 25) {
  return db.unsafe('select version, action, changed_fields, changed_by, changed_at from listings.draft_history where draft_id = $1 order by id desc limit $2', [draftId, limit]);
}

/** The history fields that can change what the public sees (content, photographs, a refreshed Notion baseline). Notes, verification and photo review cannot. */
const PUBLIC_FIELDS = ['title', 'description', 'publicAddress', 'pricingMode', 'displayPrice', 'featured', 'photos', 'notionBaseline'];
/** Has anything public changed in this draft after `version`? Reads the draft history only. */
export async function publicChangesSince(db, draftId, version) {
  const rows = await db.unsafe(`select 1 from listings.draft_history where draft_id = $1 and version > $2 and action in ('update','refresh_base') and changed_fields && $3::text[] limit 1`, [draftId, version, PUBLIC_FIELDS]);
  return rows.length > 0;
}
/** The version at which this draft was imported from the website, or null. */
export async function importedVersion(db, draftId) {
  const rows = await db.unsafe(`select version from listings.draft_history where draft_id = $1 and 'importedFromPublished' = any(changed_fields) order by id limit 1`, [draftId]);
  return rows[0]?.version ?? null;
}

// NOTE jsonb parameters are cast through text ($n::text::jsonb): postgres.js re-serialises a string bound to a jsonb
// parameter, which stored the JSON text as a jsonb string scalar. Passing text keeps the value an object.
export async function createDraft(db, { publicId, notionPageId, label, content, baseFacts, baseEditedAt, actor, photos = [], extraFields = [] }) {
  return db.begin(async (tx) => {
    let rows;
    try {
      rows = await tx.unsafe(
        `insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, base_notion_edited_at, created_by, created_by_auth_user, updated_by, updated_by_auth_user, photos)
         values ($1,$2,$3,$4::text::jsonb,$5::text::jsonb,$6,$7,$8,$7,$8,$9::text::jsonb) returning ${COLS}`,
        [publicId, notionPageId, label, JSON.stringify(content), JSON.stringify(baseFacts), baseEditedAt ?? null, actor.email, actor.authUserId ?? null, JSON.stringify(photos)]);
    } catch (e) {
      if (/duplicate key|unique/i.test(e.message)) throw new HttpError(409, 'draft_exists');
      throw e;
    }
    const d = rows[0];
    await tx.unsafe(`insert into listings.draft_history (draft_id, version, action, changed_fields, content, changed_by, changed_by_auth_user) values ($1,$2,'create',$3,$4::text::jsonb,$5,$6)`,
      [d.id, d.version, [...Object.keys(content), ...(photos.length ? ['photos'] : []), ...extraFields].sort(), JSON.stringify(content), actor.email, actor.authUserId ?? null]);
    return d;
  });
}

/** What a patch changes, and the row it produces. Pure. */
function plan(cur, patch) {
  const next = {
    content: patch.content ?? cur.content,
    notes: patch.notes ?? cur.notes,
    verification: patch.verification ?? cur.verification,
    base_facts: patch.baseFacts ?? cur.base_facts,
    base_notion_edited_at: patch.baseEditedAt !== undefined ? patch.baseEditedAt : cur.base_notion_edited_at,
    photos: patch.photos ?? cur.photos ?? [],
    photo_review: patch.photoReview !== undefined ? patch.photoReview : (cur.photo_review ?? null),
  };
  const fields = [
    ...changedKeys(cur.content, next.content),
    ...(JSON.stringify(cur.photos ?? []) !== JSON.stringify(next.photos) ? ['photos'] : []),
    ...(JSON.stringify(cur.photo_review ?? null) !== JSON.stringify(next.photo_review) ? ['photoReview'] : []),
    ...(JSON.stringify(cur.notes) !== JSON.stringify(next.notes) ? ['notes'] : []),
    ...(JSON.stringify(cur.verification) !== JSON.stringify(next.verification) ? ['verification'] : []),
    ...(JSON.stringify(cur.base_facts) !== JSON.stringify(next.base_facts) ? ['notionBaseline'] : []),
  ];
  const params = [JSON.stringify(next.content), JSON.stringify(next.notes), JSON.stringify(next.verification), JSON.stringify(next.base_facts), next.base_notion_edited_at, JSON.stringify(next.photos), next.photo_review === null ? null : JSON.stringify(next.photo_review)];
  return { fields, params };
}

/**
 * Compare-and-set update. `patch` may carry content, notes, verification, baseFacts, baseEditedAt, photos, photoReview. Fails with
 * 409 if the version moved (someone else saved) and 404 if the draft is gone. Writes one history row with the actor.
 *
 * Speed: when the caller already holds the row it read at `expectedVersion` (`current`), the update and its history row go in ONE
 * statement (a data-modifying CTE, atomic like a transaction) guarded by `where version = expected`. That is one database round trip
 * instead of five (BEGIN, SELECT FOR UPDATE, UPDATE, INSERT, COMMIT), which matters when the database is an ocean away.
 * If the guard matches no row, the slow path below re-reads inside a transaction to say exactly why (404 or 409).
 */
export async function updateDraft(db, { publicId, expectedVersion, action, patch, actor, current }) {
  if (current && current.version === expectedVersion && current.public_id === publicId) {
    const { fields, params } = plan(current, patch);
    if (fields.length === 0) return current; // nothing changed: no new version, no noise in the history
    const rows = await db.unsafe(
      `with upd as (
         update listings.drafts set content=$2::text::jsonb, notes=$3::text::jsonb, verification=$4::text::jsonb, base_facts=$5::text::jsonb, base_notion_edited_at=$6,
                photos=$7::text::jsonb, photo_review=$8::text::jsonb, version = version + 1, updated_by=$9, updated_by_auth_user=$10, updated_at=now()
         where id=$1 and version=$11 and discarded_at is null returning ${COLS}),
       hist as (
         insert into listings.draft_history (draft_id, version, action, changed_fields, content, changed_by, changed_by_auth_user)
         select id, version, $12, $13::text[], content, $9, $10 from upd)
       select * from upd`,
      [current.id, ...params.slice(0, 5), params[5], params[6], actor.email, actor.authUserId ?? null, expectedVersion, action, fields]);
    if (rows[0]) return rows[0];
    // fall through: find out whether the draft is gone or simply changed
  }
  return db.begin(async (tx) => {
    const cur = (await tx.unsafe(`select ${COLS} from listings.drafts where public_id = $1 and discarded_at is null for update`, [publicId]))[0];
    if (!cur) throw new HttpError(404, 'draft_not_found');
    if (cur.version !== expectedVersion) throw new HttpError(409, 'draft_changed');
    const { fields, params } = plan(cur, patch);
    if (fields.length === 0) return cur;
    const rows = await tx.unsafe(
      `update listings.drafts set content=$2::text::jsonb, notes=$3::text::jsonb, verification=$4::text::jsonb, base_facts=$5::text::jsonb, base_notion_edited_at=$6,
              photos=$7::text::jsonb, photo_review=$8::text::jsonb, version = version + 1, updated_by=$9, updated_by_auth_user=$10, updated_at=now()
       where id=$1 returning ${COLS}`,
      [cur.id, ...params, actor.email, actor.authUserId ?? null]);
    const d = rows[0];
    await tx.unsafe(`insert into listings.draft_history (draft_id, version, action, changed_fields, content, changed_by, changed_by_auth_user) values ($1,$2,$3,$4,$5::text::jsonb,$6,$7)`,
      [d.id, d.version, action, fields, JSON.stringify(d.content), actor.email, actor.authUserId ?? null]);
    return d;
  });
}

export async function discardDraft(db, { publicId, expectedVersion, actor }) {
  return db.begin(async (tx) => {
    const cur = (await tx.unsafe(`select ${COLS} from listings.drafts where public_id = $1 and discarded_at is null for update`, [publicId]))[0];
    if (!cur) throw new HttpError(404, 'draft_not_found');
    if (cur.version !== expectedVersion) throw new HttpError(409, 'draft_changed');
    await tx.unsafe('update listings.drafts set discarded_at = now(), discarded_by = $2, version = version + 1, updated_by = $2, updated_at = now() where id = $1', [cur.id, actor.email]);
    await tx.unsafe(`insert into listings.draft_history (draft_id, version, action, changed_fields, content, changed_by, changed_by_auth_user) values ($1,$2,'discard','{}',$3::text::jsonb,$4,$5)`,
      [cur.id, cur.version + 1, JSON.stringify(cur.content), actor.email, actor.authUserId ?? null]);
    return true;
  });
}
