-- PROPOSED, NOT APPLIED. Do not run in Production without explicit approval. Run by hand in the Supabase SQL editor (the same way as 0004).
-- Touches only the `listings` schema. No change to the drafts tables, to grants for any other role, or to raw, history, analytics, public or rfi.
-- Reversible while unused (listings_0005_audit_log_and_reinstate_rollback.sql; the rollback refuses to delete audit rows unless told to).
--
-- 1. listings.audit_log: the PRIVATE, append-only operational audit trail for status changes, withdrawals and reinstatements. It holds who acted and,
--    for a withdrawal, the free-text reason. Nothing here is ever sent to GitHub or the public website. The actor is written by the server from the
--    verified Microsoft session (api/_lib/audit-log.js); no request field can set it. Rows cannot be changed or deleted, and the timestamp cannot be set by the caller.
-- 2. listings.publish_jobs.kind also accepts 'reinstate' (a distinct kind; 'withdraw' already exists). Widening a check never invalidates a row.
begin;

create table if not exists listings.audit_log (
  id               bigint generated always as identity primary key,
  at               timestamptz not null default now(),                  -- forced to now() by the trigger below: a caller cannot backdate
  recorded_by      text not null default current_user,                  -- the database role that wrote the row (forced by the trigger)
  actor_email      text not null check (actor_email = lower(actor_email) and length(actor_email) between 3 and 254),
  actor_auth_user  uuid,
  action           text not null check (action in ('status_change', 'withdraw', 'reinstate')),
  public_id        text not null check (public_id ~ '^lst_[a-f0-9]{10}$'),
  draft_version    integer,
  job_id           uuid references listings.publish_jobs (id),
  status_from      text check (status_from in ('available', 'under_offer', 'sold')),
  status_to        text check (status_to in ('available', 'under_offer', 'sold')),
  reason           text check (reason is null or length(btrim(reason)) between 1 and 300),
  detail           jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 4096),
  constraint audit_withdraw_needs_reason check (action <> 'withdraw' or reason is not null),
  constraint audit_status_change_needs_values check (action <> 'status_change' or (status_from is not null and status_to is not null and status_from <> status_to)),
  constraint audit_reinstate_needs_status check (action <> 'reinstate' or status_to is not null)
);
create index if not exists audit_log_listing_idx on listings.audit_log (public_id, at desc);

-- Immutability at the database level: an insert is stamped by the database; any update, delete or truncate is refused, whoever asks.
create or replace function listings.audit_log_guard() returns trigger language plpgsql as $fn$
begin
  if tg_op = 'INSERT' then
    new.at := now();
    new.recorded_by := current_user;
    return new;
  end if;
  raise exception 'listings.audit_log is append-only (% refused)', tg_op using errcode = '42501';
end
$fn$;
drop trigger if exists audit_log_stamp on listings.audit_log;
create trigger audit_log_stamp before insert on listings.audit_log for each row execute function listings.audit_log_guard();
drop trigger if exists audit_log_no_change on listings.audit_log;
create trigger audit_log_no_change before update or delete on listings.audit_log for each row execute function listings.audit_log_guard();
drop trigger if exists audit_log_no_truncate on listings.audit_log;
create trigger audit_log_no_truncate before truncate on listings.audit_log for each statement execute function listings.audit_log_guard();

revoke all on listings.audit_log from public, anon, authenticated, service_role;
grant select, insert on listings.audit_log to listings_app;               -- no update, delete or truncate: it is history
alter table listings.audit_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'listings' and tablename = 'audit_log' and policyname = 'listings_app_read') then
    create policy listings_app_read on listings.audit_log for select to listings_app using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'listings' and tablename = 'audit_log' and policyname = 'listings_app_append') then
    create policy listings_app_append on listings.audit_log for insert to listings_app with check (true);
  end if;
end $$;

-- The job kind check, whatever the earlier constraint was named, is replaced by one that also allows 'reinstate'.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'listings.publish_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dry_run%' loop
    execute format('alter table listings.publish_jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table listings.publish_jobs add constraint publish_jobs_kind_check check (kind in ('dry_run', 'publish', 'update', 'withdraw', 'reinstate'));

commit;

-- VERIFY (after running):
--   select has_table_privilege('anon','listings.audit_log','select') a, has_table_privilege('authenticated','listings.audit_log','select') b,
--          has_table_privilege('service_role','listings.audit_log','select') c, has_table_privilege('listings_app','listings.audit_log','update') d,
--          has_table_privilege('listings_app','listings.audit_log','delete') e;                                   -> all five false
--   select has_table_privilege('listings_app','listings.audit_log','insert') i, has_table_privilege('listings_app','listings.audit_log','select') s;  -> both true
--   select pg_get_constraintdef(oid) from pg_constraint where conname = 'publish_jobs_kind_check';               -> includes 'reinstate'
--   select count(*) from listings.publish_jobs;                                                                  -> unchanged from before
