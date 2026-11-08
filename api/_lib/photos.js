// Draft photo gallery: ONE ordered array is the single source of truth.
//   - index 0 is the Cover, always a photograph (never a floorplan)
//   - floorplans are always last
//   - everything between keeps the order staff gave it
// There is no separate cover flag that could disagree with the order. The preview and the eventual public listing use this
// same array order. Photos stay in the private staging store; nothing here writes to Notion, GitHub or the public Blob store.
import { HttpError, PUBLIC_ID_RE, RawResponse } from './http.js';
import { inspectUpload, processImage, WIDTHS } from './photo-process.js';
import { photoStore, stagingPath } from './photo-store.js';
import * as repo from './drafts-repo.js';

export const MAX_PHOTOS = 24;
const FILENAME_ALT = /\.(jpe?g|png|webp|heic)\b|\bIMG[_-]?\d/i;
const RETRIES = 5;

/** Canonical order. Also drops fields from earlier versions (cover flag, per-photo privacy review). A legacy cover flag is honoured once. */
export function canonical(photos) {
  const list = Array.isArray(photos) ? photos : [];
  const strip = ({ cover: _c, privacyReviewed: _p, reviewedBy: _b, reviewedAt: _a, ...p }) => p;
  const plain = list.filter((p) => p.kind !== 'floorplan');
  const floors = list.filter((p) => p.kind === 'floorplan');
  const legacy = plain.find((p) => p.cover === true);
  return [...(legacy ? [legacy, ...plain.filter((p) => p !== legacy)] : plain), ...floors].map(strip);
}
export const coverOf = (photos) => canonical(photos).find((p) => p.kind !== 'floorplan') ?? null;

/** Street name from the stored label ("Street, Suburb STATE 1234", number already removed). No Notion call needed. */
export const streetOf = (label) => String(label ?? '').split(',')[0].trim();

const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ');
/** Always-on privacy check of alt text (the website's draft rules only run once a whole draft is complete). */
export function altPrivacyIssues(alt, street) {
  const t = norm(alt ?? '');
  const out = [];
  const st = norm(street ?? '').trim();
  if (st.length >= 3) {
    const s = esc(st);
    if (new RegExp(`\\b\\d+[a-z]?(?:\\s*[-/]\\s*\\d+[a-z]?)?\\s+${s}`).test(t) || new RegExp(`${s}\\s+\\d{1,3}[a-z]?\\b`).test(t)) out.push('Alt text includes a house or unit number next to the street name. Remove the number.');
  }
  if (/\$\s?\d|\b(?:yield|income)\b/.test(t)) out.push('Alt text mentions a price, yield or income. Describe only what the image shows.');
  if (/[\w.+-]+@[\w-]+\.[\w.]+|\b(?:\+?61|0)[\d\s]{8,}\b|https?:\/\/|www\./.test(t)) out.push('Alt text includes contact details or a link.');
  return out;
}

/**
 * Neutral accessibility text for an image whose description is empty. It says only what is certain (a photograph or a floorplan, and its
 * place in the gallery): no invented visual detail, no address, nothing from the CRM. `n` is the 1-based place among photographs
 * (or among floorplans), `count` the number of images of that kind.
 */
export const fallbackAlt = (kind, n, count) => (kind === 'floorplan'
  ? (count > 1 ? `Floorplan ${n} of ${count} of the property` : 'Floorplan of the property')
  : (count > 1 ? `Photograph ${n} of ${count} of the property` : 'Photograph of the property'));

/** The description every consumer (preview, review, publication) uses: what staff typed, else the neutral fallback. */
export function withEffectiveAlt(photos) {
  const list = canonical(photos);
  const counts = { photo: list.filter((p) => p.kind !== 'floorplan').length, floorplan: list.filter((p) => p.kind === 'floorplan').length };
  const seen = { photo: 0, floorplan: 0 };
  return list.map((p) => {
    const kind = p.kind === 'floorplan' ? 'floorplan' : 'photo';
    seen[kind] += 1;
    const typed = (p.alt ?? '').trim();
    return { ...p, altText: typed || fallbackAlt(kind, seen[kind], counts[kind]), altFallback: !typed };
  });
}

