// SQL for drafts. Every statement is parameterised. `db` is anything with unsafe(query, params) and begin(fn):
// postgres.js in production, a PGlite adapter in the tests (the same SQL runs against a real Postgres).
import { HttpError } from './http.js';

const COLS = `id, public_id, notion_page_id, label, status, content, notes, verification, base_facts, base_notion_edited_at,
  version, created_by, created_at, updated_by, updated_at, photos`;

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

// NOTE jsonb parameters are cast through text ($n::text::jsonb): postgres.js re-serialises a string bound to a jsonb
// parameter, which stored the JSON text as a jsonb string scalar. Passing text keeps the value an object.
export async function createDraft(db, { publicId, notionPageId, label, content, baseFacts, baseEditedAt, actor }) {
  return db.begin(async (tx) => {
    let rows;
    try {
      rows = await tx.unsafe(
        `insert into listings.drafts (public_id, notion_page_id, label, content, base_facts, base_notion_edited_at, created_by, created_by_auth_user, updated_by, updated_by_auth_user)
         values ($1,$2,$3,$4::text::jsonb,$5::text::jsonb,$6,$7,$8,$7,$8) returning ${COLS}`,
        [publicId, notionPageId, label, JSON.stringify(content), JSON.stringify(baseFacts), baseEditedAt ?? null, actor.email, actor.authUserId ?? null]);
    } catch (e) {
      if (/duplicate key|unique/i.test(e.message)) throw new HttpError(409, 'draft_exists');
      throw e;
    }
    const d = rows[0];
    await tx.unsafe(`insert into listings.draft_history (draft_id, version, action, changed_fields, content, changed_by, changed_by_auth_user) values ($1,$2,'create',$3,$4::text::jsonb,$5,$6)`,
      [d.id, d.version, Object.keys(content).sort(), JSON.stringify(content), actor.email, actor.authUserId ?? null]);
    return d;
  });
}

/**
 * Compare-and-set update. `patch` may carry content, notes, verification, baseFacts, baseEditedAt. Fails with 409 if the
 * version moved (someone else saved) and 404 if the draft is gone. Writes one history row with the actor.
 */
export async function updateDraft(db, { publicId, expectedVersion, action, patch, actor }) {
  return db.begin(async (tx) => {
    const cur = (await tx.unsafe(`select ${COLS} from listings.drafts where public_id = $1 and discarded_at is null for update`, [publicId]))[0];
    if (!cur) throw new HttpError(404, 'draft_not_found');
    if (cur.version !== expectedVersion) throw new HttpError(409, 'draft_changed');
    const next = {
      content: patch.content ?? cur.content,
      notes: patch.notes ?? cur.notes,
      verification: patch.verification ?? cur.verification,
      base_facts: patch.baseFacts ?? cur.base_facts,
      base_notion_edited_at: patch.baseEditedAt !== undefined ? patch.baseEditedAt : cur.base_notion_edited_at,
      photos: patch.photos ?? cur.photos ?? [],
    };
    const fields = [
      ...changedKeys(cur.content, next.content),
      ...(JSON.stringify(cur.photos ?? []) !== JSON.stringify(next.photos) ? ['photos'] : []),
      ...(JSON.stringify(cur.notes) !== JSON.stringify(next.notes) ? ['notes'] : []),
      ...(JSON.stringify(cur.verification) !== JSON.stringify(next.verification) ? ['verification'] : []),
      ...(JSON.stringify(cur.base_facts) !== JSON.stringify(next.base_facts) ? ['notionBaseline'] : []),
    ];
    if (fields.length === 0) return cur; // nothing changed: no new version, no noise in the history
    const rows = await tx.unsafe(
      `update listings.drafts set content=$2::text::jsonb, notes=$3::text::jsonb, verification=$4::text::jsonb, base_facts=$5::text::jsonb, base_notion_edited_at=$6, photos=$9::text::jsonb,
              version = version + 1, updated_by=$7, updated_by_auth_user=$8, updated_at=now()
       where id=$1 returning ${COLS}`,
      [cur.id, JSON.stringify(next.content), JSON.stringify(next.notes), JSON.stringify(next.verification), JSON.stringify(next.base_facts), next.base_notion_edited_at, actor.email, actor.authUserId ?? null, JSON.stringify(next.photos)]);
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
