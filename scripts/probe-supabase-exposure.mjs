// READ-ONLY exposure probe. Uses only the public anon key (already shipped in supabase-data.js) and public endpoints.
// It creates no account, signs nobody in and writes nothing. Run: node scripts/probe-supabase-exposure.mjs
//
// Checks
//  1. anon cannot read analytics.deals or raw.deals
//  2. whether the Email provider and open sign-up are enabled (a non-Microsoft account could then obtain the
//     `authenticated` role, which analytics.deals / raw.deals grant SELECT to)
//  3. whether the Microsoft login is locked to the SDAHC tenant (not "common")
import { readFileSync } from 'node:fs';

export async function probe({ url, anonKey, fetchImpl = fetch, expectedTenant = '207ef305-ee7d-4c16-a5b3-c3bdf7b1b29b' }) {
  const findings = [];
  const H = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  for (const schema of ['analytics', 'raw']) {
    const r = await fetchImpl(`${url}/rest/v1/deals?select=name&limit=1`, { headers: { ...H, 'Accept-Profile': schema } });
    findings.push({ id: `anon-${schema}`, ok: r.status === 401 || r.status === 403, detail: `anon read of ${schema}.deals answered HTTP ${r.status}` });
  }

  const s = await (await fetchImpl(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } })).json();
  const emailOn = s?.external?.email === true;
  const signupOpen = s?.disable_signup === false;
  const autoconfirm = s?.mailer_autoconfirm === true;
  findings.push({
    id: 'email-signup',
    ok: !(emailOn && signupOpen),
    detail: `Email provider ${emailOn ? 'ENABLED' : 'off'}, sign-up ${signupOpen ? 'OPEN' : 'closed'}, auto-confirm ${autoconfirm ? 'ON' : 'off'}. ` +
      (emailOn && signupOpen ? 'Anyone can create an email/password account and, once the address is confirmed, holds the authenticated role.' : ''),
  });

  const a = await fetchImpl(`${url}/auth/v1/authorize?provider=azure&redirect_to=https://app.sdahomechoices.com.au`, { headers: { apikey: anonKey }, redirect: 'manual' });
  const loc = a.headers.get('location') || '';
  const tenant = /login\.microsoftonline\.com\/([^/]+)\//.exec(loc)?.[1] ?? null;
  findings.push({ id: 'azure-tenant', ok: tenant === expectedTenant, detail: `Microsoft login is issued for tenant "${tenant ?? 'unknown'}"` });
  return findings;
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const src = readFileSync(new URL('../supabase-data.js', import.meta.url), 'utf8');
  const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(src)[1];
  const anonKey = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(src)[1];
  const findings = await probe({ url, anonKey });
  for (const f of findings) console.log(`${f.ok ? 'PASS' : 'FAIL'}  ${f.id}: ${f.detail}`);
  process.exit(findings.every((f) => f.ok) ? 0 : 1);
}
