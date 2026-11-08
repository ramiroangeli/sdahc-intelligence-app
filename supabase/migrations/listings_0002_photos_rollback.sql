-- ROLLBACK for listings_0002_photos.sql. Removes only the gallery metadata column from listings.drafts.
-- Drafts, notes, verification and history are untouched. It does NOT delete image files: remove the private Blob
-- prefix `listings-staging/` separately if the staged photographs should go too.
begin;
alter table listings.drafts drop constraint if exists drafts_photos_is_array;
alter table listings.drafts drop column if exists photos;
commit;
