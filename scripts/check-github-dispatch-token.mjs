// Checks the GitHub token the app uses to start publication jobs, WITHOUT starting anything.
//   LISTINGS_GITHUB_DISPATCH_TOKEN=<token> node scripts/check-github-dispatch-token.mjs [owner/repo] [workflow.yml]
// Three calls: read the repository, read the workflow, and ask GitHub to dispatch the workflow on a ref that does not exist. GitHub checks the
// permission before the ref, so a token that may dispatch answers 422 "No ref found" and nothing runs; a token that may not answers 403.
// Prints statuses, GitHub's scrubbed message, the token's expiry date and one verdict. The token itself is never printed.
import { explainDispatch, scrub } from '../api/_lib/publication.js';

export async function checkToken({ token, repo = 'ramiroangeli/sdahc-website', workflow = 'publish-listing.yml', fetchImpl = fetch }) {
  const call = async (method, path, body) => {
    try {
      const r = await fetchImpl(`https://api.github.com${path}`, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'sdahc-listings-token-check', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
      let message = ''; try { message = (await r.json()).message ?? ''; } catch { /* no body */ }
      return { status: r.status, message, accepted: r.headers?.get?.('x-accepted-github-permissions') ?? '', expires: r.headers?.get?.('github-authentication-token-expiration') ?? '' };
    } catch { return { status: 0, message: 'unreachable', accepted: '', expires: '' }; }
  };
  const r = await call('GET', `/repos/${repo}`);
  const w = await call('GET', `/repos/${repo}/actions/workflows/${workflow}`);
  const d = await call('POST', `/repos/${repo}/actions/workflows/${workflow}/dispatches`, { ref: 'token-check-no-such-ref-nothing-will-run', inputs: { job_id: '00000000-0000-4000-8000-000000000000', public_id: 'lst_0000000000', mode: 'dry_run' } });
  let verdict;
  if (r.status === 401) verdict = 'INVALID: GitHub does not accept this token (expired, revoked or mistyped).';
  else if (r.status === 404) verdict = 'NO ACCESS: the token cannot see the repository. Edit it and select the repository.';
  else if (w.status === 404) verdict = 'WORKFLOW NOT FOUND: publish-listing.yml is not on the default branch of that repository.';
  else if (d.status === 403) verdict = `MISSING PERMISSION: ${explainDispatch(403, d.message, d.accepted)}`;
  else if (d.status === 404 || d.status === 422) verdict = 'OK: the token may start the workflow (GitHub got as far as checking the ref). Nothing was started.';
  else if (d.status === 204) verdict = 'UNEXPECTED: a workflow run may have started.';
  else verdict = `UNEXPECTED: GitHub answered HTTP ${d.status}.`;
  const show = (x) => ({ status: x.status, message: scrub(x.message, token), ...(x.accepted ? { needs: scrub(x.accepted, token) } : {}) });
  return { verdict, ok: /^OK/.test(verdict), repository: show(r), workflow: show(w), dispatch: show(d), expires: r.expires || w.expires || d.expires || null };
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const token = (process.env.LISTINGS_GITHUB_DISPATCH_TOKEN ?? '').trim();
  if (!token) { console.error('Set LISTINGS_GITHUB_DISPATCH_TOKEN in the environment (it is never printed).'); process.exit(2); }
  const out = await checkToken({ token, repo: process.argv[2] || undefined, workflow: process.argv[3] || undefined });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
