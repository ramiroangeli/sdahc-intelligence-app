-- ROLLBACK for listings_0005_audit_log_and_reinstate.sql.
-- It DELETES the private audit trail, so it refuses to run while audit rows exist unless you confirm first, in the same session:
--     set listings.confirm_drop_audit = 'yes';
-- Export the rows first if you need them:  select * from listings.audit_log order by id;
-- It also refuses while any publication job of kind 'reinstate' exists (the old constraint would reject it). Draft data and other jobs are untouched.
begin;
do $$ begin
  if exists (select 1 from listings.publish_jobs where kind = 'reinstate') then
    raise exception 'rollback refused: reinstate jobs exist. They are history and cannot be removed by a rollback.';
  end if;
  if to_regclass('listings.audit_log') is not null
     and exists (select 1 from listings.audit_log)
     and coalesce(current_setting('listings.confirm_drop_audit', true), '') <> 'yes' then
    raise exception 'rollback refused: the audit log has rows. Export them, then run: set listings.confirm_drop_audit = ''yes''; and run this script again.';
  end if;
end $$;
-- the immutability triggers would refuse the drop's row removal only for DML; dropping the table is DDL, so remove the triggers first for clarity
drop trigger if exists audit_log_no_truncate on listings.audit_log;
drop trigger if exists audit_log_no_change on listings.audit_log;
drop trigger if exists audit_log_stamp on listings.audit_log;
drop table if exists listings.audit_log;
drop function if exists listings.audit_log_guard();

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'listings.publish_jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dry_run%' loop
    execute format('alter table listings.publish_jobs drop constraint %I', c.conname);
  end loop;
end $$;
alter table listings.publish_jobs add constraint publish_jobs_kind_check check (kind in ('dry_run', 'publish', 'update', 'withdraw'));
commit;
