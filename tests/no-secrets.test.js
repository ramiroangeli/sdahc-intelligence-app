import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Files the browser receives. They must never mention a server credential or privileged endpoint.
const BROWSER = ['listings.js', 'listings.css', 'index.html'];
const FORBIDDEN = [/NOTION_[A-Z_]*TOKEN/, /api\.notion\.com/, /BLOB_/i, /GITHUB_[A-Z_]*TOKEN/, /service_role/i, /SERVICE_KEY/, /secret_[A-Za-z0-9]{10,}/, /ntn_[A-Za-z0-9]{10,}/, /ghp_[A-Za-z0-9]{10,}/, /github_pat_/];

test('browser files contain no credentials or privileged endpoints', () => {
  for (const f of BROWSER) for (const re of FORBIDDEN) assert.ok(!re.test(readFileSync(f, 'utf8')), `${f} matches ${re}`);
});
test('listings.js renders server values safely (no innerHTML / insertAdjacentHTML / document.write)', () => {
  const src = readFileSync('listings.js', 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|outerHTML/.test(src));
});
test('no committed file contains a token-shaped secret', () => {
  const hits = [];
  const walk = (d) => { for (const f of readdirSync(d)) { if (['node_modules', '.git', '00_context'].includes(f)) continue; const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|mjs|json|md|html|yml|css|sql)$/.test(f) && f !== 'data.js' && f !== 'no-secrets.test.js') { const s = readFileSync(p, 'utf8'); if (/ntn_[A-Za-z0-9]{20,}|secret_[A-Za-z0-9]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|vercel_blob_rw_[A-Za-z0-9_]+|sb_secret_/.test(s)) hits.push(p); } } };
  walk('.');
  assert.deepEqual(hits, []);
});

test('nothing but the app shell is served as a static file: server code, tests, SQL and docs are excluded or under api/_', () => {
  const ignore = readFileSync('.vercelignore', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const dir of ['tests', 'scripts', 'docs', 'sync', 'supabase', '.github', '00_context']) assert.ok(ignore.includes(dir), `${dir} must be in .vercelignore`);
  assert.ok(!readdirSync('.').includes('vendor'), 'no top-level vendor folder (it would be served)');
});
