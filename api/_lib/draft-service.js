// Draft workflow: create, open, save, verify. Notion is only READ. Nothing here can change a public page: drafts live in the
// operational database and no code path writes to Notion, GitHub or Blob.
import { randomUUID } from 'node:crypto';
import { validateDraft, cleanContent, modeKeyFromLabel } from './draft-validation.js';
import * as repo from './drafts-repo.js';
import { HttpError, PUBLIC_ID_RE } from './http.js';
import { changedGroups, getProperty, listAllProperties } from './property.js';
import { loadCompliance, loadSnapshots } from './site.js';
import { systemItems, verificationState } from './verification.js';
import { APPROVAL_KEY, DESC_KEY, stable, approvalState, approveInvestment, approveDescription, descriptionApprovalState, stateOf, withoutApproval, withoutDescriptionApproval, optionalChoices } from './optional-fields.js';
import { photoReadiness, photoView, photosForRules, streetOf } from './photos.js';

export const DESIGN_TO_WEBSITE = { HPS: 'HPS', IL: 'IL', R: 'Robust', Robust: 'Robust', FA: 'FA', Basic: 'Basic' };

const sameContent = (a, b) => ['title', 'description', 'publicAddress', 'pricingMode', 'displayPrice', 'featured'].every((k) => (a?.[k] ?? '') === (b?.[k] ?? ''))
  && ['property', 'sdaFacts', 'investment', 'marketing'].every((k) => stable(a?.[k]) === stable(b?.[k]));
export const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };
export const needNotion = (cfg) => { if (!cfg.notion) throw new HttpError(503, 'notion_not_configured'); return cfg.notion; };

/**
 * Every public SDA fact the Publisher reviews, exactly as the website will store it: the CRM design categories and building type, plus the three SDA
 * facts typed in the draft. The signed request freezes it and the website refuses the job if its own result differs.
 */
export function reviewedSdaFor(property, draft) {
  const designCategories = (property?.designCategories ?? []).map((d) => DESIGN_TO_WEBSITE[d]).filter(Boolean);
  return { ...(designCategories.length ? { designCategories } : {}), ...(property?.buildType ? { buildingType: property.buildType } : {}), ...(draft?.content?.sdaFacts ?? {}) };
}

export async function context(cfg, prop, { fetchImpl }) {
  const [snaps, comp] = await Promise.all([loadSnapshots(cfg, { fetchImpl }).catch(() => null), loadCompliance(cfg, { fetchImpl })]);
  // a slug already used by ANOTHER listing is taken; the listing's own published slug is not (otherwise its draft would preview a suffixed address)
  const taken = new Set(snaps ? [...snaps.approved.values()].filter((s) => s.listingId !== prop.facts.id).map((s) => s.slug) : []);
  return {
    publicId: prop.facts.id, internal: prop.internal, crmState: prop.facts.state,
    designCategories: prop.facts.designCategories.map((d) => DESIGN_TO_WEBSITE[d]).filter(Boolean), buildType: prop.facts.buildType,
    takenSlugs: taken, compliance: comp.compliance, complianceUnavailable: comp.unavailable, onWebsite: snaps ? (snaps.approved.has(prop.facts.id) || snaps.withdrawn.has(prop.facts.id)) : null,
  };
}

