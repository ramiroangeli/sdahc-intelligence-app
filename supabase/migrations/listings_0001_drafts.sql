-- PROPOSED, NOT APPLIED. Run by hand in the Supabase SQL editor after review. Creates a NEW schema only.
-- Touches nothing in raw, history, analytics, public or rfi. Reversible (see the bottom).
--
-- Holds pending website revisions (drafts) and their history. Notion stays the canonical CRM: this stores only the
-- public-facing draft text the staff write, plus hashes of the Notion facts the draft was based on. It never stores
-- addresses, prices, yields or income from Notion.
--
-- Access model (same pattern as the RFI system): a dedicated login role `listings_app`, RLS on, the schema NOT exposed
-- in the Supabase Data API, nothing granted to anon, authenticated or service_role. The browser never reaches these
-- tables: only the server functions in /api do, with authorisation checked first.

begin;

create schema if not exists listings;

create table listings.drafts (
  id                    uuid primary key default gen_random_uuid(),
  public_id             text not null check (public_id ~ '^lst_[a-f0-9]{10}$'),
  notion_page_id        text not null,
  label                 text not null,                    -- CRM name with the house/unit number removed
  status                text not null default 'draft' check (status in ('draft')),
  content               jsonb not null default '{}'::jsonb, -- title, description, publicAddress, pricingMode, displayPrice, featured
  notes                 jsonb not null default '[]'::jsonb, -- staff commercial verification notes
  verification          jsonb not null default '{}'::jsonb, -- acknowledgements of system-detected items
  base_facts            jsonb not null,                    -- hashes of the Notion facts this draft is based on
  base_notion_edited_at timestamptz,
  version               integer not null default 1,        -- optimistic lock
  created_by            text not null,
  created_by_auth_user  uuid,
  created_at            timestamptz not null default now(),
  updated_by            text not null,
  updated_by_auth_user  uuid,
  updated_at            timestamptz not null default now(),
  discarded_at          timestamptz,
  discarded_by          text
);
-- one open draft per Notion property
create unique index drafts_one_open_per_property on listings.drafts (notion_page_id) where discarded_at is null;
create unique index drafts_one_open_per_public_id on listings.drafts (public_id) where discarded_at is null;

create table listings.draft_history (
  id                   bigint generated always as identity primary key,
  draft_id             uuid not null references listings.drafts (id),
  version              integer not null,
  action               text not null check (action in ('create','update','refresh_base','verify','note','discard')),
  changed_fields       text[] not null default '{}',
  content              jsonb not null,                    -- snapshot of the draft content after the change
  changed_by           text not null,
  changed_by_auth_user uuid,
  changed_at           timestamptz not null default now()
);
create index draft_history_draft_idx on listings.draft_history (draft_id, id desc);

-- login role: set its password separately (see docs), never in this file
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'listings_app') then
    create role listings_app login connection limit 10;
  end if;
end $$;
alter role listings_app set statement_timeout = '8s';

revoke all on schema listings from public, anon, authenticated, service_role;
revoke all on all tables in schema listings from public, anon, authenticated, service_role;
revoke all on all sequences in schema listings from public, anon, authenticated, service_role;

grant usage on schema listings to listings_app;
grant select, insert, update on listings.drafts to listings_app;       -- no delete: drafts are discarded, not removed
grant select, insert on listings.draft_history to listings_app;        -- append only
grant usage on sequence listings.draft_history_id_seq to listings_app;

alter table listings.drafts enable row level security;
alter table listings.draft_history enable row level security;
create policy listings_app_access on listings.drafts for all to listings_app using (true) with check (true);
create policy listings_app_access on listings.draft_history for all to listings_app using (true) with check (true);

commit;

-- VERIFY (after running):
--   select has_table_privilege('anon','listings.drafts','select') a, has_table_privilege('authenticated','listings.drafts','select') b,
--          has_table_privilege('service_role','listings.drafts','select') c, has_table_privilege('listings_app','listings.drafts','delete') d;
--   -> all four false.
--   curl https://<project>.supabase.co/rest/v1/drafts -H "apikey: <anon>" -H "Accept-Profile: listings"
--   -> an error saying the schema is not exposed (the Data API must NOT serve it). If it returns rows or [], remove
--      `listings` from Settings > API > Exposed schemas.
--
-- SET THE PASSWORD (separate statement, choose a long random value, do not paste it anywhere else):
--   alter role listings_app with password '<generate one>';
-- Connection string for Vercel (transaction pooler, same host as the RFI system):
--   postgres://listings_app.<project-ref>:<password>@<pooler-host>:6543/postgres
--
-- ROLLBACK (deletes all drafts):
--   begin; drop schema listings cascade; drop role if exists listings_app; commit;
