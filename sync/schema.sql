-- Crea el esquema "raw" (el espejo fiel de Notion)
create schema if not exists raw;

-- Tabla espejo de la base Deals de Notion
create table raw.deals (
  -- Claves del sync
  notion_page_id     text primary key,          -- ID único de Notion, nunca cambia
  last_edited_time   timestamptz,               -- para sync incremental
  synced_at          timestamptz default now(), -- cuándo lo trajimos por última vez
  is_archived        boolean default false,     -- soft-delete si desaparece de Notion

  -- Campos mapeados de Notion (los que ya definimos con Steve)
  name               text,
  stage              text,                       -- el select de Stage
  outcome            text,                       -- Won / Lost / In Progress / Paused
  deal_type          text[],                     -- multi-select (varios valores)
  entity             text,                       -- SDA Home Choices / 3DSDA
  owner              text,
  source             text,
  transaction_value  numeric,                    -- Sale Price
  commission_pct     numeric,                    -- "Comission" (sic) en Notion
  advisory_fee       numeric,                    -- Consultancy Fee (Total)
  tranche1_amount    numeric,
  tranche1_status    text,                       -- Not started / WIP / Invoiced / Paid
  tranche2_amount    numeric,
  tranche2_status    text,
  probability        numeric,                    -- la pone Steve, por-deal
  score              numeric,                    -- valor calculado de la fórmula Notion
  close_date         date,
  next_action        text,
  days_stale         numeric,

  -- Red de seguridad: el JSON completo de Notion, tal cual
  raw_data           jsonb
);

-- Índice para buscar rápido por fecha de edición (acelera el sync incremental)
create index idx_deals_last_edited on raw.deals (last_edited_time);

-- Seguridad: activa RLS y NO crea políticas públicas.
-- La tabla queda cerrada a las claves anon/authenticated.
-- Solo el backend (service_role, que ignora RLS) puede leer/escribir.
alter table raw.deals enable row level security;

alter table raw.deals add column if not exists next_action_date date;
alter table raw.deals add column if not exists pipeline_status text;
alter table raw.deals add column if not exists deal_value_calculated numeric;

-- Dar permiso al rol de servicio (el que usa el sync) sobre el esquema raw
grant usage on schema raw to service_role;
grant all privileges on all tables in schema raw to service_role;

-- Y que los permisos se apliquen también a tablas futuras de raw
alter default privileges in schema raw grant all on tables to service_role;


-- ============================================================
-- Esquema "history" — el historial que Notion no guarda
-- ============================================================
create schema if not exists history;

-- Foto diaria de cada deal (se acumula, nunca se actualiza)
create table history.deal_snapshots (
  id               bigint generated always as identity primary key,
  notion_page_id   text not null,              -- qué deal
  snapshot_date    date not null,              -- de qué día es la foto
  stage            text,
  outcome          text,
  transaction_value numeric,
  advisory_fee     numeric,
  probability      numeric,
  sdahc_revenue    numeric,                    -- lo calcularemos al tomar la foto
  captured_at      timestamptz default now(),
  -- una sola foto por deal por día (evita duplicados si el sync corre 2 veces)
  unique (notion_page_id, snapshot_date)
);

-- Log de cambios de stage (se detectan comparando fotos)
create table history.deal_stage_events (
  id               bigint generated always as identity primary key,
  notion_page_id   text not null,              -- qué deal
  from_stage       text,                       -- de dónde venía (null si es el primero)
  to_stage         text,                       -- a dónde pasó
  changed_at       date not null,              -- cuándo lo detectamos
  detected_at      timestamptz default now()
);

-- Índices para consultar rápido por deal
create index idx_snapshots_deal on history.deal_snapshots (notion_page_id);
create index idx_stage_events_deal on history.deal_stage_events (notion_page_id);

-- Seguridad: RLS activado, sin políticas públicas
alter table history.deal_snapshots enable row level security;
alter table history.deal_stage_events enable row level security;

-- Permisos para el sync (solo service_role), incl. tablas futuras del esquema
grant usage on schema history to service_role;
grant all privileges on all tables in schema history to service_role;
alter default privileges in schema history grant all on tables to service_role;


-- ============================================================
-- Tabla espejo de la base Contacts de Notion
-- ============================================================
create table raw.contacts (
  -- Claves del sync
  notion_page_id       text primary key,
  last_edited_time     timestamptz,
  synced_at            timestamptz default now(),
  is_archived          boolean default false,

  -- Campos mapeados de Notion
  name                 text,                       -- title "Name"
  email                text,                       -- "Email" (type email)
  phone                text,                       -- "Phone Number" (type phone_number)
  relationship_status  text,                       -- "Relationship Status" (select)
  contact_type         text[],                     -- "Contact Type" (multi-select)
  source               text[],                     -- "Source" (multi-select)
  state                text,                       -- "State" (select)
  business_origin      text,                       -- "Business Origin" (select)
  non_active           boolean,                    -- "Non-active" (checkbox)
  rel_deals            text[],                     -- ids de la relation "Deals"
  rel_group            text[],                     -- ids de la relation "Group"
  rel_tasks            text[],                     -- ids de la relation "Tasks"
  -- NOTA: "Last Touchpointa" es un last_edited_time de Notion, no una fecha real
  -- de último contacto — a propósito no se mapea a ninguna columna.
  -- NOTA: las relaciones "| ABS" (otro negocio) tampoco se mapean — quedan en raw_data.

  -- Red de seguridad: el JSON completo de Notion, tal cual
  raw_data             jsonb
);

