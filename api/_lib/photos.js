// Draft photo gallery: pure rules (order, readiness) and the upload / edit / read workflow. Photos stay in the private staging
// store; nothing here writes to Notion, GitHub or the public Blob store, and nothing can change a public page.
import { HttpError, RawResponse, PUBLIC_ID_RE } from './http.js';
import { processImage, WIDTHS } from './photo-process.js';
import { photoStore, stagingPath } from './photo-store.js';
import * as repo from './drafts-repo.js';

export const MAX_PHOTOS = 24;
const FILENAME_ALT = /\.(jpe?g|png|webp|heic)\b|\bIMG[_-]?\d/i;

/** Public gallery order: the cover first, other photographs in the staff's order, floorplans last. */
export function effectiveOrder(photos) {
  const list = photos ?? [];
  const plain = list.filter((p) => p.kind !== 'floorplan');
  const cover = plain.find((p) => p.cover) ?? plain[0];
  return [...(cover ? [cover] : []), ...plain.filter((p) => p !== cover), ...list.filter((p) => p.kind === 'floorplan')];
}

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ');
/** Always-on privacy check of alt text (the website's draft rules only run once a whole draft is complete). */
export function altPrivacyIssues(alt, internalAddress) {
  const t = norm(alt ?? '');
  const out = [];
  const m = /^\s*(?:\w+\s*\/\s*)?\d+[a-z]?\s+(.+?)\s*,/i.exec(internalAddress ?? '');
  if (m) {
    const street = esc(norm(m[1]));
    if (new RegExp(`\\b\\d+[a-z]?(?:\\s*[-/]\\s*\\d+[a-z]?)?\\s+${street}`).test(t) || new RegExp(`${street}\\s+\\d{1,3}[a-z]?\\b`).test(t)) out.push('Alt text includes a house or unit number next to the street name. Remove the number.');
  }
  if (/\$\s?\d|\b\d[\d,]*\s?(?:k|m)\b.*\b(?:price|yield|income|rent)\b|\b(?:yield|income)\b/.test(t)) out.push('Alt text mentions a price, yield or income. Describe only what the image shows.');
  if (/[\w.+-]+@[\w-]+\.[\w.]+|\b(?:\+?61|0)[\d\s]{8,}\b|https?:\/\/|www\./.test(t)) out.push('Alt text includes contact details or a link.');
  return out;
}

/** Per-image and gallery readiness. Never blocks saving; it tells staff what is missing. */
export function photoReadiness(photos, { internalAddress } = {}) {
  const list = photos ?? [];
  const items = list.map((p) => {
    const issues = [];
    const alt = (p.alt ?? '').trim();
    if (alt.length < 8) issues.push({ code: 'alt_missing', message: 'Describe the image in at least 8 characters (alt text).' });
    else if (alt.length > 200) issues.push({ code: 'alt_long', message: 'Alt text can be at most 200 characters.' });
    else if (FILENAME_ALT.test(alt)) issues.push({ code: 'alt_filename', message: 'Alt text looks like a file name. Describe what the image shows.' });
    for (const m of altPrivacyIssues(alt, internalAddress)) issues.push({ code: 'alt_private', message: m });
    if (p.privacyReviewed !== true) issues.push({ code: 'privacy_unreviewed', message: 'Privacy review not confirmed: check for house numbers, letterboxes, signs, number plates and identifiable people.' });
    return { id: p.id, ready: issues.length === 0, issues };
  });
  const gallery = [];
  if (!list.some((p) => p.kind !== 'floorplan')) gallery.push({ code: 'photos_required', message: 'Add at least one photograph (a floorplan alone is not enough).' });
  if (list.length > MAX_PHOTOS) gallery.push({ code: 'too_many', message: `At most ${MAX_PHOTOS} images.` });
  return { items, gallery, ready: gallery.length === 0 && items.every((i) => i.ready) };
}

/** Photos in the website's public shape with placeholder site paths, only to run the website's own alt-text privacy rules. */
export const photosForRules = (photos) => effectiveOrder(photos)
  .filter((p) => p.privacyReviewed === true && (p.alt ?? '').trim().length >= 8 && p.alt.trim().length <= 200)
  .map((p) => ({ id: p.id, alt: p.alt.trim(), width: p.width, height: p.height, accent: p.accent, ...(p.kind === 'floorplan' ? { kind: 'floorplan' } : {}), privacyReviewed: true, variants: p.files.map((f) => ({ w: f.w, src: `/images/listings/${f.file}` })) }));

/** What the browser is told about each photo: no storage paths. Image bytes come only from the authorised read endpoint. */
export const photoView = (photos, ctx = {}) => {
  const order = effectiveOrder(photos).map((p) => p.id);
  const ready = photoReadiness(photos, ctx);
  return {
    items: (photos ?? []).map((p) => ({
      id: p.id, alt: p.alt, width: p.width, height: p.height, kind: p.kind === 'floorplan' ? 'floorplan' : 'photo', cover: p.cover === true && p.kind !== 'floorplan',
      privacyReviewed: p.privacyReviewed === true, reviewedBy: p.reviewedBy ?? null, reviewedAt: p.reviewedAt ?? null, widths: p.files.map((f) => f.w), addedBy: p.addedBy, addedAt: p.addedAt,
      issues: ready.items.find((i) => i.id === p.id)?.issues ?? [],
    })),
    publicOrder: order,
    coverId: order.length && (photos ?? []).find((p) => p.id === order[0])?.kind !== 'floorplan' ? order[0] : null,
    readiness: { ready: ready.ready, gallery: ready.gallery },
  };
};