/** Automated per-image checks (alt text) and gallery rules. Never blocks saving; it tells staff what is missing. */
export function photoReadiness(photos, { street } = {}) {
  const list = canonical(photos);
  const items = list.map((p) => {
    const issues = [];
    const alt = (p.alt ?? '').trim();
    // A description is optional: empty is fine and any length up to 200 is fine ("Kitchen" is enough). The privacy and file-name checks
    // below only look at what was actually typed.
    if (alt.length > 200) issues.push({ code: 'alt_long', message: 'Alt text can be at most 200 characters.' });
    else if (alt && FILENAME_ALT.test(alt)) issues.push({ code: 'alt_filename', message: 'Alt text looks like a file name. Describe what the image shows or leave it empty.' });
    for (const m of altPrivacyIssues(alt, street)) issues.push({ code: 'alt_private', message: m });
    return { id: p.id, ready: issues.length === 0, issues };
  });
  const gallery = [];
  if (!list.some((p) => p.kind !== 'floorplan')) gallery.push({ code: 'photos_required', message: 'Add at least one photograph (a floorplan alone is not enough).' });
  if (list.length > MAX_PHOTOS) gallery.push({ code: 'too_many', message: `At most ${MAX_PHOTOS} images.` });
  return { items, gallery, ready: gallery.length === 0 && items.every((i) => i.ready) };
}

const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
/** Gallery-level review: valid only for exactly the images the reviewer inspected. */
export function reviewState(draft) {
  const r = draft?.photo_review ?? null;
  const ids = canonical(draft?.photos).map((p) => p.id);
  if (!r || !Array.isArray(r.ids)) return { state: 'none', reviewed: false, by: null, at: null, count: ids.length };
  const ok = ids.length > 0 && sameSet(r.ids, ids);
  return { state: ok ? 'reviewed' : 'stale', reviewed: ok, by: r.by ?? null, at: r.at ?? null, count: r.ids.length };
}

/** Photos in the website's public shape, ONLY to run the website's own rules on a draft whose gallery a Publisher really reviewed.
 *  Never stored, never sent to the browser. Without a valid gallery review nothing is passed. */
export const photosForRules = (photos, reviewed) => (!reviewed ? [] : withEffectiveAlt(photos)
  .filter((p) => p.altText.length <= 200)
  .map((p) => ({ id: p.id, alt: p.altText, width: p.width, height: p.height, accent: p.accent, ...(p.kind === 'floorplan' ? { kind: 'floorplan' } : {}), privacyReviewed: true, variants: p.files.map((f) => ({ w: f.w, src: `/images/listings/${f.file}` })) })));

/** What the browser is told about the gallery: no storage paths. `publicOrder` IS the array order. */
export function photoView(draftOrPhotos, extra = {}) {
  const draft = Array.isArray(draftOrPhotos) ? { photos: draftOrPhotos, ...extra } : draftOrPhotos;
  const list = withEffectiveAlt(draft.photos);
  const ready = photoReadiness(list, { street: streetOf(draft.label) });
  const cover = list.find((p) => p.kind !== 'floorplan');
  const review = reviewState({ photos: list, photo_review: draft.photo_review });
  return {
    items: list.map((p) => ({
      id: p.id, alt: p.alt, altText: p.altText, altFallback: p.altFallback, width: p.width, height: p.height, kind: p.kind === 'floorplan' ? 'floorplan' : 'photo', cover: cover?.id === p.id,
      widths: p.files.map((f) => f.w), addedBy: p.addedBy, addedAt: p.addedAt, issues: ready.items.find((i) => i.id === p.id)?.issues ?? [],
    })),
    publicOrder: list.map((p) => p.id),
    coverId: cover?.id ?? null,
    readiness: { ready: ready.ready, gallery: ready.gallery },
    review: { state: review.state, reviewed: review.reviewed, by: review.by, at: review.at, count: review.count },
  };
}

const existing = (draft) => (Array.isArray(draft.photos) ? draft.photos : []);
const requireId = (id) => { if (typeof id !== 'string' || !PUBLIC_ID_RE.test(id)) throw new HttpError(400, 'invalid_id'); return id; };
const filesOf = (photos) => photos.flatMap((p) => p.files.map((f) => f.file));
const pathsFor = (publicId, files) => files.map((f) => stagingPath(publicId, f));
const timer = () => { const t0 = performance.now(); let last = t0; const ms = {}; return { mark: (k) => { const n = performance.now(); ms[k] = Math.round(n - last); last = n; }, done: () => ({ ...ms, total: Math.round(performance.now() - t0) }) }; };

