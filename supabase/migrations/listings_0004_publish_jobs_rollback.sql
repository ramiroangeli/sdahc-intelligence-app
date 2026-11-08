-- ROLLBACK for listings_0004_publish_jobs.sql. Deletes the publication job history. Draft data is untouched.
begin;
drop table if exists listings.publish_jobs;
commit;
