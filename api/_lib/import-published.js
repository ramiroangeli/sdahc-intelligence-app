// Adopts a listing that is ALREADY PUBLISHED (it was published before the Listings Manager existed) so it can be managed here.
//
// What it does, in this order, and nothing else:
//   1. reads the property from Notion (read only) and the approved snapshot from the website repository (read only)
//   2. checks the snapshot: its content hash, the website's own content schema, its public address, its photograph file names
//   3. downloads each existing public WebP variant and checks it is a real WebP of the stated width (bytes are never altered)
//   4. proves the draft it is about to create would reproduce the published listing exactly (the same comparison the website job makes)
//   5. writes the identical bytes to PRIVATE staging, then creates ONE draft (with its gallery) in one database transaction
//
// What it never does: write to Notion, GitHub, the public Blob store or the website; change the live listing; start a publication job.
// The photograph ids, file names, alt text, order and floorplan flag are the published ones, so public image URLs do not change.
// Safe to repeat: when a draft already exists it is returned untouched.
import sharp from 'sharp';
import * as core from './vendor/listings-core.mjs';
import { context, needNotion, openDraft, requireId } from './draft-service.js';
import { validateDraft, cleanContent } from './draft-validation.js';
import * as repo from './drafts-repo.js';
import { HttpError } from './http.js';
import { MAX_BYTES } from './photo-process.js';
import { MAX_PHOTOS, canonical, photosForRules } from './photos.js';
import { photoStore, stagingPath } from './photo-store.js';
import { getProperty } from './property.js';
import { loadApprovedSnapshot, loadSnapshots, publishedOptional } from './site.js';
import { APPROVAL_KEY, stable } from './optional-fields.js';

const PUBLIC_HOST_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/(lst_[a-f0-9]{10})\/([a-f0-9]{12})-(\d{2,4})\.webp$/;
const PRICE_MODES = ['asking_price', 'price_guide', 'eoi', 'contact_agent'];
const paragraphs = (raw) => String(raw).split(/\n\s*\n/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
const refuse = (code, reason, extra = {}) => new HttpError(409, code, { reasons: [reason], ...extra });

/** Checks the snapshot is trustworthy and has the shape this import understands. Returns problems (names only). */
function snapshotProblems(snap, publicId) {
  const out = [];
  if (!snap || snap.listingId !== publicId) return ['the approved file is not this listing'];
  try { if (core.contentHash(snap.content) !== snap.contentHash) out.push('the content hash does not match'); } catch { out.push('the content hash could not be computed'); }
  const parsed = core.publicContentSchema.safeParse(snap.content);
  if (!parsed.success) out.push('the content does not satisfy the website schema');
  const photos = snap.content?.photos;
  if (!Array.isArray(photos) || photos.length === 0 || photos.length > MAX_PHOTOS) out.push('the photograph list is missing or too long');
  if (!PRICE_MODES.includes(snap.content?.pricing?.mode)) out.push('the pricing mode is not recognised');
  if (!Array.isArray(snap.content?.description) || snap.content.description.length === 0) out.push('the description is missing');
  return out;
}

/** Every variant must be an https public Blob URL of exactly <public id>/<photo id>-<width>.webp. Nothing else is ever fetched. */
function plannedFiles(snap, publicId) {
  const plan = [];
  for (const p of snap.content.photos) {
    if (!/^[a-f0-9]{12}$/.test(p.id ?? '') || !Array.isArray(p.variants) || p.variants.length === 0) throw refuse('import_unsupported', 'A published photograph has no usable image files.');
    for (const v of p.variants) {
      const m = PUBLIC_HOST_RE.exec(String(v.src ?? ''));
      if (!m || m[1] !== publicId || m[2] !== p.id || Number(m[3]) !== v.w) throw refuse('import_unsupported', 'A published image is not in the expected public location, so it will not be copied.');
      plan.push({ photoId: p.id, w: v.w, url: v.src, file: `${p.id}-${v.w}.webp` });
    }
  }
  return plan;
}

async function download(item, fetchImpl) {
  let res;
  try { res = await fetchImpl(item.url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'sdahc-listings-manager' } }); } catch { throw new HttpError(502, 'import_failed', { reasons: ['A published image could not be downloaded. Nothing was changed; try again.'] }); }
  if (res.status !== 200) throw new HttpError(502, 'import_failed', { reasons: [`A published image answered HTTP ${res.status}. Nothing was changed.`] });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw refuse('import_unsupported', 'A published image is empty or larger than the allowed size.');
  let meta; try { meta = await sharp(bytes, { failOn: 'error' }).metadata(); } catch { meta = null; }
  if (!meta || meta.format !== 'webp' || meta.width !== item.w) throw refuse('import_unsupported', 'A published image is not the WebP of the width the snapshot states.');
  return bytes;
}

