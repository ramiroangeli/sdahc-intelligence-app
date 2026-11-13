// LOCAL BROWSER TEST SERVER ONLY (never deployed: Vercel does not run scripts/). Serves the real static app and the real Listings routes on
// http://127.0.0.1:8788 so a browser can click through Prepare, Preview, the responsibility checkbox and Publish on a SYNTHETIC listing.
//   - the database is an in-memory PGlite running migrations 0001 to 0006 (0006 is applied here for local testing only)
//   - Notion, GitHub, the website and the image stores are the test harness fakes: nothing leaves this machine, no real property is read or published
//   - the login gate is opened with a stub session and a fake `authorise`, exactly like scripts/dev-server.mjs
// /__proof?job=<id> (test only) returns the private audit rows, the job and the signed payload the website engine would receive.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { draftPhotoRoute, draftPhotosRoute, draftPublishRoute, draftRoute, draftVerifyRoute, listRoute, meRoute, propertiesRoute, publishCallbackRoute, publishPayloadRoute } from '../api/_lib/routes.js';
import { ALI_N, ID_7B, PUBLISH_ENV, SECRET, call, callSigned, database, github, world } from '../tests/drafts-harness.js';

if (process.env.VERCEL || process.env.NODE_ENV === 'production') { console.error('refusing to run in production'); process.exit(1); }
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8788);
const w = world(); const db = await database(); const gh = github(w);
// a synthetic Northern Territory property whose CRM occupancy matches the wording (the Victorian advertising sign-off and the occupancy check are separate, existing gates)
w.state.page7B = { ...w.state.page7B, properties: { ...w.state.page7B.properties, 'State/ Territory': { type: 'select', select: { name: 'NT' } }, Description: { type: 'rich_text', rich_text: [{ plain_text: 'Operating SDA property. 3 participant places; 3 occupied (3/3 physical occupancy).' }] } } };
const asEditor = process.env.DEV_ROLE === 'editor';
const staffCaps = asEditor ? ['listings.view', 'listings.edit'] : ['listings.view', 'listings.edit', 'listings.publish'];
const fakeAuth = async () => ({ staff: { email: 'ali@sdahomechoices.com.au', capabilities: staffCaps, notionUserId: null }, identity: { email: 'ali@sdahomechoices.com.au', authUserId: '22222222-2222-4222-8222-000000000025' } });
const deps = { authorise: fakeAuth, db, blob: w.blob, publicBlob: w.publicBlob, fetch: gh.fetch, env: PUBLISH_ENV,
  dataConfig: { notion: { token: 'tok', dataSourceId: 'ds', version: 'v' }, repo: 'o/r', ref: 'main', siteBase: 'https://sdahomechoices.com.au', githubReadToken: null } };

// seed one synthetic, publishable draft (Northern Territory, with commercial figures and four photographs worth of metadata)
const jpeg = (n) => sharp({ create: { width: 1600 + n * 10, height: 1000, channels: 3, background: { r: (n * 37) % 255, g: (n * 91) % 255, b: (n * 151) % 255 } } }).jpeg().toBuffer();
const content = { title: 'Established Improved Liveability SDA Investment', description: 'An established SDA investment in Exampleton.\n\nInvestment summary:\n- Gross income: $61,000 p.a.\n- Net yield: 6.1%\n- Leased to a registered SDA provider', publicAddress: 'Wattle Street, Exampleton NT 0800', pricingMode: 'contact_agent', displayPrice: '', featured: false,
  investment: { leaseStatus: 'partially_leased', occupancyStatus: 'partially_occupied', annualIncomeAud: 61000, incomeType: 'gross', yieldPct: 6.1, yieldType: 'gross', basis: 'actual' }, sdaFacts: { bedrooms: 4 }, property: { bathrooms: 2 } };
const c = await call(draftRoute, w, db, ALI_N, { method: 'POST', body: { propertyId: ID_7B } });
await call(draftRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: c.json.draft.version, content } });
const up = (b, kind) => call(draftPhotosRoute, w, db, ALI_N, { method: 'POST', body: b, headers: { 'x-image-type': 'image/jpeg' }, url: `/api/listings/draft-photos?id=${ID_7B}${kind ? `&kind=${kind}` : ''}` });
await up(await jpeg(1)); await up(await jpeg(2)); const p3 = await up(await jpeg(3), 'floorplan');
const ids = p3.json.photos.items.map((p) => p.id);
await call(draftPhotosRoute, w, db, ALI_N, { method: 'PUT', body: { id: ID_7B, expectedVersion: p3.json.draft.version, photos: [{ id: ids[0], alt: 'Kitchen', kind: 'photo' }, { id: ids[1], alt: '', kind: 'photo' }, { id: ids[2], alt: '', kind: 'floorplan' }] } });

const routes = { '/api/listings': listRoute(deps), '/api/listings/me': meRoute(deps), '/api/listings/properties': propertiesRoute(deps), '/api/listings/draft': draftRoute(deps), '/api/listings/draft-photos': draftPhotosRoute(deps), '/api/listings/draft-photo': draftPhotoRoute(deps), '/api/listings/draft-verify': draftVerifyRoute(deps), '/api/listings/draft-publish': draftPublishRoute(deps), '/api/listings/publish-callback': publishCallbackRoute(deps), '/api/listings/publish-payload': publishPayloadRoute(deps) };
const STUB = `<script>(function(){var s={access_token:'e2e-token-not-real-0000',user:{email:'ali@sdahomechoices.com.au'}};
var chain=function(){var p=new Proxy(function(){},{get:function(_,k){if(k==='then')return function(r){return Promise.resolve({data:[],error:null}).then(r)};return p},apply:function(){return p}});return p};
if(/[?&]open=listings/.test(location.search))window.addEventListener('load',function(){setTimeout(function(){var b=document.querySelector('[data-view=listings]');if(b)b.click()},600)});
window.supabase={createClient:function(){return{auth:{getSession:function(){return Promise.resolve({data:{session:s}})},onAuthStateChange:function(cb){setTimeout(function(){cb('SIGNED_IN',s)})},signOut:function(){return Promise.resolve({})},signInWithOAuth:function(){return Promise.resolve({})}},schema:chain,from:chain}}}})();</script>`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__proof') {
    const job = (await db.unsafe('select id, status, kind, draft_version, payload_hash, requested_by from listings.publish_jobs order by created_at desc limit 1'))[0] ?? null;
    const audit = await db.unsafe("select action, actor_email, job_id, draft_version, detail from listings.audit_log order by id");
    const payload = job ? (await callSigned(publishPayloadRoute, db, { url: `/api/listings/publish-payload?job=${job.id}`, secret: SECRET })).json : null;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ job, audit, dispatches: gh.dispatches.length, payload }));
  }
  if (routes[url.pathname]) return routes[url.pathname](req, res);
  const rel = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]/, '');
  const file = join(root, rel);
  if (!file.startsWith(root) || /^(api|sync|scripts|tests|docs|00_context|supabase|node_modules)(\/|$)/.test(rel)) { res.statusCode = 404; return res.end('not found'); }
  try {
    let body = await readFile(file);
    if (rel === 'index.html') body = Buffer.from(body.toString().replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]*><\/script>/, STUB));
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`Declaration e2e server on http://127.0.0.1:${PORT}`));
