-- PROPOSED, NOT APPLIED. Run by hand in the Supabase SQL editor AFTER listings_0002_photos.sql and BEFORE deploying the
-- Photo UX release. Touches only the `listings` schema: adds one nullable column to listings.drafts. No new role, table or grant.
-- raw, history, analytics, public and rfi are not touched.
--
-- `photo_review` holds the single gallery-level review: who inspected the whole gallery, when, and which image ids they saw.
-- NULL means "not reviewed". The application clears it whenever an image is added, replaced or removed.
-- Existing grants (select/insert/update on listings.drafts for listings_app only) and RLS already cover the new column.

begin;

alter table listings.drafts add column if not exists photo_review jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'drafts_photo_review_is_object' and conrelid = 'listings.drafts'::regclass) then
    alter table listings.drafts add constraint drafts_photo_review_is_object check (photo_review is null or jsonb_typeof(photo_review) = 'object');
  end if;
end $$;

commit;

-- VERIFY (after running):
--   select column_name, data_type, is_nullable from information_schema.columns where table_schema='listings' and table_name='drafts' and column_name='photo_review';
--   -> one row: photo_review, jsonb, YES
--   select has_table_privilege('anon','listings.drafts','select') a, has_table_privilege('authenticated','listings.drafts','select') b,
--          has_table_privilege('service_role','listings.drafts','select') c, has_table_privilege('listings_app','listings.drafts','delete') d;
--   -> all four false.
-- ROLLBACK: listings_0003_photo_review_rollback.sql (separate file).