/** The draft's public content, built from the snapshot. */
function draftContent(snap) {
  const c = snap.content;
  return cleanContent({
    title: c.title, description: c.description.join('\n\n'), publicAddress: core.formatPublicAddress(c.address),
    pricingMode: c.pricing.mode, displayPrice: c.pricing.display ?? '', featured: snap.featured === true,
    ...publishedGroups(c),
  });
}

/** The snapshot's optional groups in the draft's stored shape (the approval record is not part of the values). */
function publishedGroups(c) {
  const o = publishedOptional(c);
  return { ...(o.property ? { property: o.property } : {}), ...(o.sda ? { sdaFacts: o.sda } : {}), ...(o.investment ? { investment: o.investment } : {}), ...(o.marketing ? { marketing: o.marketing } : {}) };
}

/** The comparison the website job makes (title, description, address, pricing mode, display price, photograph order), plus the slug. */
function parityProblems(snap, content, photos, validation) {
  const c = snap.content; const out = [];
  if (content.title !== c.title) out.push('title');
  if (JSON.stringify(paragraphs(content.description)) !== JSON.stringify(c.description)) out.push('description');
  if (content.publicAddress.replace(/\s+/g, ' ').trim() !== `${c.address.street}, ${c.address.suburb} ${c.address.state} ${c.address.postcode}`) out.push('address');
  let parsed = null; try { parsed = core.parsePublicAddress(content.publicAddress); } catch { /* reported below */ }
  if (JSON.stringify(parsed) !== JSON.stringify(c.address)) out.push('address round trip');
  if (content.pricingMode !== c.pricing.mode) out.push('pricing mode');
  const needsPrice = content.pricingMode === 'asking_price' || content.pricingMode === 'price_guide';
  const price = needsPrice ? Number(String(content.displayPrice).replace(/[^0-9.]/g, '')) : null;
  const display = Number.isFinite(price) && price !== null ? `$${Math.round(price).toLocaleString('en-AU')}` : undefined;
  if ((c.pricing.display ?? undefined) !== display) out.push('display price');
  if (JSON.stringify(canonical(photos).map((p) => p.id)) !== JSON.stringify(c.photos.map((p) => p.id))) out.push('photograph order');
  const want = publishedGroups(c);
  for (const k of ['property', 'sdaFacts', 'investment', 'marketing']) if (stable(content[k]) !== stable(want[k])) out.push(k);
  if (!validation.complete) out.push('the website rules do not accept the content');
  if (validation.slug !== c.slug) out.push('slug');
  return out;
}

/**
 * Creates the draft of an already published listing from its approved snapshot. `deps.blob` / `env` select the private staging store.
 * Returns the usual draft view plus `imported` (or `alreadyImported: true` when a draft already existed: nothing is written then).
 */
