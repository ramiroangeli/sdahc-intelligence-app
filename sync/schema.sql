-- ============================================================================
-- SDAHC Intelligence — Database schema (estado actual, documentación)
-- Este archivo DESCRIBE la base tal como está. Es documentación reproducible,
-- no un log de cambios. NO re-ejecutar entero sobre una base que ya existe.
-- Capas:  raw = espejo de Notion · history = historial · analytics = capa app
-- ============================================================================


-- ============================================================
-- Esquema RAW — espejo fiel de Notion (dato crudo, sin transformar)
-- ============================================================
create schema if not exists raw;

-- ---- raw.deals (base "Deals" de Notion) ----
create table raw.deals (
  notion_page_id        text primary key,          -- ID único de Notion, nunca cambia
  last_edited_time      timestamptz,               -- para sync incremental
  created_time          timestamptz,               -- fecha de creación en Notion
  synced_at             timestamptz default now(), -- última vez que lo trajimos
  is_archived           boolean default false,     -- soft-delete si desaparece de Notion

  name                  text,
  stage                 text,                       -- select "Stage"
  outcome               text,                       -- Won / Lost / In Progress / Paused
  deal_type             text[],                     -- multi-select "Deal Type"
  entity                text,                       -- SDA Home Choices / 3DSDA
  owner                 text,                       -- "Assigned To" (people)
  source                text,                       -- (reservado; no hay campo hoy en Notion)
  transaction_value     numeric,                    -- "Sale Price"
  commission_pct        numeric,                    -- "Comission" (sic) en Notion
  advisory_fee          numeric,                    -- "Consultancy Fee (Total)"
  tranche1_amount       numeric,                    -- "Tranche 1 (consultancy)"
  tranche1_status       text,                       -- "T1 status": Not started / WIP / Invoiced / Paid
  tranche2_amount       numeric,                    -- "Tranche 2 (consultancy)"
  tranche2_status       text,                       -- "T2 status"
  probability           numeric,                    -- la pone Steve, por-deal
  score                 numeric,                    -- valor calculado de la fórmula Notion
  close_date            date,
  next_action           text,                       -- "Next action" (rich_text)
  next_action_date      date,                       -- "Next action date"
  days_stale            numeric,                    -- fórmula "Days Stale"
  pipeline_status       text,                       -- fórmula "Pipeline Status"
  deal_value_calculated numeric,                    -- fórmula "Deal Value (calculated)"

  raw_data              jsonb                       -- red de seguridad: JSON completo de Notion
);
create index idx_deals_last_edited on raw.deals (last_edited_time);
alter table raw.deals enable row level security;

-- ---- raw.contacts (base "Contacts" de Notion) ----
create table raw.contacts (
  notion_page_id       text primary key,
  last_edited_time     timestamptz,
  created_time         timestamptz,
  synced_at            timestamptz default now(),
  is_archived          boolean default false,

  name                 text,                        -- title "Name"
  email                text,                        -- "Email"
  phone                text,                        -- "Phone Number"
  relationship_status  text,                        -- "Relationship Status" (select)
  contact_type         text[],                      -- "Contact Type" (multi-select)
  source               text[],                      -- "Source" (multi-select)
  state                text,                        -- "State" (select)
  business_origin      text,                        -- "Business Origin" (select)
  non_active           boolean,                     -- "Non-active" (checkbox)
  rel_deals            text[],                      -- ids de la relation "Deals"
  rel_group            text[],                      -- ids de la relation "Group"
  rel_tasks            text[],                      -- ids de la relation "Tasks"
  -- NOTA: "Last Touchpointa" es un last_edited_time, no fecha real de contacto — no se mapea.
  -- NOTA: relaciones "| ABS" (otro negocio) no se mapean — quedan en raw_data.

  raw_data             jsonb
);
create index idx_contacts_last_edited on raw.contacts (last_edited_time);
alter table raw.contacts enable row level security;

-- ---- raw.tasks (base "Tasks" de Notion) ----
create table raw.tasks (
  notion_page_id     text primary key,
  last_edited_time   timestamptz,
  created_time       timestamptz,
  synced_at          timestamptz default now(),
  is_archived        boolean default false,

  name               text,                          -- title "Task Name " (espacio al final en Notion)
  status             text,                          -- "Status" (type status → .status.name)
  priority           text,                          -- "Priority" (select)
  task_type          text,                          -- "Task Type" (select)
  due_date           date,                          -- "Due Date"
  completed_date     date,                          -- "Completed Date"
  assigned_to        text,                          -- "Assigned To" (people, nombres por coma)
  auto_generated     boolean,                       -- "Auto-Generated" (checkbox)
  rel_deals          text[],                        -- ids de la relation "Deals"
  rel_contacts       text[],                        -- ids de la relation "Contacts"
  rel_groups         text[],                        -- ids de la relation "Groups"
  -- NOTA: relation "Deals | ABS" no se mapea — queda en raw_data.

  raw_data           jsonb
);
create index idx_tasks_last_edited on raw.tasks (last_edited_time);
alter table raw.tasks enable row level security;

