// Draft workflow: create, open, save, verify. Notion is only READ. Nothing here can change a public page: drafts live in the
// operational database and no code path writes to Notion, GitHub or Blob.
import { randomUUID } from 'node:crypto';
import { validateDraft, cleanContent, modeKeyFromLabel } from './draft-validation.js';
import * as repo from './drafts-repo.js';
import { HttpError, PUBLIC_ID_RE } from './http.js';
import { changedGroups, getProperty, listAllProperties } from './property.js';
import { loadCompliance, loadSnapshots } from './site.js';
import { systemItems, verificationState } from './verification.js';

const DESIGN_TO_WEBSITE = { HPS: 'HPS', IL: 'IL', R: 'Robust', Robust: 'Robust', FA: 'FA', Basic: 'Basic' };

const sameContent = (a, b) => ['title', 'description', 'publicAddress', 'pricingMode', 'displayPrice', 'featured'].every((k) => (a?.[k] ?? '') === (b?.[k] ?? ''));
const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };
const needNotion = (cfg) => { if (!cfg.notion) throw new HttpError(503, 'notion_not_configured'); return cfg.notion; };

async function context(cfg, prop, { fetchImpl }) {
  const [snaps, comp] = await Promise.all([loadSnapshots(cfg, { fetchImpl }).catch(() => null), loadCompliance(cfg, { fetchImpl })]);
  const taken = new Set(snaps ? [...snaps.approved.values()].map((s) => s.slug) : []);
  return {
    publicId: prop.facts.id, internal: prop.internal, crmState: prop.facts.state,
    designCategories: prop.facts.designCategories.map((d) => DESIGN_TO_WEBSITE[d]).filter(Boolean), buildType: prop.facts.buildType,
    takenSlugs: taken, compliance: comp.compliance, complianceUnavailable: comp.unavailable, onWebsite: snaps ? (snaps.approved.has(prop.facts.id) || snaps.withdrawn.has(prop.facts.id)) : null,
  };
}

function view({ draft, prop, ctx, history, canEdit, canPublish }) {
  const content = draft.content;
  const validation = validateDraft(content, ctx);
  const ver = verificationState({ occupancy: prop.facts.occupancy, content, verification: draft.verification, notes: draft.notes });
  const systemErrors = ver.system.filter((i) => i.severity === 'error' && i.status === 'open');
  const blockers = [
    ...validation.blockers,
    ...ver.open.filter((i) => i.severity === 'verify').map((i) => ({ code: i.code.startsWith('note:') ? 'verification_note' : 'verification', message: i.text })),
  ];
  const errorsAll = [...validation.errors, ...systemErrors.map((i) => ({ code: i.code, field: 'description', message: i.text }))];
  const fieldErrors = { ...validation.fieldErrors };
  for (const e of systemErrors) (fieldErrors.description ??= []).push(e.text);
  const complete = validation.complete && systemErrors.length === 0;
  return {
    draft: { id: draft.public_id, label: draft.label, version: draft.version, status: draft.status, content, createdBy: draft.created_by, createdAt: draft.created_at, updatedBy: draft.updated_by, updatedAt: draft.updated_at },
    property: { fullName: prop.facts.fullName, state: prop.facts.state, designCategories: prop.facts.designCategories, buildType: prop.facts.buildType, buildClass: prop.facts.buildClass, features: prop.facts.features, occupancy: prop.facts.occupancy, notionStatus: prop.facts.webStatus.label, editedAt: prop.facts.editedAt, suggestedPublicAddress: prop.suggestedPublicAddress },
    notion: { changed: changedGroups(draft.base_facts, prop.hashes), baseEditedAt: draft.base_notion_edited_at, currentEditedAt: prop.facts.editedAt },
    validation: { fieldErrors, errors: errorsAll, warnings: validation.warnings, blockers, slug: validation.slug, complete, publishable: complete && blockers.length === 0 },
    verification: { system: ver.system, notes: ver.staff, open: ver.blocking },
    preview: validation.preview,
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
  let action = 'update';
  if (typeof body.addNote === 'string' && body.addNote.trim()) {
    const text = body.addNote.trim();
    if (text.length > 500) throw new HttpError(400, 'note_too_long');
    patch.notes = [...draft.notes, { id: randomUUID(), text, by: actor.email, at: new Date().toISOString(), status: 'open' }];
    action = 'note';
  }
  if (acknowledge && changed.length) { patch.baseFacts = prop.hashes; patch.baseEditedAt = prop.facts.editedAt; action = 'refresh_base'; }
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion: body.expectedVersion, action: action === 'note' && !sameContent(content, draft.content) ? 'update' : action, patch, actor });
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
  if (typeof body.noteId === 'string') {
    if (!draft.notes.some((n) => n.id === body.noteId && n.status === 'open')) throw new HttpError(404, 'note_not_found');
    patch.notes = draft.notes.map((n) => (n.id === body.noteId ? { ...n, status: 'resolved', resolvedBy: actor.email, resolvedAt: at, resolution: note } : n));
  } else {
    const item = systemItems({ occupancy: prop.facts.occupancy, content: draft.content }).find((i) => i.code === body.code);
    if (!item || item.severity !== 'verify') throw new HttpError(400, 'not_verifiable');
    patch.verification = { ...draft.verification, [item.code]: { basis: item.basis, by: actor.email, at, note } };
  }
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion: body.expectedVersion, action: 'verify', patch, actor });
  const [ctx, history] = await Promise.all([context(cfg, prop, { fetchImpl }), repo.getHistory(db, saved.id)]);
  return view({ draft: saved, prop, ctx, history, ...caps });
}

export async function pickerFor({ cfg, db, fetchImpl, q }) {
  const [rows, snaps, drafts] = await Promise.all([
    listAllProperties(needNotion(cfg), { fetchImpl }),
    loadSnapshots(cfg, { fetchImpl }).catch(() => null),
    repo.listDrafts(db).catch(() => []),
  ]);
  const term = String(q ?? '').trim().toLowerCase().slice(0, 80);
  const draftIds = new Set(drafts.map((d) => d.public_id));
  return rows
    .filter((r) => !term || r.fullName.toLowerCase().includes(term))
    .map((r) => ({
      id: r.id, name: r.fullName, state: r.state, designCategories: r.designCategories, buildType: r.buildType, notionStatus: r.webStatus,
      onWebsite: snaps ? snaps.approved.has(r.id) || snaps.withdrawn.has(r.id) : null,
      hasDraft: draftIds.has(r.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 100);
}

/** Light summary for the dashboard. No Notion call. */
export function draftSummary(d) {
  const c = d.content ?? {};
  const filled = ['title', 'description', 'publicAddress', 'pricingMode'].filter((k) => c[k]).length;
  return { id: d.public_id, label: d.label, version: d.version, updatedBy: d.updated_by, updatedAt: d.updated_at, createdBy: d.created_by, fieldsFilled: filled, fieldsTotal: 4, openNotes: (d.notes ?? []).filter((n) => n.status === 'open').length };
}
