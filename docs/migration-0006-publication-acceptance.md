# Migration 0006 and release sequence: the Publisher declaration

Status: prepared and tested locally only. NOT applied to Production. Apply only after explicit approval.

## What it does

`supabase/migrations/listings_0006_publication_acceptance.sql` (one transaction, safe to run twice, `listings` schema only):

- widens `audit_log_action_check` to allow `publication_acceptance`;
- adds a check that an acceptance row carries `accepted: true`, a 64 character content hash, a terms version, a job, a draft version and an authenticated user;
- adds `audit_acceptance_job`: an acceptance can only be written for a queued job of the same listing, draft version, person and content hash;
- adds `publish_job_acceptance_guard`: once a job has an acceptance, its payload, hash, requester and identity cannot change (status and result still can).

No new table, no new grant, no `SECURITY DEFINER`. `listings.audit_log` stays append-only (select and insert only for `listings_app`; the update, delete and truncate triggers from 0005 are untouched).

## Backward compatibility

The code that is in Production today never writes `publication_acceptance`, and the new triggers only act on rows or jobs that carry one. Applying 0006 first changes nothing for the current app. Existing jobs and audit rows are untouched.

## The app cannot run against a database without it

- A Publisher's preview (`GET draft-publish?preview=`) and a real publish both check that the constraint allows `publication_acceptance`. If not, the answer is `503 migration_required` and nothing is recorded, copied or dispatched.
- Acceptance and job are written in one transaction, so a failure leaves neither.

## Release sequence (corrected against the code)

The website job runs the engine from the website `main` branch at the time it starts, and the two repositories change the request format together: the app now sends version 2 with a declaration, and the new website engine refuses a legacy version 1 request for a real publication (a dry run still accepts it). The old engine refuses version 2 outright. So whichever merges second leaves a short window in which publishing stops safely (nothing is published). Website first keeps dry runs working and makes it impossible to publish without a declaration at any moment, so:

0. Before starting: confirm no job is running. In the SQL editor: `select id, kind, status from listings.publish_jobs where status in ('queued','dispatched','running');` must return no rows. Do not publish anything between steps 2 and 3.
1. Apply migration 0006 (below). Verify it.
2. Merge and deploy website PR #82.
3. Merge and deploy app PR #36 (merging to main deploys the app).
4. Production verification, below.

The window between steps 2 and 3 is minutes. In it a real publication from the old app is refused by the engine ("did not receive a valid confirmation") and nothing changes on the website. A job that was in flight is failed and the Publisher starts a new one from the new screen.

## Apply

In the Supabase SQL editor paste `supabase/migrations/listings_0006_publication_acceptance.sql` and run it.

Verify: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'audit_log_action_check';` mentions `publication_acceptance`; `select tgname from pg_trigger where tgname in ('audit_acceptance_job','publish_job_acceptance_guard');` returns both.

## Recovery

Run `supabase/migrations/listings_0006_publication_acceptance_rollback.sql`. It refuses (`Cannot roll back while publication acceptance records exist`) once any acceptance has been recorded, because those rows are evidence and the audit log is append-only. Before the first real publication it rolls back cleanly. After that, do not roll back: revert the app instead (the migration is harmless to the old app).

## Production verification

1. Open a Publisher's session on a listing at the Publish step: the confirmation box is unticked and the button is disabled until it is ticked.
2. Do not publish a real property to test. An administrator can check the database side by `select 1` of the constraint above, and a Publisher's preview returns a hash (no `503 migration_required`).
3. At the first real publication, confirm one `publication_acceptance` row linked to the job in `listings.audit_log`.

## Tested locally

`tests/publication-acceptance-migration.test.js` (idempotent, rejects incomplete or mismatched acceptances, payload immutability, append-only, rollback refusal), `tests/publication-acceptance-atomic.test.js`, `tests/publisher-declaration.test.js` and one browser click-through against a local database (`scripts/declaration-e2e-server.mjs`). No real database was touched.
