// The Listings endpoints, each built only through guardedRoute (authorisation first, always).
import { loadDataConfig } from './config.js';
import { draftsConfigured, getDb } from './db.js';
import { createDraftFor, draftSummary, openDraft, pickerFor, saveDraftFor, verifyDraftFor } from './draft-service.js';
import { importPublishedFor } from './import-published.js';
import { listDrafts, discardDraft } from './drafts-repo.js';
import { audit } from './audit.js';
import { buildListings } from './listings-service.js';
import { guardedRoute } from './guard.js';
import { signedRoute } from './signed.js';
import * as jobsRepo from './jobs-repo.js';
import { isJobId, sanitiseEvent } from './publication.js';
import { reviewedContentHash } from './publication-acceptance.js';
import { jobsFor, startPublication } from './publish-service.js';
import { startWithdrawal } from './withdrawal.js';
import { checkPublicMedia } from './public-media.js';
import { checkGithubApp } from './github-app.js';
import { HttpError, queryOf, readBuffer, readJson } from './http.js';
import { MAX_BYTES } from './photo-process.js';
import { addPhoto, photoLight, readPhoto, saveGallery } from './photos.js';
import { CAPABILITIES as C, hasCapability } from './permissions.js';

const dataCfg = (deps) => deps.dataConfig ?? loadDataConfig(deps.env ?? process.env);
const f = (deps) => deps.fetch ?? fetch;
const actorOf = (session) => ({ email: session.staff.email, authUserId: session.identity.authUserId });
const capsOf = (session) => ({ caps: { canEdit: hasCapability(session.staff, C.EDIT), canPublish: hasCapability(session.staff, C.PUBLISH) } });

