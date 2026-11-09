// Checks that this app can reach the PUBLIC media store with Vercel OIDC (no long-lived write token).
//   vercel env pull .env.check --environment=production   (gives a short-lived VERCEL_OIDC_TOKEN and PUBLIC_BLOB_STORE_ID; never commit that file)
//   node --env-file=.env.check scripts/check-public-blob.mjs            read only: lists one object
//   node --env-file=.env.check scripts/check-public-blob.mjs --write    also writes and deletes one tiny probe file under lst_0000000000/
// Prints a verdict only: never the token, never object contents.
import { list, put, del } from '@vercel/blob';

const storeId = (process.env.PUBLIC_BLOB_STORE_ID || '').trim();
const say = (m) => console.log(m);
if (!storeId) { say('NOT CONNECTED: PUBLIC_BLOB_STORE_ID is not set. Connect the public store to this project with the prefix PUBLIC_BLOB (see docs/real-publication-setup.md).'); process.exit(1); }
if (!process.env.VERCEL_OIDC_TOKEN) { say('NO OIDC TOKEN: run "vercel env pull" first; the token is short-lived by design.'); process.exit(1); }
try {
  const r = await list({ storeId, prefix: 'lst_', limit: 1 });
  say(`READ OK: the public store answers to OIDC (${r.blobs.length ? 'it already holds listing media' : 'it holds no listing media yet'}).`);
  if (process.argv.includes('--write')) {
    const probe = 'lst_0000000000/oidc-probe.txt';
    const b = await put(probe, 'probe', { access: 'public', storeId, addRandomSuffix: false, allowOverwrite: true, contentType: 'text/plain' });
    await del(b.url, { storeId });
    say('WRITE OK: a probe file was written and deleted. No long-lived token is needed.');
  }
} catch (e) {
  say(`FAILED (${String(e.name || 'Error')}): ${String(e.message || '').replace(/\b(vercel_blob_[A-Za-z0-9_]+|eyJ[A-Za-z0-9_.-]+)/g, '[hidden]').slice(0, 200)}`);
  say('If this says the store does not support OIDC or access is denied, the store is connected with a token only: see the fallback in docs/real-publication-setup.md.');
  process.exit(1);
}
