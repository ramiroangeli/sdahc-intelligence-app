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