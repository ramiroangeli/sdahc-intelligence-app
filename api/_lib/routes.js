// The Listings endpoints, each built only through guardedRoute (authorisation first, always).
import { loadDataConfig } from './config.js';
import { draftsConfigured, getDb } from './db.js';
import { createDraftFor, draftSummary, openDraft, pickerFor, saveDraftFor, verifyDraftFor } from './draft-service.js';
import { listDrafts, discardDraft } from './drafts-repo.js';
import { audit } from './audit.js';
import { buildListings } from './listings-service.js';
import { guardedRoute } from './guard.js';
import { HttpError, queryOf, readBuffer, readJson } from './http.js';
import { MAX_BYTES } from './photo-process.js';
import { addPhoto, readPhoto, saveGallery } from './photos.js';
import { CAPABILITIES as C, hasCapability } from './permissions.js';

const dataCfg = (deps) => deps.dataConfig ?? loadDataConfig(deps.env ?? process.env);
const f = (deps) => deps.fetch ?? fetch;
const actorOf = (session) => ({ email: session.staff.email, authUserId: session.identity.authUserId });
const capsOf = (session) => ({ caps: { canEdit: hasCapability(session.staff, C.EDIT), canPublish: hasCapability(session.staff, C.PUBLISH) } });

export const listRoute = guardedRoute({
  capability: C.VIEW,
  run: async ({ deps }) => {
    let drafts = null;
    if (draftsConfigured(deps, deps.env ?? process.env)) {
      try { drafts = { state: 'ok', items: (await listDrafts(getDb(deps, deps.env ?? process.env))).map(draftSummary) }; } catch { drafts = { state: 'error', items: [] }; }
    }
    return buildListings(dataCfg(deps), { fetchImpl: f(deps), drafts });
  },
});

export const meRoute = guardedRoute({
  capability: C.VIEW,
  run: ({ session }) => ({
    email: session.staff.email,
    capabilities: session.staff.capabilities,
    canEdit: hasCapability(session.staff, C.EDIT),
    canPublish: hasCapability(session.staff, C.PUBLISH),
  }),
});

/** Property picker: Notion Properties that can start a draft. Editors only. */
export const propertiesRoute = guardedRoute({
  capability: C.EDIT,
  run: async ({ req, deps }) => ({ properties: await pickerFor({ cfg: dataCfg(deps), db: getDb(deps), fetchImpl: f(deps), q: queryOf(req).q }) }),
});

/** One draft. Read: any staff. Create, save, discard: Editors. */
export const draftRoute = guardedRoute({
  capability: { GET: C.VIEW, POST: C.EDIT, PUT: C.EDIT, DELETE: C.EDIT },
  run: async ({ req, session, deps }) => {
    const base = { cfg: dataCfg(deps), db: getDb(deps), fetchImpl: f(deps), ...capsOf(session) };
    const actor = actorOf(session);
    if (req.method === 'GET') return openDraft({ ...base, id: queryOf(req).id });
    const body = await readJson(req);
    if (req.method === 'POST') {
      const out = await createDraftFor({ ...base, propertyId: body?.propertyId, actor });
      audit({ action: 'listings.draft.create', outcome: 'ok', actor, detail: { id: out.draft.id } });
      return out;
    }
    if (req.method === 'PUT') {
      const out = await saveDraftFor({ ...base, body, actor });
      if (body?.dryRun !== true) audit({ action: 'listings.draft.save', outcome: 'ok', actor, detail: { id: out.draft.id, version: out.draft.version } });
      return out;
    }
    // DELETE: discard (kept in history, never removed)
    if (!Number.isInteger(body?.expectedVersion)) throw new HttpError(400, 'expected_version_required');
    await discardDraft(base.db, { publicId: body?.id, expectedVersion: body.expectedVersion, actor });
    audit({ action: 'listings.draft.discard', outcome: 'ok', actor, detail: { id: body.id } });
    return { discarded: true };
  },
});

/** Publisher-only: acknowledge a commercial verification item or resolve a note. */
export const draftVerifyRoute = guardedRoute({
  capability: { POST: C.PUBLISH },
  run: async ({ req, session, deps }) => {
    const out = await verifyDraftFor({ cfg: dataCfg(deps), db: getDb(deps), fetchImpl: f(deps), body: await readJson(req), actor: actorOf(session), ...capsOf(session) });
    audit({ action: 'listings.draft.verify', outcome: 'ok', actor: actorOf(session), detail: { id: out.draft.id } });
    return out;
  },
});

/** Draft photographs. Upload (raw image bytes) and gallery edits are Editor-only; every change is a versioned draft save. */
export const draftPhotosRoute = guardedRoute({
  capability: { POST: C.EDIT, PUT: C.EDIT },
  run: async ({ req, session, deps }) => {
    const env = deps.env ?? process.env;
    const base = { cfg: dataCfg(deps), db: getDb(deps), fetchImpl: f(deps), ...capsOf(session) };
    const actor = actorOf(session);
    const q = queryOf(req);
    let id;
    if (req.method === 'POST') {
      id = q.id;
      const body = await readBuffer(req, MAX_BYTES);
      const saved = await addPhoto({ db: base.db, deps, env, id, body, declaredType: req.headers?.['x-image-type'], expectedVersion: Number(q.expectedVersion), replaceId: q.replace || undefined, kind: q.kind, actor });
      audit({ action: q.replace ? 'listings.photo.replace' : 'listings.photo.add', outcome: 'ok', actor, detail: { id, version: saved.version } });
    } else {
      const body = await readJson(req);
      id = body?.id;
      const { saved, removed } = await saveGallery({ db: base.db, deps, env, id, expectedVersion: body?.expectedVersion, items: body?.photos, coverId: body?.coverId, actor });
      audit({ action: 'listings.photo.save', outcome: 'ok', actor, detail: { id, version: saved.version, removed } });
    }
    return openDraft({ ...base, id });
  },
});

/** One staged image. Read-only staff can view; the bytes are fetched with the user's session, never from a public URL. */
export const draftPhotoRoute = guardedRoute({
  capability: C.VIEW,
  run: async ({ req, deps }) => {
    const q = queryOf(req);
    return readPhoto({ db: getDb(deps), deps, env: deps.env ?? process.env, id: q.id, photoId: q.photo, w: q.w });
  },
});
