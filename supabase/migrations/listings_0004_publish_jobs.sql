-- PROPOSED, NOT APPLIED. Run by hand in the Supabase SQL editor BEFORE deploying the publishing release (increment 1: dry run).
-- Adds ONE table to the existing `listings` schema. No change to the drafts tables, grants to other roles, raw, history, analytics,
-- public or rfi. Reversible (listings_0004_publish_jobs_rollback.sql).
--
-- A publication job is the durable record of one publication attempt for one draft. The work itself runs on GitHub's servers and reports
-- back by signed request, so a job continues if the browser is closed. `payload` is the frozen PUBLIC content that was approved (the same
-- text a visitor would read, plus the photograph list): no address, price, yield or income, and nothing from Notion's internal fields.
begin;

create table if not exists listings.publish_jobs (
  id                      uuid primary key default gen_random_uuid(),
  public_id               text not null check (public_id ~ '^lst_[a-f0-9]{10}$'),
  draft_id                uuid not null references listings.drafts (id),
  draft_version           integer not null,
  kind                    text not null check (kind in ('dry_run', 'publish', 'update', 'withdraw')),
  attempt                 integer not null default 1,
  status                  text not null default 'queued' check (status in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled')),
  step                    text,
  steps                   jsonb not null default '[]'::jsonb,   -- ordered progress events reported by the job
  payload                 jsonb not null,                       -- frozen approved public content
  payload_hash            text not null,
  requested_by            text not null,
  requested_by_auth_user  uuid,
  approver_notion_user_id text,
  idempotency_key         text not null unique,
  run_id                  bigint,
  run_url                 text,
  result                  jsonb,
  error_code              text,
  error_message           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  started_at              timestamptz,
  finished_at             timestamptz
);
-- at most one active job per listing: two clicks, or two people, cannot start two publications of the same property
create unique index if not exists publish_jobs_one_active_per_listing on listings.publish_jobs (public_id) where status in ('queued', 'dispatched', 'running');
create index if not exists publish_jobs_listing_idx on listings.publish_jobs (public_id, created_at desc);

revoke all on listings.publish_jobs from public, anon, authenticated, service_role;
grant select, insert, update on listings.publish_jobs to listings_app;   -- no delete: jobs are history
alter table listings.publish_jobs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'listings' and tablename = 'publish_jobs' and policyname = 'listings_app_access') then
    create policy listings_app_access on listings.publish_jobs for all to listings_app using (true) with check (true);
  end if;
end $$;

commit;

-- VERIFY (after running):
--   select has_table_privilege('anon','listings.publish_jobs','select') a, has_table_privilege('authenticated','listings.publish_jobs','select') b,
--          has_table_privilege('service_role','listings.publish_jobs','select') c, has_table_privilege('listings_app','listings.publish_jobs','delete') d;
--   -> all four false.
