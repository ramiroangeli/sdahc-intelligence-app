// Shared test helpers: fake req/res, fake Supabase user, fake fetch.
export const TENANT = '207ef305-ee7d-4c16-a5b3-c3bdf7b1b29b';
export const FAKE_TOKEN = 'tok_' + 'a'.repeat(40);

export const authConfig = (staff = [{ email: 'ali@sdahomechoices.com.au', capabilities: ['listings.view', 'listings.edit', 'listings.publish'], active: true, authUserId: null }]) => ({
  supabaseUrl: 'https://example.supabase.co', anonKey: 'anon', tenantId: TENANT, staff,
});

export const azureUser = (over = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ali@sdahomechoices.com.au',
  app_metadata: { provider: 'azure', providers: ['azure'] },
  user_metadata: { iss: `https://login.microsoftonline.com/${TENANT}/v2.0` },
  identities: [{ provider: 'azure', identity_data: { email: 'ali@sdahomechoices.com.au', iss: `https://login.microsoftonline.com/${TENANT}/v2.0` } }],
  ...over,
});

export const req = (over = {}) => ({ method: 'GET', headers: { authorization: `Bearer ${FAKE_TOKEN}` }, ...over });

export function res() {
  const r = { statusCode: 200, headers: {}, body: '', setHeader(k, v) { r.headers[k.toLowerCase()] = v; }, end(b) { r.body = b ?? ''; r.done = true; } };
  Object.defineProperty(r, 'json', { get: () => JSON.parse(r.body) });
  return r;
}

/** fetch that answers the Supabase /auth/v1/user call with `user` (or a status), and records every URL. */
export function supabaseFetch(user, status = 200, calls = []) {
  return async (url) => {
    calls.push(String(url));
    return { ok: status >= 200 && status < 300, status, json: async () => user };
  };
}