function view({ draft, prop, ctx, history, canEdit, canPublish }) {
  const content = draft.content;
  const photos = Array.isArray(draft.photos) ? draft.photos : [];
  const validation = validateDraft(content, { ...ctx, photos: photosForRules(photos), draft });
  const pr = photoReadiness(photos, { street: streetOf(draft.label) });
  const ver = verificationState({ occupancy: prop.facts.occupancy, content, verification: draft.verification, notes: draft.notes });
  const systemErrors = ver.system.filter((i) => i.severity === 'error' && i.status === 'open');
  // text that claims more than the CRM supports is a PUBLICATION blocker, not an editing error: it can be saved and previewed, and the message says what to change
  const claimBlockers = systemErrors.map((i) => ({ code: i.code, message: i.text }));
  const blockers = [
    ...validation.blockers, ...claimBlockers,
    ...ver.open.filter((i) => i.severity === 'verify').map((i) => ({ code: i.code.startsWith('note:') ? 'verification_note' : 'verification', message: i.text })),
  ];
  const errorsAll = [...validation.errors];
  const fieldErrors = { ...validation.fieldErrors };
  const complete = validation.complete;
  // photograph rules: the automatic checks (description privacy, size, type, no metadata). Approving the listing approves its photographs.
  const photoBlockers = [
    ...pr.gallery.map((g) => ({ code: 'photos_required', message: g.message })),
    ...pr.items.flatMap((i) => i.issues.map((x) => ({ code: 'photo_alt', message: x.message }))),
  ];
  const blockersAll = [...blockers.filter((b) => b.code !== 'photos_required'), ...photoBlockers];
  return {
    draft: { id: draft.public_id, label: draft.label, version: draft.version, status: draft.status, content, createdBy: draft.created_by, createdAt: draft.created_at, updatedBy: draft.updated_by, updatedAt: draft.updated_at },
    property: { fullName: prop.facts.fullName, state: prop.facts.state, designCategories: prop.facts.designCategories, buildType: prop.facts.buildType, buildClass: prop.facts.buildClass, features: prop.facts.features, occupancy: prop.facts.occupancy, notionStatus: prop.facts.webStatus.label, editedAt: prop.facts.editedAt, suggestedPublicAddress: prop.suggestedPublicAddress },
    notion: { changed: changedGroups(draft.base_facts, prop.hashes), baseEditedAt: draft.base_notion_edited_at, currentEditedAt: prop.facts.editedAt },
    photos: photoView(draft),
    validation: { fieldErrors, errors: errorsAll, warnings: validation.warnings, blockers: blockersAll, slug: validation.slug, complete, publishable: complete && blockersAll.length === 0 },
    verification: { system: ver.system, notes: ver.staff, open: ver.blocking },
    preview: validation.preview,
    optional: { approval: { ...approvalState(draft), stateCode: stateOf(content.publicAddress), ...(canPublish && draft.verification?.[APPROVAL_KEY]?.source ? { source: draft.verification[APPROVAL_KEY].source } : {}) },
      descriptionApproval: { ...descriptionApprovalState(draft), stateCode: stateOf(content.publicAddress), ...(canPublish && draft.verification?.[DESC_KEY]?.source ? { source: draft.verification[DESC_KEY].source } : {}) }, choices: optionalChoices(), crmOccupancy: prop.facts.occupancy ?? null },
    history: (history ?? []).map((h) => ({ version: h.version, action: h.action, fields: h.changed_fields, by: h.changed_by, at: h.changed_at })),
    permissions: { canEdit, canPublish },
  };
}

export async function openDraft({ cfg, db, id, fetchImpl, caps }) {
  requireId(id);
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const prop = await getProperty(needNotion(cfg), id, { fetchImpl });
  if (!prop) throw new HttpError(409, 'property_unavailable');
  const [ctx, history] = await Promise.all([context(cfg, prop, { fetchImpl }), repo.getHistory(db, draft.id)]);
  return view({ draft, prop, ctx, history, ...caps });
}

export async function createDraftFor({ cfg, db, propertyId, actor, fetchImpl, caps }) {
  requireId(propertyId);
  const prop = await getProperty(needNotion(cfg), propertyId, { fetchImpl });
  if (!prop) throw new HttpError(404, 'property_not_found');
  const ctx = await context(cfg, prop, { fetchImpl });
  if (ctx.onWebsite === null) throw new HttpError(503, 'website_unreadable'); // cannot prove it is not already published
  if (ctx.onWebsite) throw new HttpError(409, 'already_published');
  // Start from what Notion already holds in the Web fields, else from safe suggestions.
  const w = prop.web;
  const suggested = (() => { try { return validateDraft({ publicAddress: prop.suggestedPublicAddress, description: 'x', pricingMode: 'contact_agent', title: '', displayPrice: '', featured: false }, ctx).fieldErrors.publicAddress ? '' : prop.suggestedPublicAddress; } catch { return ''; } })();
  const content = cleanContent({
    title: w.title, description: w.description, publicAddress: w.publicAddress || suggested,
    pricingMode: modeKeyFromLabel(w.pricingMode), displayPrice: w.displayPrice != null ? String(w.displayPrice) : '', featured: w.featured,
  });
  const draft = await repo.createDraft(db, { publicId: prop.facts.id, notionPageId: prop.pageId, label: prop.facts.label, content, baseFacts: prop.hashes, baseEditedAt: prop.facts.editedAt, actor });
  const history = await repo.getHistory(db, draft.id);
  return view({ draft, prop, ctx, history, ...caps });
}

