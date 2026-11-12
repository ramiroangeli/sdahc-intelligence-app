-- PROPOSED, NOT APPLIED. Extend the private append-only audit trail for publication acceptance.
-- No public grants, tables or production data are changed by this file. Apply only with the coordinated release.
begin;

alter table listings.audit_log drop constraint if exists audit_log_action_check;
alter table listings.audit_log add constraint audit_log_action_check
  check (action in ('status_change', 'withdraw', 'reinstate', 'publication_acceptance'));

alter table listings.audit_log drop constraint if exists audit_publication_acceptance_details;
alter table listings.audit_log add constraint audit_publication_acceptance_details check (
  action <> 'publication_acceptance' or (
    job_id is not null and draft_version is not null and actor_auth_user is not null
    and coalesce(detail->'accepted' = 'true'::jsonb, false)
    and coalesce(detail->>'content_hash', '') ~ '^[a-f0-9]{64}$'
    and coalesce(detail->>'terms_version', '') ~ '^[a-zA-Z0-9._-]{1,80}$'
  )
);

-- The acceptance must identify the same frozen job and verified publisher, not merely an arbitrary job UUID.
create or replace function listings.check_publication_acceptance_job() returns trigger language plpgsql as $fn$
begin
  if new.action = 'publication_acceptance' and not exists (
    select 1 from listings.publish_jobs j
    where j.id = new.job_id and j.public_id = new.public_id and j.draft_version = new.draft_version
      and j.requested_by = new.actor_email and j.requested_by_auth_user = new.actor_auth_user
      and j.payload_hash = new.detail->>'content_hash' and j.kind in ('publish', 'update', 'dry_run')
      and j.status = 'queued'
  ) then
    raise exception 'publication acceptance does not match its queued job' using errcode = '23514';
  end if;
  return new;
end
$fn$;
drop trigger if exists audit_acceptance_job on listings.audit_log;
create trigger audit_acceptance_job before insert on listings.audit_log for each row execute function listings.check_publication_acceptance_job();

commit;