create index idx_contacts_last_edited on raw.contacts (last_edited_time);

alter table raw.contacts enable row level security;

grant usage on schema raw to service_role;
grant all privileges on all tables in schema raw to service_role;


-- ============================================================
-- Tabla espejo de la base Tasks de Notion
-- ============================================================
create table raw.tasks (
  -- Claves del sync
  notion_page_id     text primary key,
  last_edited_time   timestamptz,
  synced_at          timestamptz default now(),
  is_archived        boolean default false,

  -- Campos mapeados de Notion
  name               text,                         -- title "Task Name " (OJO: espacio al final en Notion)
  status             text,                         -- "Status" (type status → .status.name, NO .select)
  priority           text,                         -- "Priority" (select)
  task_type          text,                         -- "Task Type" (select)
  due_date           date,                         -- "Due Date"
  completed_date     date,                         -- "Completed Date"
  assigned_to        text,                         -- "Assigned To" (people, nombres unidos por coma)
  auto_generated     boolean,                      -- "Auto-Generated" (checkbox)
  rel_deals          text[],                       -- ids de la relation "Deals"
  rel_contacts       text[],                       -- ids de la relation "Contacts"
  rel_groups         text[],                       -- ids de la relation "Groups"
  -- NOTA: la relation "Deals | ABS" (otro negocio) no se mapea — queda en raw_data.

  -- Red de seguridad: el JSON completo de Notion, tal cual
  raw_data           jsonb
);

create index idx_tasks_last_edited on raw.tasks (last_edited_time);

alter table raw.tasks enable row level security;

grant usage on schema raw to service_role;
grant all privileges on all tables in schema raw to service_role;


-- ============================================================
-- Tabla espejo de la base Groups de Notion
-- OJO: Groups se sincroniza desde el endpoint /v1/data_sources/{id}/query
-- (Notion-Version 2025-09-03), no /v1/databases/{id}/query como las otras tres.
-- ============================================================
create table raw.groups (
  -- Claves del sync
  notion_page_id     text primary key,
  last_edited_time   timestamptz,
  synced_at          timestamptz default now(),
  is_archived        boolean default false,

  -- Campos mapeados de Notion
  name               text,                         -- title "Name"
  status             text,                         -- "Status" (select)
  source             text,                         -- "Source" (select)
  classification     text[],                       -- "Classification" (multi-select)
  business_origin    text,                         -- "Business Origin" (select)
  rel_contacts       text[],                       -- ids de la relation "Contacts"
  rel_deals          text[],                       -- ids de la relation "Deals"
  rel_tasks          text[],                       -- ids de la relation "Tasks"
  rel_states         text[],                       -- ids de la relation "States/Territories"
  -- NOTA: la relation "Deals | ABS" (otro negocio) no se mapea — queda en raw_data.

  -- Red de seguridad: el JSON completo de Notion, tal cual
  raw_data           jsonb
);

create index idx_groups_last_edited on raw.groups (last_edited_time);

alter table raw.groups enable row level security;

grant usage on schema raw to service_role;
grant all privileges on all tables in schema raw to service_role;

-- ============================================================
-- Esquema "analytics" — dato transformado listo para la app
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

  -- Valores base
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

  -- Advisory SETTLED = tramos en estado "Paid" (dinero en la cuenta)
  (case when d.tranche1_status = 'Paid' then coalesce(d.tranche1_amount,0) else 0 end)
  + (case when d.tranche2_status = 'Paid' then coalesce(d.tranche2_amount,0) else 0 end)
                                                               as advisory_settled,

  -- Advisory CONTRACTED = tramos en "WIP" o "Invoiced" (comprometido, no cobrado)
  (case when d.tranche1_status in ('WIP','Invoiced') then coalesce(d.tranche1_amount,0) else 0 end)
  + (case when d.tranche2_status in ('WIP','Invoiced') then coalesce(d.tranche2_amount,0) else 0 end)
                                                               as advisory_contracted,

  -- Banderas útiles para filtrar en la app
  (d.outcome = 'Paused')                                        as is_paused,
  (d.outcome = 'Won')                                           as is_won,
  (d.outcome = 'Lost')                                          as is_lost,
  (d.outcome not in ('Paused','Lost') or d.outcome is null)     as is_active

from raw.deals d
where d.is_archived = false;

-- Permisos: por ahora solo el service_role (la app la añadimos en el paso 2)
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
alter default privileges in schema analytics grant select on tables to service_role;