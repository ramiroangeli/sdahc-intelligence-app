// Private staging storage for draft photographs: a PRIVATE Vercel Blob store, reached from the server only.
// Authentication is Vercel OIDC: on Vercel the SDK reads VERCEL_OIDC_TOKEN and BLOB_STORE_ID itself and refreshes the token,
// so this app holds no storage secret. Nothing here is public, and the browser never receives a storage URL or token.
// Files live under listings-staging/<public id>/<content hash>-<width>.webp. Promotion to the public store is a later,
// separately approved step and is NOT implemented here.
import { HttpError } from './http.js';

export const stagingPath = (publicId, file) => `listings-staging/${publicId}/${file}`;

export function photoStore(deps = {}, env = process.env) {
  if (deps.blob) return deps.blob; // tests and the local preview inject an in-memory store
  if (!(env.BLOB_STORE_ID || '').trim()) throw new HttpError(503, 'photos_not_configured');
  return {
    async put(pathname, buffer) {
      const { put } = await import('@vercel/blob');
      await put(pathname, buffer, { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'image/webp' });
    },
    async get(pathname) {
      const { get } = await import('@vercel/blob');
      const r = await get(pathname, { access: 'private', useCache: false });
      if (!r || r.statusCode !== 200) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    },
    async del(pathnames) {
      if (!pathnames.length) return;
      const { del } = await import('@vercel/blob');
      await del(pathnames);
    },
  };
}

export const photosConfigured = (deps = {}, env = process.env) => Boolean(deps.blob || (env.BLOB_STORE_ID || '').trim());
