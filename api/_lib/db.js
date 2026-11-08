// Database access for drafts. A dedicated restricted role (`listings_app`) over the Supabase transaction pooler.
// The connection string is a server-side secret (LISTINGS_DATABASE_URL); the browser never sees it. If it is missing the
// draft endpoints answer 503 and nothing else is affected.
import postgres from 'postgres';
import { HttpError } from './http.js';

let client = null;

export function getDb(deps = {}, env = process.env) {
  if (deps.db) return deps.db; // tests inject an adapter
  const url = (env.LISTINGS_DATABASE_URL || '').trim();
  if (!url) throw new HttpError(503, 'drafts_not_configured');
  if (!/^postgres(ql)?:\/\//.test(url)) throw new HttpError(503, 'drafts_not_configured');
  if (!client) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    client = postgres(url, { ssl: local ? false : 'require', prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 });
  }
  return client;
}

/** True when drafts can be used: lets the dashboard degrade instead of failing. */
export const draftsConfigured = (deps = {}, env = process.env) => Boolean(deps.db || (env.LISTINGS_DATABASE_URL || '').trim());
