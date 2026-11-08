# Security: deal data readable by any signed-in session

Status: **fix prepared and tested, not applied.** Merging this PR changes nothing in production.

## Evidence
Production catalog, read only (8 Nov 2026, catalog functions only, no rows read, read-only transaction):
- `raw.deals`: RLS on, one policy `deals_read_authenticated` (SELECT, role `authenticated`, `USING (true)`).
- `authenticated` can SELECT `analytics.deals` (a `security_invoker` view) and 23 columns of `raw.deals`, including
  `transaction_value`, `commission_pct`, `advisory_fee`, `tranche1/2_amount`.
- Everything else is closed: `raw.contacts/tasks/groups` and the three `history` tables give `anon`, `authenticated` and
  `rfi_app` no privileges. No functions exist in `raw`, `history` or `analytics`. `anon` has no access to any of it.
- Public probe: Email provider enabled, sign-up open, auto-confirm off. Microsoft login is locked to the SDAHC tenant.

So the exposure is exactly one table and one view, reachable by any session. A non-staff person can create an email/password
account, confirm their own address, and read every deal. Reproduced in an in-process Postgres with the real schema file
(`tests/security-db.test.js`, first test). Not exercised against production, because that needs a real sign-up.

## Fix
`supabase/proposed/001_analytics_microsoft_only.sql`: replace the policy so only sessions created by the Microsoft provider
(`app_metadata.provider = 'azure'`) match. One statement pair in a transaction. No grant, table, view, function or other
policy changes (a test compares all grants, column grants, view options and policies before and after).

## Impact
| Who | Before | After |
|---|---|---|
| SDAHC staff signed in with Microsoft | read | read (unchanged) |
| Email/password session | read | zero rows |
| Session with no provider metadata | read | zero rows |
| Anonymous | denied | denied |
| Nightly sync (`service_role`) | read/write | unchanged (bypasses RLS) |
| RFI system | no access to raw/analytics | unchanged (connects as `rfi_app`; staff sign in with Microsoft only) |
| Listings Manager API | not affected | not affected (never relied on "authenticated") |

Existing email sessions: the policy cuts them off immediately; disabling the provider also stops new sign-ins.

## Does disabling the Email provider break anything?
Code search of the Intelligence App, the RFI system and the website finds only `signInWithOAuth` (Microsoft). There is no
password sign-in, sign-up, magic link, OTP or reset flow. The RFI client portal uses its own tokens, not Supabase Auth.
Only these two apps were found using this Supabase project on this machine; check Vercel and GitHub for any other.
Unknown: whether legitimate email users already exist (the `auth` schema is not readable with the app roles). Step 1 below answers it.

## Manual actions, in this order (about 10 minutes)
1. **Look first** (Supabase SQL editor, counts only, nothing changes):
   `select raw_app_meta_data->>'provider' as provider, count(*) from auth.users group by 1 order by 2 desc;`
   Expect only `azure`. If `email` appears, find out who before continuing:
   `select id, created_at, last_sign_in_at from auth.users where raw_app_meta_data->>'provider' = 'email';`
2. **Apply the SQL** from `supabase/proposed/001_analytics_microsoft_only.sql` (transaction, instant, reversible).
3. **Verify in the app**: sign in with Microsoft at app.sdahomechoices.com.au; Overview, Pipeline and Revenue must still show deals.
4. **Disable Email**: Dashboard > Authentication > Sign In / Providers > Email > off, save.
   Do NOT touch "Allow new users to sign up" (a new colleague's first Microsoft login is a sign-up).
5. **Re-run the probe**: `node scripts/probe-supabase-exposure.mjs`. All four checks should print PASS.

## Rollback
- SQL: run the commented ROLLBACK block at the bottom of the SQL file (restores `USING (true)`; immediate, no data touched).
- Provider: Authentication > Sign In / Providers > Email > on.

## If step 3 fails
Staff would see empty dashboards. Run the rollback, then check staff sessions: `select raw_app_meta_data from auth.users where email = '<staff>'`
(the `provider` key must be `azure`). The RFI system already requires `provider = azure` for staff, and the Listings API does too,
so a mismatch would show up there as well.