/** Small response for photo changes: no Notion or GitHub round trip. The editor refreshes validation in the background. */
const light = (saved, timings) => ({
  draft: { id: saved.public_id, version: saved.version, updatedBy: saved.updated_by, updatedAt: saved.updated_at },
  photos: photoView(saved),
  timings,
});

/** Upload a new image, or replace one. Processing and storage do not touch the draft, so several uploads can run in parallel;
 *  only the final append is serialised (retried on a version change, because adding an image commutes with other edits). */
export async function addPhoto({ db, deps, env, id, body, declaredType, replaceId, kind, actor }) {
  requireId(id);
  const T = timer();
  const store = photoStore(deps, env);
  const first = await repo.getDraft(db, id);
  if (!first) throw new HttpError(404, 'draft_not_found');
  const pre = inspectUpload(body, declaredType); // signature, type, size, content id (cheap): refuses bad files before any pixel work
  const had = canonical(existing(first));
  if (had.some((p) => p.id === pre.id && p.id !== replaceId)) throw new HttpError(409, 'duplicate_image'); // no repeated processing
  if (!replaceId && had.length >= MAX_PHOTOS) throw new HttpError(409, 'too_many_photos');
  if (replaceId && !had.some((p) => p.id === replaceId)) throw new HttpError(404, 'photo_not_found');
  T.mark('inspect');
  const out = await processImage(body, declaredType, pre);
  T.mark('process');
  await Promise.all(out.variants.map((v) => store.put(stagingPath(id, v.file), v.buffer)));
  T.mark('store');
  const newFiles = out.variants.map((v) => v.file);
  let saved = null; let replacedFiles = [];
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    // first attempt reuses the row read before processing; a stale row simply fails the version guard and is re-read
    const cur = attempt === 0 ? first : await repo.getDraft(db, id);
    if (!cur) throw new HttpError(404, 'draft_not_found');
    const photos = canonical(existing(cur));
    const target = replaceId ? photos.find((p) => p.id === replaceId) : null;
    if (replaceId && !target) { await store.del(pathsFor(id, newFiles)).catch(() => {}); throw new HttpError(404, 'photo_not_found'); }
    if (photos.some((p) => p.id === out.id && p.id !== replaceId)) throw new HttpError(409, 'duplicate_image');
    if (!replaceId && photos.length >= MAX_PHOTOS) { await store.del(pathsFor(id, newFiles)).catch(() => {}); throw new HttpError(409, 'too_many_photos'); }
    const now = new Date().toISOString();
    const entry = {
      id: out.id, alt: target?.alt ?? '', width: out.width, height: out.height, accent: out.accent,
      ...((kind === 'floorplan' || target?.kind === 'floorplan') ? { kind: 'floorplan' } : {}),
      files: out.variants.map((v) => ({ w: v.w, file: v.file })), addedBy: actor.email, addedAt: now,
      ...(target ? { replacedAt: now, replacedBy: actor.email } : {}),
    };
    let next;
    if (target) next = photos.map((p) => (p.id === replaceId ? entry : p));
    else { const at = entry.kind === 'floorplan' ? -1 : photos.findIndex((p) => p.kind === 'floorplan'); next = at < 0 ? [...photos, entry] : [...photos.slice(0, at), entry, ...photos.slice(at)]; }
    try {
      // any added or replaced image invalidates the previous gallery review
      saved = await repo.updateDraft(db, { publicId: id, expectedVersion: cur.version, action: 'update', patch: { photos: canonical(next), photoReview: null }, actor, current: cur });
      replacedFiles = target ? target.files.map((f) => f.file).filter((f) => !newFiles.includes(f)) : [];
      break;
    } catch (e) {
      if (e instanceof HttpError && e.code === 'draft_changed' && attempt < RETRIES - 1) continue;
      await store.del(pathsFor(id, newFiles)).catch(() => {});
      throw e;
    }
  }
  T.mark('persist');
  if (replacedFiles.length) await store.del(pathsFor(id, replacedFiles)).catch(() => {});
  const timings = { ...T.done(), sharp: out.ms.total };
  console.info(JSON.stringify({ type: 'timing', action: replaceId ? 'photo.replace' : 'photo.add', bytes: body.length, ...timings }));
  return light(saved, timings);
}