export async function importPublishedFor({ cfg, db, propertyId, actor, fetchImpl, deps = {}, env = process.env, caps }) {
  requireId(propertyId);
  const prop = await getProperty(needNotion(cfg), propertyId, { fetchImpl });
  if (!prop) throw new HttpError(404, 'property_not_found');
  const publicId = prop.facts.id;
  const snaps = await loadSnapshots(cfg, { fetchImpl }).catch(() => null);
  if (!snaps) throw new HttpError(503, 'website_unreadable'); // cannot prove what is published
  if (snaps.withdrawn.has(publicId)) throw refuse('withdrawn', 'This listing has been withdrawn from the website, so it cannot be adopted.');
  const summary = snaps.approved.get(publicId);
  if (!summary) throw refuse('not_published', 'This property is not published on the website. Create a normal draft instead.');

  // idempotent: a draft already exists, so there is nothing to import. Return it untouched.
  if (await repo.getDraft(db, publicId)) return { ...(await openDraft({ cfg, db, id: publicId, fetchImpl, caps })), alreadyImported: true };

  const snap = await loadApprovedSnapshot(cfg, publicId, { fetchImpl, slug: summary.slug });
  const bad = snapshotProblems(snap, publicId);
  if (bad.length) throw refuse('snapshot_invalid', `The published version cannot be trusted for import (${bad.join('; ')}). Nothing was changed.`);

  const ctx = await context(cfg, prop, { fetchImpl });
  const plan = plannedFiles(snap, publicId);
  const store = photoStore(deps, env);

  // everything is downloaded and checked in memory before anything is written anywhere
  const bytes = new Map(); let i = 0;
  await Promise.all(Array.from({ length: Math.min(4, plan.length) }, async () => { while (i < plan.length) { const item = plan[i]; i += 1; bytes.set(item.file, await download(item, fetchImpl)); } }));

  const now = new Date().toISOString();
  const photos = snap.content.photos.map((p) => ({
    id: p.id, alt: p.alt ?? '', width: p.width, height: p.height, accent: p.accent, ...(p.kind === 'floorplan' ? { kind: 'floorplan' } : {}),
    files: [...p.variants].sort((a, b) => a.w - b.w).map((v) => ({ w: v.w, file: `${p.id}-${v.w}.webp` })), addedBy: actor.email, addedAt: now,
  }));
  const content = draftContent(snap);
  const validation = validateDraft(content, { ...ctx, photos: photosForRules(photos) });
  const problems = parityProblems(snap, content, photos, validation);
  if (problems.length) throw refuse('import_mismatch', `The draft would not reproduce the published listing (${problems.join(', ')}). Nothing was changed.`, { problems });

  const written = [];
  try {
    for (const item of plan) { await store.put(stagingPath(publicId, item.file), bytes.get(item.file)); written.push(stagingPath(publicId, item.file)); }
  } catch {
    await store.del(written).catch(() => {});
    throw new HttpError(502, 'import_failed', { reasons: ['The private photo store did not accept the images. Nothing was changed; try again.'] });
  }
  let draft;
  try {
    draft = await repo.createDraft(db, { publicId, notionPageId: prop.pageId, label: prop.facts.label, content, baseFacts: prop.hashes, baseEditedAt: prop.facts.editedAt, actor, photos, extraFields: ['importedFromPublished'] });
  } catch (e) {
    // another import won the race: its files are byte-identical to ours, so leave them and return its draft
    if (e instanceof HttpError && e.code === 'draft_exists') return { ...(await openDraft({ cfg, db, id: publicId, fetchImpl, caps })), alreadyImported: true };
    await store.del(written).catch(() => {});
    throw e;
  }
  // Published figures stay published: when the snapshot's own approval hash proves its commercial values were approved, that approval is carried over as an
  // imported record (marked as such). Without it, the next update would silently drop figures that are live today. A snapshot that fails the check imports without it.
  const inv = snap.content.investment;
  if (inv && core.investmentApprovalValid(inv)) {
    const rec = { valuesHash: inv.approval.valuesHash, provider: inv.approval.provider === true, by: 'published version', at: now, imported: true, note: 'Carried over from the version already on the website.' };
    await repo.updateDraft(db, { publicId, expectedVersion: draft.version, action: 'verify', patch: { verification: { [APPROVAL_KEY]: rec } }, actor, current: draft });
  }
  const view = await openDraft({ cfg, db, id: publicId, fetchImpl, caps });
  return { ...view, imported: { fromVersion: snap.version, slug: snap.content.slug, photos: photos.length, files: plan.length, draftVersion: draft.version } };
}
