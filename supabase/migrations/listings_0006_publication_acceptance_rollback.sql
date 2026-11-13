-- Rollback is refused if acceptance evidence exists; retain records under the applicable retention policy.
begin;
do $$ begin
  if exists (select 1 from listings.audit_log where action = 'publication_acceptance') then
    raise exception 'Cannot roll back while publication acceptance records exist';
  end if;
end $$;
drop trigger if exists publish_job_acceptance_guard on listings.publish_jobs;
drop function if exists listings.guard_accepted_publication_job();
drop trigger if exists audit_acceptance_job on listings.audit_log;
drop function if exists listings.check_publication_acceptance_job();
alter table listings.audit_log drop constraint if exists audit_publication_acceptance_details;
alter table listings.audit_log drop constraint if exists audit_log_action_check;
alter table listings.audit_log add constraint audit_log_action_check check (action in ('status_change', 'withdraw', 'reinstate'));
commit;
