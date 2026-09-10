-- ============================================================================
-- The admission link's 14-day expiry was set once at lead creation and never
-- refreshed — so an application that legitimately takes longer than 14 days
-- to move through scheduling/assessment/details (through no fault of the
-- parent) ends up with a dead link partway through, even while actively
-- progressing. Extend it by 14 days from now on every real status change,
-- so only a genuinely abandoned application (no progress at all) expires;
-- an actively-moving one never gets cut off mid-process.
-- ============================================================================
create or replace function extend_token_on_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.token_expires_at := now() + interval '14 days';
  end if;
  return new;
end $$;

drop trigger if exists trg_applications_extend_token on applications;
create trigger trg_applications_extend_token before update on applications
  for each row execute function extend_token_on_status_change();

-- One-time repair for applications already stuck mid-flow with an expired
-- link through this exact gap (progressed since creation, but the link died
-- before they could act on it).
update applications
   set token_expires_at = now() + interval '14 days'
 where token_expires_at < now()
   and status not in ('LEAD_CREATED', 'ENROLLED', 'REJECTED', 'ABANDONED');
