// Promotes the approved WebP variants of ONE listing from the private staging store to the existing PUBLIC media store.
//
// Authentication is Vercel OIDC, never a long-lived write token: the SDK reads VERCEL_OIDC_TOKEN itself and the public store is named per
// call with `storeId` (PUBLIC_BLOB_STORE_ID). The private store keeps using BLOB_STORE_ID, untouched. OIDC access is store-wide, so the
// restriction to "<public id>/<content hash>-<width>.webp" and "<public id>/manifest.json" is enforced HERE, on every write.
//
// Only this module may write to the public store. It never deletes, and it never lists or reads anything but what it was asked to copy.
import { HttpError, PUBLIC_ID_RE } from './http.js';
import { stagingPath } from './photo-store.js';

const FILE_RE = /^[a-f0-9]{12}-\d{2,4}\.webp$/;
const ID_RE = /^[a-f0-9]{12}$/;
export const publicPath = (publicId, file) => {
  if (!PUBLIC_ID_RE.test(publicId ?? '') || !(FILE_RE.test(file ?? '') || file === 'manifest.json')) throw new HttpError(500, 'public_path_refused');
  return `${publicId}/${file}`;
};
const isWebp = (b) => Buffer.isBuffer(b) && b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';

export const publicMediaConfigured = (deps = {}, env = process.env) => Boolean(deps.publicBlob || (env.PUBLIC_BLOB_STORE_ID || '').trim());

export function publicStore(deps = {}, env = process.env) {
  if (deps.publicBlob) return deps.publicBlob; // tests inject an in-memory store
  const storeId = (env.PUBLIC_BLOB_STORE_ID || '').trim();
  if (!storeId) throw new HttpError(503, 'public_media_not_configured');
  return {
    async put(pathname, body, contentType, cacheSeconds) {
      const { put } = await import('@vercel/blob');
      await put(pathname, body, { access: 'public', storeId, addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: cacheSeconds });
    },
  };
}

/**
 * Copies every variant of every approved photograph, then writes the manifest last (so a manifest never points at a file that is not there).
 * `manifest` is the frozen approved manifest from the job payload. Returns counts only. Throws HttpError('media_failed') with a plain reason.
 */
export async function promoteMedia({ publicId, manifest, privateStore, publicStore: pub, concurrency = 4 }) {
  if (!PUBLIC_ID_RE.test(publicId ?? '')) throw new HttpError(400, 'invalid_id');
  const photos = manifest?.photos ?? [];
  if (!photos.length) throw new HttpError(409, 'media_failed', { reason: 'There are no photographs to publish.' });
  const jobs = [];
  for (const p of photos) {
    if (!ID_RE.test(p.id ?? '') || !Array.isArray(p.files) || !p.files.length) throw new HttpError(409, 'media_failed', { reason: 'A photograph has no prepared images. Re-save the gallery and try again.' });
    for (const f of p.files) {
      if (!FILE_RE.test(f.file ?? '') || !f.file.startsWith(`${p.id}-`)) throw new HttpError(409, 'media_failed', { reason: 'A photograph has an unexpected file name.' });
      jobs.push(f.file);
    }
  }
  // 1. everything must be readable in private staging and be a real WebP before anything becomes public
  const bytes = new Map();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const file = jobs[i]; i += 1;
      let b = null; try { b = await privateStore.get(stagingPath(publicId, file)); } catch { b = null; }
      if (!isWebp(b)) throw new HttpError(409, 'media_failed', { reason: 'A staged image is missing or is not a valid WebP. Open the Photographs tab, re-save the gallery and try again.' });
      bytes.set(file, b);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  // 2. copy the images (content-hashed names never change, so they can be cached for a year)
  i = 0;
  const copy = async () => {
    while (i < jobs.length) {
      const file = jobs[i]; i += 1;
      await pub.put(publicPath(publicId, file), bytes.get(file), 'image/webp', 31536000);
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, copy)); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'media_failed', { reason: 'The public image store did not accept the images. Nothing has been published; try again.' });
  }
  // 3. the manifest last
  const out = { version: 1, photos: photos.map((p) => ({ id: p.id, alt: p.alt, width: p.width, height: p.height, accent: p.accent, privacyReviewed: true, ...(p.kind === 'floorplan' ? { kind: 'floorplan' } : {}), files: p.files.map((f) => ({ w: f.w, file: f.file })) })) };
  try { await pub.put(publicPath(publicId, 'manifest.json'), Buffer.from(JSON.stringify(out)), 'application/json', 60); } catch {
    throw new HttpError(502, 'media_failed', { reason: 'The public image store did not accept the image list. Nothing has been published; try again.' });
  }
  return { photos: photos.length, files: jobs.length };
}
