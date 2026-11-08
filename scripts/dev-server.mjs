// LOCAL PREVIEW ONLY. Serves the static app and the Listings routes on http://127.0.0.1:8787 so the screen can be
// reviewed without deploying. It is not part of the deployed app (Vercel never runs scripts/).
//
// To keep production code free of any bypass, this server does two things production never does:
//   1. injects a fake `authorise` into the route factories (the real auth path is covered by the tests), and
//   2. swaps the Supabase CDN script for a stub session so the login gate opens.
// It refuses to start when VERCEL or NODE_ENV=production is set. Real Notion and website reads still happen if
// NOTION_LISTINGS_TOKEN and NOTION_PROPERTIES_DATA_SOURCE_ID are in the environment.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRoute, meRoute } from '../api/_lib/routes.js';

if (process.env.VERCEL || process.env.NODE_ENV === 'production') { console.error('dev-server refuses to run in production'); process.exit(1); }

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8787);
const caps = (process.env.DEV_CAPS || 'listings.view,listings.edit,listings.publish').split(',');
const fakeAuth = async () => ({ staff: { email: 'dev-preview@local', capabilities: caps }, identity: { email: 'dev-preview@local' } });
const routes = { '/api/listings': listRoute({ authorise: fakeAuth }), '/api/listings/me': meRoute({ authorise: fakeAuth }) };

const STUB = `<script>(function(){var s={access_token:'dev-preview-token-not-real-0000',user:{email:'dev-preview@local'}};
var chain=function(){var p=new Proxy(function(){},{get:function(_,k){if(k==='then')return function(r){return Promise.resolve({data:[],error:null}).then(r)};return p},apply:function(){return p}});return p};
if(/[?&]open=listings/.test(location.search))window.addEventListener('load',function(){setTimeout(function(){var b=document.querySelector('[data-view=listings]');if(b)b.click()},600)});
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
