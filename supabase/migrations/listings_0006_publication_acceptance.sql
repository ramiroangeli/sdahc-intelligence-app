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

commit;