export const listRoute = guardedRoute({
  capability: C.VIEW,
  run: async ({ deps, session }) => {
    let drafts = null; let draftRows = []; let lastJobs = new Map(); let lastSuccess = new Map();
    if (draftsConfigured(deps, deps.env ?? process.env)) {
      try {
        const db = getDb(deps, deps.env ?? process.env);
        draftRows = await listDrafts(db);
        drafts = { state: 'ok', items: draftRows.map(draftSummary) };
        lastJobs = await jobsRepo.lastRealJobs(db).catch(() => new Map());
        lastSuccess = await jobsRepo.lastSuccessfulJobs(db).catch(() => new Map());
      } catch { drafts = { state: 'error', items: [] }; draftRows = []; }
    }
    return buildListings(dataCfg(deps), { fetchImpl: f(deps), drafts, draftRows, lastJobs, lastSuccess, admin: hasCapability(session.staff, C.ADMIN) });
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
  run: async ({ req, deps }) => { const q = queryOf(req); return pickerFor({ cfg: dataCfg(deps), db: getDb(deps), fetchImpl: f(deps), q: q.q, offset: q.offset, limit: q.limit }); },
});

/** One draft. Read: any staff. Create, save, discard: Editors. */
export const draftRoute = guardedRoute({
  capability: { GET: C.VIEW, POST: C.EDIT, PUT: C.EDIT, DELETE: C.EDIT },
  run: async ({ req, session, deps }) => {
    const base = { cfg: dataCfg(deps), db: getDb(deps), fetchImpl: f(deps), ...capsOf(session) };
    const actor = actorOf(session);
    if (req.method === 'GET') return openDraft({ ...base, id: queryOf(req).id });
    const body = await readJson(req);
    if (req.method === 'POST' && body?.importPublished === true) {
      // adopting an already published listing is a Publisher's decision (and needs Editor to hold the draft): same endpoint, no new function
      const env = deps.env ?? process.env;
      try {
        if (!hasCapability(session.staff, C.PUBLISH)) throw new HttpError(403, 'forbidden');
        const out = await importPublishedFor({ ...base, propertyId: body?.propertyId, actor, deps, env });
        audit({ action: out.alreadyImported ? 'listings.draft.import.existing' : 'listings.draft.import', outcome: 'ok', actor, detail: { id: out.draft.id, ...(out.imported ? { fromVersion: out.imported.fromVersion, photos: out.imported.photos, files: out.imported.files } : {}) } });
        return out;
      } catch (e) {
        audit({ action: 'listings.draft.import', outcome: 'failed', actor, detail: { id: typeof body?.propertyId === 'string' ? body.propertyId : null, code: e?.code ?? 'error', status: e?.status ?? null } });
        throw e;
      }
    }
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

/** Draft photographs. Upload (raw image bytes) and gallery edits are Editor-only. Responses are small: no Notion or GitHub round trip. */
export const draftPhotosRoute = guardedRoute({
  capability: { POST: C.EDIT, PUT: C.EDIT },
  run: async ({ req, session, deps }) => {
    const env = deps.env ?? process.env;
    const db = getDb(deps);
    const actor = actorOf(session);
    const q = queryOf(req);
    if (req.method === 'POST') {
      const body = await readBuffer(req, MAX_BYTES);
      const out = await addPhoto({ db, deps, env, id: q.id, body, declaredType: req.headers?.['x-image-type'], replaceId: q.replace || undefined, kind: q.kind, actor });
      audit({ action: q.replace ? 'listings.photo.replace' : 'listings.photo.add', outcome: 'ok', actor, detail: { id: q.id, version: out.draft.version } });
      return out;
    }
    const body = await readJson(req);
    const { saved, removed } = await saveGallery({ db, deps, env, id: body?.id, expectedVersion: body?.expectedVersion, items: body?.photos, coverId: body?.coverId, actor });
    audit({ action: 'listings.photo.save', outcome: 'ok', actor, detail: { id: body.id, version: saved.version, removed } });
    return photoLight(saved, {});
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

/** Publication jobs for one draft. Read: any staff. Start: Publishers. Increment 1 enables the dry run only; the job itself runs on GitHub. */
export const draftPublishRoute = guardedRoute({
  capability: { GET: C.VIEW, POST: C.PUBLISH },
  run: async ({ req, session, deps }) => {
    const cfg = dataCfg(deps); const db = getDb(deps); const env = deps.env ?? process.env;
    if (req.method === 'GET') return jobsFor({ cfg, db, id: queryOf(req).id, fetchImpl: f(deps), env, canPublish: hasCapability(session.staff, C.PUBLISH) });
    const body = await readJson(req);
    // a withdrawal carries no listing content and has its own rules (typed address, private reason, private audit record)
    if (body?.mode === 'withdraw') return startWithdrawal({ cfg, db, id: body?.id, body, actor: actorOf(session), session, fetchImpl: f(deps), env });
    const out = await startPublication({ cfg, db, id: body?.id, expectedVersion: body?.expectedVersion, kind: body?.mode, commercialStatus: body?.commercialStatus, expectedStatus: body?.expectedStatus, session, actor: actorOf(session), staff: session.staff, fetchImpl: f(deps), env, deps, ...capsOf(session) });
    return out;
  },
});

/** Called by the website's publication job (signed). Progress events; a finished job ignores late or repeated events. */
export const publishCallbackRoute = signedRoute({
  methods: ['POST'],
  run: async ({ raw, deps }) => {
    let body; try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'invalid_json'); }
    const ev = sanitiseEvent(body);
    const db = getDb(deps);
    const job = await jobsRepo.getJob(db, ev.jobId);
    if (!job) throw new HttpError(404, 'job_not_found');
    const applied = await jobsRepo.applyEvent(db, ev.jobId, ev);
    audit({ action: 'listings.publish.event', outcome: applied ? 'ok' : 'ignored', detail: { jobId: ev.jobId, step: ev.step, status: ev.status } });
    return { ok: true, ignored: !applied };
  },
});

/** Called by the job (signed): the frozen approved public content for ONE active job. Never available after the job has finished. */
export const publishPayloadRoute = signedRoute({
  methods: ['GET'],
  run: async ({ req, deps }) => {
    const id = queryOf(req).job;
    if (!isJobId(id)) throw new HttpError(400, 'invalid_job');
    const db = getDb(deps);
    const job = await jobsRepo.getJob(db, id, { withPayload: true });
    if (!job) throw new HttpError(404, 'job_not_found');
    if (!jobsRepo.isActive(job)) throw new HttpError(410, 'job_finished');
    if (job.payload?.version === 2) {
      const hash = reviewedContentHash(job.payload, { publicId: job.public_id, draftVersion: job.draft_version });
      const accepted = await db.unsafe("select 1 from listings.audit_log where job_id = $1 and public_id = $2 and draft_version = $3 and action = 'publication_acceptance' and detail->>'content_hash' = $4 and detail->'accepted' = 'true'::jsonb limit 1", [id, job.public_id, job.draft_version, hash]);
      if (hash !== job.payload_hash || accepted.length !== 1) throw new HttpError(409, 'declaration_not_verified');
    }
    audit({ action: 'listings.publish.payload', outcome: 'ok', detail: { jobId: id } });
    return job.payload;
  },
});

/** Administrators only: can this deployment reach the public image store? GET reads; POST also writes and deletes one probe file. */
export const publicMediaCheckRoute = guardedRoute({
  capability: C.ADMIN,
  methods: ['GET', 'POST'],
  run: async ({ req, deps }) => {
    const out = await checkPublicMedia({ deps, env: deps.env ?? process.env, write: req.method === 'POST' });
    audit({ action: 'listings.publicmedia.check', outcome: out.ok ? 'ok' : 'failed', detail: { write: req.method === 'POST' } });
    return out;
  },
});

/** Administrators only, read only: can this deployment obtain a GitHub App token for the website repository? Starts nothing. */
export const githubAppCheckRoute = guardedRoute({
  capability: C.ADMIN,
  methods: ['GET'],
  run: async ({ deps }) => {
    const env = deps.env ?? process.env;
    const out = await checkGithubApp({ env, repo: dataCfg(deps).repo, workflow: (env.LISTINGS_PUBLISH_WORKFLOW || 'publish-listing.yml').trim(), fetchImpl: f(deps) });
    audit({ action: 'listings.githubapp.check', outcome: out.ok ? 'ok' : 'failed', detail: {} });
    return out;
  },
});
