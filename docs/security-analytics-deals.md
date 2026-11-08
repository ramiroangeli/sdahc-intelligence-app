# Security finding: analytics.deals readable by non-Microsoft accounts (likely exploitable)

Checked 8 Nov 2026 with `node scripts/probe-supabase-exposure.mjs` (read-only, public anon key, no account created).

| Check | Result |
|---|---|
| anon reads `analytics.deals` / `raw.deals` | Denied (HTTP 401, permission denied for schema). Good |
| Microsoft login tenant | Locked to the SDAHC tenant `207ef305-...`. Good (not `common`) |
| Email provider and sign-up | **Email ENABLED, sign-up OPEN, auto-confirm off** |

## Why it matters
`schema.sql` grants SELECT on `analytics.deals` and the needed `raw.deals` columns to `authenticated`, with RLS policy
`USING (true)`. "Authenticated" means any valid Supabase session, not "SDAHC staff". With the Email provider on, anyone can
register with email and password through the public anon key, confirm their own address, and then query every deal
(names, sale prices, fees, tranches, owners, next actions).

**Not confirmed end to end.** Proving it needs a real sign-up in production Auth, which this work did not do. To confirm,
sign up with a throwaway address, confirm it, and request `GET /rest/v1/deals` with `Accept-Profile: analytics`.

## Not affected
The new Listings API never trusts "authenticated": it requires the Microsoft provider, the SDAHC tenant and the staff allowlist
(see `api/_lib/auth.js` in the Listings PR).

## Proposed fix (nothing applied)
1. Dashboard: Authentication > Sign In / Providers > **disable Email**. The Intelligence App and the RFI system use Microsoft only.
   Do not disable "Allow new users to sign up" (it would block a new colleague's first Microsoft sign-in).
2. SQL `supabase/proposed/001_analytics_microsoft_only.sql`: restrict the `raw.deals` policy to sessions created by the azure
   provider. Includes verification steps and a rollback. Run by hand after review.

Re-run the probe after step 1; it should print PASS for all four checks.
