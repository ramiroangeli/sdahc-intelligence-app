-- PROPOSED, NOT APPLIED. Review, then run by hand in the Supabase SQL editor. Do not run from code.
--
-- Problem (confirmed from the production catalog, read only, 8 Nov 2026): `authenticated` has SELECT on
-- analytics.deals and on 23 columns of raw.deals (including transaction_value, commission_pct, advisory_fee and the
-- tranche amounts), and the only policy on raw.deals is `deals_read_authenticated ... USING (true)`.
-- "authenticated" means any valid Supabase session. The Email provider is enabled with open sign-up, so a person who
-- is not SDAHC staff can register with email/password, confirm their own address and read every deal.
--
-- Fix: replace the policy so only sessions created by the Microsoft (azure) provider can read rows. app_metadata is
-- written by Supabase Auth on the server and cannot be edited by the user. Staff sign in with Microsoft, so they keep
-- access. Email sessions then see zero rows (analytics.deals is a security_invoker view, so it inherits the policy).
-- Nothing else changes: no grant, no table, no view, no function, no other schema (RFI connects as rfi_app, which has
-- no access to raw/analytics, and sync/ uses service_role, which bypasses RLS).
--
-- BEFORE running: confirm staff really are azure-provider users (counts only, no emails):
--   select raw_app_meta_data->>'provider' as provider, count(*) from auth.users group by 1 order by 2 desc;
-- Every staff member must appear under 'azure'. Any 'email' users: find out who they are first (see docs).

begin;

drop policy if exists deals_read_authenticated on raw.deals;
create policy deals_read_authenticated
  on raw.deals
  for select
  to authenticated
  using ( (select auth.jwt() -> 'app_metadata' ->> 'provider') = 'azure' );

commit;

-- VERIFY (in the app): sign in with Microsoft, open Overview, Pipeline and Revenue. They must still load deals.
-- VERIFY (policy text):
--   select policyname, roles, qual from pg_policies where schemaname='raw' and tablename='deals';

-- ROLLBACK (restores exactly the previous behaviour; takes effect immediately, no data is touched):
-- begin;
-- drop policy if exists deals_read_authenticated on raw.deals;
-- create policy deals_read_authenticated on raw.deals for select to authenticated using (true);
-- commit;
