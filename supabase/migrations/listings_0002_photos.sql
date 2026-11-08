-- PROPOSED, NOT APPLIED. Run by hand in the Supabase SQL editor AFTER listings_0001_drafts.sql and BEFORE deploying the
-- Photos release. Touches only the `listings` schema: adds one column to listings.drafts. No new role, table or grant.
-- raw, history, analytics, public and rfi are not touched.
--
-- `photos` holds the private staging gallery of a draft: order, cover flag, floorplan flag, alt text, privacy review and the
-- opaque Blob file names of the processed WebP variants. No image bytes, no original file names, no EXIF.
-- Existing grants (select/insert/update on listings.drafts for listings_app only) and RLS already cover the new column.

begin;

alter table listings.drafts add column if not exists photos jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drafts_photos_is_array' and conrelid = 'listings.drafts'::regclass) then
    alter table listings.drafts add constraint drafts_photos_is_array check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 24);
  end if;
end $$;

commit;

-- VERIFY (after running):
--   select column_name, data_type, is_nullable from information_schema.columns where table_schema='listings' and table_name='drafts' and column_name='photos';
--   -> one row: photos, jsonb, NO
--   select has_table_privilege('anon','listings.drafts','select') a, has_table_privilege('authenticated','listings.drafts','select') b,
--          has_table_privilege('service_role','listings.drafts','select') c, has_table_privilege('listings_app','listings.drafts','delete') d;
--   -> all four false.
-- ROLLBACK: listings_0002_photos_rollback.sql (separate file).