/** Order, floorplan flag, alt text, cover and removal in one compare-and-set save. Cannot add images.
 *  Rules enforced here, not only in the browser: the cover (index 0) cannot be moved down except by naming a new cover;
 *  a floorplan can never be the cover; floorplans always end up last. */
export async function saveGallery({ db, deps, env, id, expectedVersion, items, coverId, actor }) {
  requireId(id);
  if (!Number.isInteger(expectedVersion)) throw new HttpError(400, 'expected_version_required');
  if (!Array.isArray(items) || items.length > MAX_PHOTOS) throw new HttpError(400, 'invalid_gallery');
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const cur = canonical(existing(draft));
  const byId = new Map(cur.map((p) => [p.id, p]));
  const seen = new Set();
  const mapped = items.map((it) => {
    const old = byId.get(it?.id);
    if (!old || seen.has(old.id)) throw new HttpError(400, 'unknown_photo');
    seen.add(old.id);
    const alt = it.alt === undefined ? old.alt : String(it.alt ?? '').replace(/\s+/g, ' ').trim();
    if (alt.length > 200) throw new HttpError(400, 'alt_too_long');
    const floor = it.kind === undefined ? old.kind === 'floorplan' : it.kind === 'floorplan';
    const { kind: _k, ...rest } = old;
    return { ...rest, alt, ...(floor ? { kind: 'floorplan' } : {}) };
  });
  const plain = mapped.filter((p) => p.kind !== 'floorplan');
  const floors = mapped.filter((p) => p.kind === 'floorplan');
  const oldCover = cur.find((p) => p.kind !== 'floorplan')?.id;
  let cover;
  if (coverId !== undefined && coverId !== null) {
    const c = mapped.find((p) => p.id === coverId);
    if (!c) throw new HttpError(400, 'unknown_cover');
    if (c.kind === 'floorplan') throw new HttpError(400, 'cover_is_floorplan');
    cover = c.id;
  } else {
    if (plain.some((p) => p.id === oldCover) && plain[0]?.id !== oldCover) throw new HttpError(400, 'cover_must_stay_first');
    cover = plain[0]?.id;
  }
  const head = cover ? [plain.find((p) => p.id === cover), ...plain.filter((p) => p.id !== cover)] : [];
  const next = [...head, ...floors];
  const removed = cur.filter((p) => !seen.has(p.id));
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion, action: 'update', patch: { photos: next, ...(removed.length ? { photoReview: null } : {}) }, actor, current: draft });
  if (removed.length) await photoStore(deps, env).del(pathsFor(id, filesOf(removed))).catch(() => {});
  return { saved, removed: removed.length };
}

/** The ONE gallery review: a Publisher confirms they inspected every image. Valid only for exactly those images. */
export async function reviewGallery({ db, id, ids, expectedVersion, actor }) {
  requireId(id);
  const draft = await repo.getDraft(db, id);
  if (!draft) throw new HttpError(404, 'draft_not_found');
  const photos = canonical(existing(draft));
  if (!photos.some((p) => p.kind !== 'floorplan')) throw new HttpError(409, 'no_photographs');
  const ready = photoReadiness(photos, { street: streetOf(draft.label) });
  if (!ready.ready) throw new HttpError(409, 'photos_not_ready', { issues: ready.items.filter((i) => !i.ready).length });
  if (!Array.isArray(ids) || !sameSet(ids, photos.map((p) => p.id))) throw new HttpError(409, 'gallery_changed');
  const review = { by: actor.email, byAuthUser: actor.authUserId ?? null, at: new Date().toISOString(), ids: photos.map((p) => p.id).sort(), count: photos.length };
  const saved = await repo.updateDraft(db, { publicId: id, expectedVersion: Number.isInteger(expectedVersion) ? expectedVersion : draft.version, action: 'verify', patch: { photoReview: review }, actor, current: draft });
  return light(saved, {});
}

export { light as photoLight };

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
