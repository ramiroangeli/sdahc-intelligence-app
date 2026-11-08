-- ROLLBACK for listings_0003_photo_review.sql. Removes only the gallery review column from listings.drafts.
-- Drafts, photos, notes, verification and history are untouched.
begin;
alter table listings.drafts drop constraint if exists drafts_photo_review_is_object;
alter table listings.drafts drop column if exists photo_review;
commit;