export async function saveDraftFor({ cfg, db, body, actor, fetchImpl, caps }) {
  const id = requireId(body?.id);
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const prop = await getProperty(needNotion(cfg), id, { fetchImpl });
  if (!prop) throw new HttpError(409, 'property_unavailable');
  const ctx = await context(cfg, prop, { fetchImpl });
  const content = cleanContent(body.content ?? draft.content);

  if (body.dryRun === true) {
    // validation only: nothing is stored
    return view({ draft: { ...draft, content }, prop, ctx, history: [], ...caps });
  }
  if (!Number.isInteger(body.expectedVersion)) throw new HttpError(400, 'expected_version_required');
  const changed = changedGroups(draft.base_facts, prop.hashes);
  const acknowledge = body.acknowledgeNotionChange === true;
  if (changed.length && !acknowledge) throw new HttpError(409, 'notion_changed', { changed });

  const patch = { content };
  // Editing the commercial values withdraws their approval. The record is also removed (visibly) so a later edit back to the old values cannot revive it.
  if (draft.verification?.[APPROVAL_KEY] && stable(content.investment) !== stable(draft.content.investment)) patch.verification = withoutApproval(draft.verification);
  // An approved description is bound to its exact text and to the commercial values it was approved with: a change to either removes the record (visibly).
  {
    const after = { ...draft, content, verification: patch.verification ?? draft.verification };
    if (after.verification?.[DESC_KEY] && descriptionApprovalState(after).state === 'stale') patch.verification = withoutDescriptionApproval(after.verification);
  }
  let action = 'update';
  if (typeof body.addNote === 'string' && body.addNote.trim()) {
    const text = body.addNote.trim();
    if (text.length > 500) throw new HttpError(400, 'note_too_long');
    patch.notes = [...draft.notes, { id: randomUUID(), text, by: actor.email, at: new Date().toISOString(), status: 'open' }];
    action = 'note';
  }
  if (acknowledge && changed.length) { patch.baseFacts = prop.hashes; patch.baseEditedAt = prop.facts.editedAt; action = 'refresh_base'; }
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion: body.expectedVersion, action: action === 'note' && !sameContent(content, draft.content) ? 'update' : action, patch, actor, current: draft });
  const history = await repo.getHistory(db, saved.id);
  return view({ draft: saved, prop, ctx, history, ...caps });
}

/** Publisher only: acknowledge a system-detected item (with a note), or resolve a staff note. */
export async function verifyDraftFor({ cfg, db, body, actor, fetchImpl, caps }) {
  const id = requireId(body?.id);
  if (!Number.isInteger(body?.expectedVersion)) throw new HttpError(400, 'expected_version_required');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < 5 || note.length > 500) throw new HttpError(400, 'note_required');
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const prop = await getProperty(needNotion(cfg), id, { fetchImpl });
  if (!prop) throw new HttpError(409, 'property_unavailable');
  const patch = {};
  const at = new Date().toISOString();
  if (body.description === 'approve' || body.description === 'withdraw') {
    // Publisher only (the route's capability). Built here from the STORED draft and the session; nothing in the request is trusted except the confirmations and the source text.
    if (body.description === 'approve') {
      const rec = approveDescription(draft, { actor, now: new Date(at), state: stateOf(draft.content.publicAddress), confirmed: body.confirmed === true, source: body.source, victorianAcknowledged: body.victorianAcknowledged === true });
      patch.verification = { ...draft.verification, [DESC_KEY]: { ...rec, note } };
    } else {
      if (!draft.verification?.[DESC_KEY]) throw new HttpError(409, 'nothing_to_withdraw');
      patch.verification = withoutDescriptionApproval(draft.verification);
    }
    const savedD = await repo.updateDraft(db, { publicId: id, expectedVersion: body.expectedVersion, action: 'verify', patch, actor, current: draft });
    const [ctxD, historyD] = await Promise.all([context(cfg, prop, { fetchImpl }), repo.getHistory(db, savedD.id)]);
    return view({ draft: savedD, prop, ctx: ctxD, history: historyD, ...caps });
  }
  if (body.investment === 'approve' || body.investment === 'withdraw') {
    // Publisher only (the route's capability). The record is built here from the STORED values and the session: nothing in the request is trusted.
    if (body.investment === 'approve') {
      const rec = approveInvestment(draft, { actor, now: new Date(at), state: stateOf(draft.content.publicAddress), provider: body.providerAuthorised === true, confirmed: body.confirmed === true, crmOccupancy: prop.facts.occupancy, existingAdvertisement: body.existingAdvertisement === true, source: body.source });
      patch.verification = { ...draft.verification, [APPROVAL_KEY]: { ...rec, note } };
    } else {
      if (!draft.verification?.[APPROVAL_KEY]) throw new HttpError(409, 'nothing_to_withdraw');
      patch.verification = withoutApproval(draft.verification);
      if (patch.verification[DESC_KEY]) patch.verification = withoutDescriptionApproval(patch.verification);
    }
    const savedI = await repo.updateDraft(db, { publicId: id, expectedVersion: body.expectedVersion, action: 'verify', patch, actor, current: draft });
    const [ctxI, historyI] = await Promise.all([context(cfg, prop, { fetchImpl }), repo.getHistory(db, savedI.id)]);
    return view({ draft: savedI, prop, ctx: ctxI, history: historyI, ...caps });
  }
  // optional: where the accepted position comes from (for example the approved marketing advertisement). A plain https link only.
  const source = typeof body.source === 'string' && body.source.trim() ? body.source.trim() : null;
  if (source && (source.length > 300 || !/^https:\/\/[^\s<>"']+$/.test(source))) throw new HttpError(400, 'invalid_source');
  if (typeof body.noteId === 'string') {
    if (!draft.notes.some((n) => n.id === body.noteId && n.status === 'open')) throw new HttpError(404, 'note_not_found');
    patch.notes = draft.notes.map((n) => (n.id === body.noteId ? { ...n, status: 'resolved', resolvedBy: actor.email, resolvedAt: at, resolution: note } : n));
  } else {
    const item = systemItems({ occupancy: prop.facts.occupancy, content: draft.content }).find((i) => i.code === body.code);
    if (!item || item.severity !== 'verify') throw new HttpError(400, 'not_verifiable');
    patch.verification = { ...draft.verification, [item.code]: { basis: item.basis, by: actor.email, at, note, ...(source ? { source } : {}) } };
  }
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion: body.expectedVersion, action: 'verify', patch, actor, current: draft });
  const [ctx, history] = await Promise.all([context(cfg, prop, { fetchImpl }), repo.getHistory(db, saved.id)]);
  return view({ draft: saved, prop, ctx, history, ...caps });
}

