# Migration 0005: private audit log and the reinstate job kind

**Status: APPLIED to Production on 11 Nov 2026 and verified** (permissions, preserved records, the `reinstate` kind, append-only behaviour). The text below describes what it does and how to roll it back. The app writes to it from the withdrawal and from a public status change (`api/_lib/audit-log.js`); rolling it back now would stop those from working.

## What it does
1. **`listings.audit_log`**, a private, append-only operational audit trail for status changes, withdrawals and reinstatements.
   - Who: `actor_email` and `actor_auth_user`, written by the server from the verified Microsoft session. No request field can name someone else (`appendAudit` takes the session, never a body value).
   - Why: `reason`, required for a withdrawal, at most 300 characters. It never leaves the Listings Manager: not in a payload, pull request, commit, log line or public file.
   - Immutability at the database level: triggers refuse every update, delete and truncate, for the app role **and** the table owner. The timestamp (`at`) and the writing role (`recorded_by`) are stamped by the database, so a caller cannot backdate or impersonate.
   - Access: only `listings_app` can select and insert, through row-level security with no update or delete policy. `anon`, `authenticated` and `service_role` have nothing.
   - Rules enforced by the database as well as the code: a withdrawal needs a reason; a status change needs two different valid statuses; a reinstatement needs a status; emails are lower case; the listing id has the public format.
2. **`publish_jobs.kind` also allows `reinstate`.** Widening a check cannot invalidate a row, so existing jobs, idempotency keys and the one-active-job-per-listing index are untouched.

Only the `listings` schema is touched. Nothing in raw, history, analytics, public or rfi.

## Apply (only after approval)
1. In the Supabase SQL editor, paste `supabase/migrations/listings_0005_audit_log_and_reinstate.sql` and run it. It is one transaction and can be run twice safely.
2. Run the VERIFY queries at the bottom of the file. Expected: the first row of five all false, the second both true, the constraint definition includes `reinstate`, and the job count is what it was before.
3. Tell the assistant, who then runs the read-only application checks. No deployment is needed for this step.

## Roll back
Run `supabase/migrations/listings_0005_audit_log_and_reinstate_rollback.sql`.
- It **deletes the audit trail**, so it refuses to run while the log has rows. Export them first (`select * from listings.audit_log order by id;`), then in the same session run `set listings.confirm_drop_audit = 'yes';` and run the script again.
- It also refuses while any `reinstate` job exists (history is never removed).
- Draft data and every other job are untouched.

## Tested
`tests/audit-log.test.js` runs the real SQL in PGlite on top of migrations 0001 to 0004 with existing job history, then acts as each role: applies twice with all records preserved, the kind check, role access, append-only (app role and owner), no backdating, the database-level rules, the session-only actor, and the guarded rollback (including re-applying after it). The existing suites also run on the migrated schema.
