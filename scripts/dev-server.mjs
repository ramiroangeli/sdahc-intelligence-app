// LOCAL PREVIEW ONLY. Serves the static app and the Listings routes on http://127.0.0.1:8787 so the screen can be
// reviewed without deploying. It is not part of the deployed app (Vercel never runs scripts/).
//
// To keep production code free of any bypass, this server does two things production never does:
//   1. injects a fake `authorise` into the route factories (the real auth path is covered by the tests), and
//   2. swaps the Supabase CDN script for a stub session so the login gate opens.
// Drafts are stored in a local PGlite database (.dev-data), never in production.
// It refuses to start when VERCEL or NODE_ENV=production is set. Real Notion and website reads still happen if
// NOTION_LISTINGS_TOKEN and NOTION_PROPERTIES_DATA_SOURCE_ID are in the environment.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { draftGalleryReviewRoute, draftPhotoRoute, draftPhotosRoute, draftRoute, draftVerifyRoute, listRoute, meRoute, propertiesRoute } from '../api/_lib/routes.js';

if (process.env.VERCEL || process.env.NODE_ENV === 'production') { console.error('dev-server refuses to run in production'); process.exit(1); }

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const caps = (process.env.DEV_CAPS || 'listings.view,listings.edit,listings.publish').split(',');
const who = process.env.DEV_EMAIL || 'dev-preview@local';
const fakeAuth = async () => ({ staff: { email: who, capabilities: caps }, identity: { email: who, authUserId: '00000000-0000-4000-8000-000000000001' } });
// Drafts use a real Postgres (PGlite) running the real migration, stored under .dev-data so drafts survive a restart.
const pg = new PGlite(process.env.DEV_DB || './.dev-data');
const hasSchema = (await pg.query("select 1 from pg_namespace where nspname='listings'")).rows.length > 0;
if (!hasSchema) {
  await pg.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;');
  await pg.exec(readFileSync(new URL('../supabase/migrations/listings_0001_drafts.sql', import.meta.url), 'utf8'));
}
if (!(await pg.query("select 1 from information_schema.columns where table_schema='listings' and table_name='drafts' and column_name='photos'")).rows.length) {
  await pg.exec(readFileSync(new URL('../supabase/migrations/listings_0002_photos.sql', import.meta.url), 'utf8'));
}
if (!(await pg.query("select 1 from information_schema.columns where table_schema='listings' and table_name='drafts' and column_name='photo_review'")).rows.length) {
  await pg.exec(readFileSync(new URL('../supabase/migrations/listings_0003_photo_review.sql', import.meta.url), 'utf8'));
}
const db = { unsafe: async (q, p) => (await pg.query(q, p)).rows, begin: (fn) => pg.transaction((tx) => fn({ unsafe: async (q, p) => (await tx.query(q, p)).rows })) };
// private staging store: in memory in the preview, never a real Blob store
const mem = new Map();
const blob = { put: async (p, b) => { mem.set(p, b); }, get: async (p) => mem.get(p) ?? null, del: async (ps) => { for (const p of ps) mem.delete(p); } };
const deps = { authorise: fakeAuth, db, blob };
const routes = { '/api/listings': listRoute(deps), '/api/listings/me': meRoute(deps), '/api/listings/properties': propertiesRoute(deps), '/api/listings/draft': draftRoute(deps), '/api/listings/draft-photos': draftPhotosRoute(deps), '/api/listings/draft-photo': draftPhotoRoute(deps), '/api/listings/draft-gallery-review': draftGalleryReviewRoute(deps), '/api/listings/draft-verify': draftVerifyRoute(deps) };

const STUB = `<script>(function(){var s={access_token:'dev-preview-token-not-real-0000',user:{email:'dev-preview@local'}};
var chain=function(){var p=new Proxy(function(){},{get:function(_,k){if(k==='then')return function(r){return Promise.resolve({data:[],error:null}).then(r)};return p},apply:function(){return p}});return p};
if(/[?&]open=listings/.test(location.search))window.addEventListener('load',function(){setTimeout(function(){var b=document.querySelector('[data-view=listings]');if(b)b.click()},600)});
if(/[?&]shot=/.test(location.search))window.addEventListener('load',function(){var t=location.search.match(/shot=([a-z-]+)/)[1];var n=0;var iv=setInterval(function(){n++;var ph=document.getElementById('ls-photos');var title=document.querySelector('#view-listings .panel-title');if(title&&/Sheppard/.test(title.textContent)){title.textContent='Wattle Street, Exampleton VIC 3999';}document.querySelectorAll('.ls-facts dd').forEach(function(d){if(/Sheppard/.test(d.textContent))d.textContent='Wattle Street, Exampleton VIC 3999';});if(t==='photos'&&ph){ph.scrollIntoView();}if(t==='review'&&!document.getElementById('ls-review-modal')){var b=document.getElementById('ls-review-open');if(b&&!b.disabled)b.click();}if(n>60)clearInterval(iv);},250);});
window.supabase={createClient:function(){return{auth:{getSession:function(){return Promise.resolve({data:{session:s}})},onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',s)})},signOut:function(){return Promise.resolve({})},signInWithOAuth:function(){return Promise.resolve({})}},schema:chain,from:chain}}}})();</script>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (routes[url.pathname]) return routes[url.pathname](req, res);
  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
  const file = join(root, rel);
  if (!file.startsWith(root) || /^(api|sync|scripts|tests|docs|00_context)/.test(rel)) { res.statusCode = 404; return res.end('not found'); }
  try {
    let body = await readFile(file);
    if (rel === 'index.html') body = Buffer.from(body.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>/, STUB));
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`Listings dev preview on http://127.0.0.1:${PORT}`));