export const PICKER_PAGE = 25;
export const PICKER_MAX = 50;
/**
 * Add listing: search EVERY property in the CRM on the server (all pages of Notion are read and cached briefly), and page through the matches.
 * Each match says what Add listing would do: 'new' (create a draft), 'draft' (open the existing draft), 'live' (already on the website: bring it in)
 * or 'withdrawn' (unavailable). Every word typed must appear in the address, in any order. Matches that start with what was typed come first.
 * Returns { properties, total, offset, limit, hasMore }: the screen never shows only "the first 100".
 */
export async function pickerFor({ cfg, db, fetchImpl, q, offset = 0, limit = PICKER_PAGE }) {
  const [rows, snaps, drafts] = await Promise.all([
    listAllProperties(needNotion(cfg), { fetchImpl }),
    loadSnapshots(cfg, { fetchImpl }).catch(() => null),
    repo.listDrafts(db).catch(() => []),
  ]);
  const words = String(q ?? '').trim().toLowerCase().slice(0, 80).split(/\s+/).filter(Boolean);
  const draftIds = new Set(drafts.map((d) => d.public_id));
  const start = Math.max(0, Number.isInteger(+offset) ? +offset : 0);
  const size = Math.min(PICKER_MAX, Math.max(1, Number.isInteger(+limit) ? +limit : PICKER_PAGE));
  const unnamed = (r) => r.fullName === '(untitled)';
  const all = rows
    .filter((r) => words.every((w) => r.fullName.toLowerCase().includes(w)))
    .map((r) => {
      const approved = snaps ? snaps.approved.has(r.id) : false;
      const withdrawn = snaps ? snaps.withdrawn.has(r.id) : false;
      const hasDraft = draftIds.has(r.id);
      return {
        id: r.id, name: r.fullName, state: r.state, designCategories: r.designCategories, buildType: r.buildType, notionStatus: r.webStatus,
        onWebsite: snaps ? approved || withdrawn : null, hasDraft, unnamed: unnamed(r),
        kind: withdrawn ? 'withdrawn' : hasDraft ? 'draft' : approved ? 'live' : 'new',
      };
    });
  const lead = words.length ? words[0] : '';
  const rank = (p) => (p.unnamed ? 3 : p.name.toLowerCase().startsWith(lead) ? 0 : p.name.toLowerCase().includes(' ' + lead) ? 1 : 2);
  all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const page = all.slice(start, start + size);
  return { properties: page, total: all.length, offset: start, limit: size, hasMore: start + size < all.length };
}

/** Light summary for the dashboard. No Notion call. */
export function draftSummary(d) {
  const c = d.content ?? {};
  const filled = ['title', 'description', 'publicAddress', 'pricingMode'].filter((k) => c[k]).length;
  return { id: d.public_id, label: d.label, version: d.version, updatedBy: d.updated_by, updatedAt: d.updated_at, createdBy: d.created_by, fieldsFilled: filled, fieldsTotal: 4, openNotes: (d.notes ?? []).filter((n) => n.status === 'open').length, photoCount: Array.isArray(d.photos) ? d.photos.length : 0 };
}