-- ---- raw.groups (base "Groups"/"Investors" de Notion) ----
-- OJO: Groups se sincroniza desde /v1/data_sources/{id}/query (Notion-Version
-- 2025-09-03), no /v1/databases/{id}/query como las otras tres.
create table raw.groups (
  notion_page_id     text primary key,
  last_edited_time   timestamptz,
  created_time       timestamptz,
  synced_at          timestamptz default now(),
  is_archived        boolean default false,

  name               text,                          -- title "Name"
  status             text,                          -- "Status" (select)
  source             text,                          -- "Source" (select)
  classification     text[],                        -- "Classification" (multi-select)
  business_origin    text,                          -- "Business Origin" (select)
  rel_contacts       text[],                        -- ids de la relation "Contacts"
  rel_deals          text[],                        -- ids de la relation "Deals"
  rel_tasks          text[],                        -- ids de la relation "Tasks"
  rel_states         text[],                        -- ids de la relation "States/Territories"
  -- NOTA: relation "Deals | ABS" no se mapea — queda en raw_data.

  raw_data           jsonb
);
create index idx_groups_last_edited on raw.groups (last_edited_time);
alter table raw.groups enable row level security;

-- ---- Permisos del esquema raw (solo service_role; incluye tablas futuras) ----
grant usage on schema raw to service_role;
grant all privileges on all tables in schema raw to service_role;
alter default privileges in schema raw grant all on tables to service_role;


-- ============================================================
-- Esquema HISTORY — el historial que Notion no guarda
-- ============================================================
create schema if not exists history;

-- Foto diaria de cada deal (se acumula, nunca se actualiza)
create table history.deal_snapshots (
  id                bigint generated always as identity primary key,
  notion_page_id    text not null,
  snapshot_date     date not null,
  stage             text,
  outcome           text,
  transaction_value numeric,
  advisory_fee      numeric,
  probability       numeric,
  sdahc_revenue     numeric,
  captured_at       timestamptz default now(),
  unique (notion_page_id, snapshot_date)            -- una foto por deal por día
);

-- Log de cambios de stage (detectados comparando fotos)
create table history.deal_stage_events (
  id                bigint generated always as identity primary key,
  notion_page_id    text not null,
  from_stage        text,                            -- null si es el primero
  to_stage          text,
  changed_at        date not null,
  detected_at       timestamptz default now()
);

-- Log de cambios de outcome (In Progress/Won/Lost/Paused), detectados
-- comparando fotos exactamente igual que deal_stage_events arriba.
create table history.deal_outcome_events (
  id                bigint generated always as identity primary key,
  notion_page_id    text not null,
  from_outcome      text,                            -- null si es el primero
  to_outcome        text,
  changed_at        date not null,
  detected_at       timestamptz default now()
);

create index idx_snapshots_deal on history.deal_snapshots (notion_page_id);
create index idx_stage_events_deal on history.deal_stage_events (notion_page_id);
create index idx_outcome_events_deal on history.deal_outcome_events (notion_page_id);

alter table history.deal_snapshots enable row level security;
alter table history.deal_stage_events enable row level security;
alter table history.deal_outcome_events enable row level security;

grant usage on schema history to service_role;
grant all privileges on all tables in schema history to service_role;
alter default privileges in schema history grant all on tables to service_role;


-- ============================================================
-- Esquema ANALYTICS — dato transformado listo para la app
-- La app lo lee con la clave anon (solo lectura). Nunca toca raw.
-- ============================================================
create schema if not exists analytics;

create or replace view analytics.deals as
select
  d.notion_page_id,
  d.name,
  d.stage,
  d.outcome,
  d.deal_type,
  d.entity,
  d.owner,
  d.probability,
  d.score,
  d.close_date,
  d.next_action,
  d.next_action_date,
  d.days_stale,
  d.pipeline_status,

  -- Valores base (coalesce → null se trata como 0)
  coalesce(d.transaction_value, 0)                              as transaction_value,
  coalesce(d.commission_pct, 0)                                 as commission_pct,
  coalesce(d.advisory_fee, 0)                                   as advisory_fee,

  -- SDAHC revenue = comisión de brokerage + fee de advisory
  (coalesce(d.transaction_value,0) * coalesce(d.commission_pct,0))
    + coalesce(d.advisory_fee,0)                                as sdahc_revenue,

  -- Weighted = sdahc_revenue × probabilidad
  ((coalesce(d.transaction_value,0) * coalesce(d.commission_pct,0))
    + coalesce(d.advisory_fee,0)) * coalesce(d.probability,0)   as weighted_revenue,

  -- Tramos de advisory
  coalesce(d.tranche1_amount, 0)                                as tranche1_amount,
  d.tranche1_status,
  coalesce(d.tranche2_amount, 0)                                as tranche2_amount,
  d.tranche2_status,

  -- SETTLED de advisory = tramos "Paid" (dinero en la cuenta)
  (case when d.tranche1_status = 'Paid' then coalesce(d.tranche1_amount,0) else 0 end)
  + (case when d.tranche2_status = 'Paid' then coalesce(d.tranche2_amount,0) else 0 end)
                                                               as advisory_settled,

  -- CONTRACTED de advisory = tramos "WIP" o "Invoiced" (comprometido, no cobrado)
  (case when d.tranche1_status in ('WIP','Invoiced') then coalesce(d.tranche1_amount,0) else 0 end)
  + (case when d.tranche2_status in ('WIP','Invoiced') then coalesce(d.tranche2_amount,0) else 0 end)
                                                               as advisory_contracted,

  -- Banderas para filtrar en la app
  (d.outcome = 'Paused')                                        as is_paused,
  (d.outcome = 'Won')                                           as is_won,
  (d.outcome = 'Lost')                                          as is_lost,
  (d.outcome not in ('Paused','Lost') or d.outcome is null)     as is_active,

  d.created_time                                               as created_time

from raw.deals d
where d.is_archived = false;

-- Permisos: service_role (todo) y anon (solo lectura, para la app)
grant usage  on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
alter default privileges in schema analytics grant select on tables to service_role;

grant usage  on schema analytics to anon;
grant select on analytics.deals to anon;
alter default privileges in schema analytics grant select on tables to anon;