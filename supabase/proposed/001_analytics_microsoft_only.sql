-- PROPOSED, NOT APPLIED. Review, then run by hand in the Supabase SQL editor. Do not run from code.
--
-- Problem: raw.deals grants SELECT to the `authenticated` role with policy USING (true), and analytics.deals reads
-- through it. `authenticated` means "holds any valid Supabase session", and the project has the Email provider
-- enabled with open sign-up, so a person who is not SDAHC staff can register with email/password and, after confirming
-- their own address, read every deal (names, values, fees, tranches).
--
-- Fix (defence in depth, keeps the existing app working because staff sign in with Microsoft):
-- only sessions created by the Microsoft (azure) provider may read deals. app_metadata is written by Supabase Auth
-- on the server and cannot be edited by the user.
--
-- Preferred additional step, in the dashboard: Authentication > Sign In / Providers > disable "Email".
-- (Do NOT turn off "Allow new users to sign up": the first Microsoft sign-in of a new colleague is a sign-up.)

begin;

drop policy if exists deals_read_authenticated on raw.deals;
create policy deals_read_authenticated
  on raw.deals
  for select
  to authenticated
  using ( (auth.jwt() -> 'app_metadata' ->> 'provider') = 'azure' );

commit;

-- Verify as a Microsoft-signed-in staff member in the app: Overview, Pipeline and Revenue still load.
-- Verify with an email/password test account: `select count(*) from analytics.deals` returns 0 rows.

-- ROLLBACK (restores the previous behaviour):
-- begin;
-- drop policy if exists deals_read_authenticated on raw.deals;
-- create policy deals_read_authenticated on raw.deals for select to authenticated using (true);
-- commit;
