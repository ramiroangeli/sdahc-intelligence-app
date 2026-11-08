// End-to-end timing of the photo operations, running the REAL server code (photos.js, drafts-repo.js) of a given checkout against
// a real Postgres (PGlite) with the latencies we MEASURED on Vercel injected into the database and the private Blob store.
//   node scripts/bench-upload-e2e.mjs --root <checkout> [--region gru1|hnd1]
// Run it once on `main` (before) and once on this branch (after). Not simulated: sharp image work and the SQL itself.
// Injected: database round trip per statement (BEGIN and COMMIT count), Blob write time. Region constants measured 8 Nov 2026
// from Vercel functions: gru1 (production's real region) db 257 ms, blob put 1500 ms; hnd1 db 3 ms, blob put 1900 ms.
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const root = resolve(arg('--root', '.'));
const region = arg('--region', 'gru1');
const K = { gru1: { db: 257, put: 1500 }, hnd1: { db: 3, put: 1900 }, none: { db: 0, put: 0 } }[region];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { addPhoto, saveGallery } = await import(pathToFileURL(join(root, 'api/_lib/photos.js')).href);
const isNew = readFileSync(join(root, 'api/_lib/photos.js'), 'utf8').includes('inspectUpload');

const pg = new PGlite();
await pg.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;');
for (const f of readdirSync(join(root, 'supabase/migrations')).filter((x) => /^listings_000\d_[a-z_]+\.sql$/.test(x) && !x.includes('rollback')).sort()) await pg.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
let statements = 0;
const db = {
  unsafe: async (q, p) => { statements += 1; await sleep(K.db); return (await pg.query(q, p)).rows; },
  begin: async (fn) => { statements += 2; await sleep(K.db); try { return await pg.transaction((tx) => fn({ unsafe: async (q, p) => { statements += 1; await sleep(K.db); return (await tx.query(q, p)).rows; } })); } finally { await sleep(K.db); } },
};
const mem = new Map(); let puts = 0;
const blob = { put: async (p, b) => { puts += 1; await sleep(K.put); mem.set(p, b); }, get: async (p) => mem.get(p) ?? null, del: async () => { await sleep(K.put / 2); } };
const actor = { email: 'bench@example.test', authUserId: '00000000-0000-4000-8000-000000000001' };
const ID = 'lst_0123456789';
await pg.query(`insert into listings.drafts (public_id, notion_page_id, label, base_facts, created_by, updated_by) values ($1,'p','Example Street, Exampleton VIC 3999','{}','a','a')`, [ID]);

const photo = async (seed) => sharp({ create: { width: 2800, height: 2100, channels: 3, noise: { type: 'gaussian', mean: 90 + seed * 7, sigma: 38 } } }).blur(0.4).jpeg({ quality: 88 }).toBuffer();
const imgs = [await photo(1), await photo(2), await photo(3)];
const version = async () => (await pg.query('select version from listings.drafts where public_id=$1', [ID])).rows[0].version;
const call = (fn) => async () => { const t = performance.now(); statements = 0; puts = 0; const r = await fn(); return { ms: Math.round(performance.now() - t), statements, puts, r }; };
const add = (buf, over = {}) => addPhoto({ db, deps: { blob }, env: {}, id: ID, body: buf, declaredType: 'image/jpeg', actor, ...(isNew ? {} : { expectedVersion: over.v }), ...over });

const out = [];
let v = await version();
let r = await call(() => add(imgs[0], { v }))(); out.push(['add 1 photo', r]);
v = await version();
const t3 = performance.now(); statements = 0; puts = 0;
if (isNew) await Promise.all([add(imgs[1]), add(imgs[2])]); else { await add(imgs[1], { v }); v = await version(); await add(imgs[2], { v }); }
out.push(['add 2 more photos (queued as one batch)', { ms: Math.round(performance.now() - t3), statements, puts }]);
const d = (await pg.query('select version, photos from listings.drafts where public_id=$1', [ID])).rows[0];
const items = d.photos.map((p) => ({ id: p.id, alt: p.alt, kind: p.kind }));
r = await call(() => saveGallery({ db, deps: { blob }, env: {}, id: ID, expectedVersion: d.version, items: [items[2], items[0], items[1]], coverId: items[2].id, actor }))(); out.push(['make 3rd photo the cover', r]);
console.log(`${isNew ? 'AFTER ' : 'BEFORE'} (${root})  region constants: ${region} (db ${K.db} ms/statement, blob put ${K.put} ms), 2800x2100 JPEG ~${Math.round(imgs[0].length / 1000)} kB`);
for (const [name, x] of out) console.log(`  ${name.padEnd(42)} ${String(x.ms).padStart(6)} ms   ${String(x.statements).padStart(2)} db round trips   ${String(x.puts).padStart(2)} blob writes`);