const existing = (draft) => (Array.isArray(draft.photos) ? draft.photos : []);
const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };
const filesOf = (photos) => photos.flatMap((p) => p.files.map((f) => f.file));
const pathsFor = (publicId, files) => files.map((f) => stagingPath(publicId, f));

/** Upload a new image, or replace one (replace = photo id). Saved at once with the draft's version check and a history row. */
export async function addPhoto({ db, deps, env, id, body, declaredType, expectedVersion, replaceId, kind, actor }) {
  requireId(id);
  if (!Number.isInteger(expectedVersion)) throw new HttpError(400, 'expected_version_required');
  const store = photoStore(deps, env);
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const photos = existing(draft);
  if (!replaceId && photos.length >= MAX_PHOTOS) throw new HttpError(409, 'too_many_photos');
  const target = replaceId ? photos.find((p) => p.id === replaceId) : null;
  if (replaceId && !target) throw new HttpError(404, 'photo_not_found');
  const out = await processImage(body, declaredType);
  if (photos.some((p) => p.id === out.id && p.id !== replaceId)) throw new HttpError(409, 'duplicate_image');
  // files first (opaque, content-hash names), then the draft row; a failed save leaves only unreferenced private files
  for (const v of out.variants) await store.put(stagingPath(id, v.file), v.buffer);
  const now = new Date().toISOString();
  const entry = {
    id: out.id, alt: target?.alt ?? '', width: out.width, height: out.height, accent: out.accent,
    ...((kind === 'floorplan' || (target && target.kind === 'floorplan')) ? { kind: 'floorplan' } : {}),
    ...(target?.cover && kind !== 'floorplan' ? { cover: true } : {}),
    privacyReviewed: false, // a new or replaced image always needs a fresh privacy review
    files: out.variants.map((v) => ({ w: v.w, file: v.file })), addedBy: actor.email, addedAt: now,
    ...(target ? { replacedAt: now, replacedBy: actor.email } : {}),
  };
  const next = target ? photos.map((p) => (p.id === replaceId ? entry : p)) : [...photos, entry];
  let saved;
  try { saved = await repo.updateDraft(db, { publicId: id, expectedVersion, action: 'update', patch: { photos: next }, actor }); }
  catch (e) { await store.del(pathsFor(id, out.variants.map((v) => v.file))).catch(() => {}); throw e; }
  if (target) { const keep = new Set(out.variants.map((v) => v.file)); await store.del(pathsFor(id, target.files.map((f) => f.file).filter((f) => !keep.has(f)))).catch(() => {}); }
  return saved;
}

/** Order, cover, floorplan flag, alt text, privacy review and removal, in one compare-and-set save. Cannot add images. */
export async function saveGallery({ db, deps, env, id, expectedVersion, items, coverId, actor }) {
  requireId(id);
  if (!Number.isInteger(expectedVersion)) throw new HttpError(400, 'expected_version_required');
  if (!Array.isArray(items) || items.length > MAX_PHOTOS) throw new HttpError(400, 'invalid_gallery');
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const cur = existing(draft);
  const byId = new Map(cur.map((p) => [p.id, p]));
  const seen = new Set();
  const keepCover = coverId !== undefined ? coverId : cur.find((p) => p.cover)?.id;
  const now = new Date().toISOString();
  const next = items.map((it) => {
    const old = byId.get(it?.id);
    if (!old || seen.has(old.id)) throw new HttpError(400, 'unknown_photo');
    seen.add(old.id);
    const alt = it.alt === undefined ? old.alt : String(it.alt ?? '').replace(/\s+/g, ' ').trim();
    if (alt.length > 200) throw new HttpError(400, 'alt_too_long');
    const floor = it.kind === undefined ? old.kind === 'floorplan' : it.kind === 'floorplan';
    const reviewed = it.privacyReviewed === undefined ? old.privacyReviewed === true : it.privacyReviewed === true;
    const { cover: _c, kind: _k, reviewedBy: _rb, reviewedAt: _ra, ...rest } = old;
    return {
      ...rest, alt, ...(floor ? { kind: 'floorplan' } : {}), privacyReviewed: reviewed,
      ...(reviewed ? (old.privacyReviewed === true ? { reviewedBy: old.reviewedBy, reviewedAt: old.reviewedAt } : { reviewedBy: actor.email, reviewedAt: now }) : {}),
      ...(!floor && keepCover === old.id ? { cover: true } : {}),
    };
  });
  if (coverId !== undefined && coverId !== null) {
    const c = next.find((p) => p.id === coverId);
    if (!c) throw new HttpError(400, 'unknown_cover');
    if (c.kind === 'floorplan') throw new HttpError(400, 'cover_is_floorplan');
  }
  const removed = cur.filter((p) => !seen.has(p.id));
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion, action: 'update', patch: { photos: next }, actor });
  if (removed.length) await photoStore(deps, env).del(pathsFor(id, filesOf(removed))).catch(() => {});
  return { saved, removed: removed.length };
}

/** One image variant, read only after the route has authorised the caller. The path comes from the draft row, never from the client. */
export async function readPhoto({ db, deps, env, id, photoId, w }) {
  requireId(id);
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const photo = existing(draft).find((p) => p.id === photoId);
  const width = Number(w) || WIDTHS[0];
  const file = photo?.files.find((f) => f.w === width) ?? photo?.files[0];
  if (!file) throw new HttpError(404, 'photo_not_found');
  const bytes = await photoStore(deps, env).get(stagingPath(id, file.file));
  if (!bytes) throw new HttpError(404, 'photo_not_found');
  return new RawResponse(200, { 'Content-Type': 'image/webp', 'Content-Length': String(bytes.length) }, bytes);
}
