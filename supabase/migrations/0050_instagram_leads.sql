-- Instagram DMs never carry a phone number — a lead sourced from one has to
-- be able to exist (unclaimed, then claimed) before anyone has a phone/email
-- for that family.
alter table parents alter column phone drop not null;

-- The raw external sender id (e.g. an Instagram IGSID) for inbound-captured
-- leads — used to recognize a returning contact so a reply doesn't create a
-- second application. Generic (not instagram-specific) so any future inbound
-- channel can reuse it. lead_source_other still carries the human-readable
-- handle for display.
alter table applications add column if not exists external_contact_id text;
create index if not exists idx_applications_external_contact_id
  on applications(external_contact_id) where external_contact_id is not null;

-- Atomic first-come-first-served claim for an unclaimed inbound lead,
-- mirroring claim_assessment_slot (0015/0016_*.sql) exactly.
create or replace function claim_lead(p_application uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app applications;
begin
  update applications
     set created_by = p_user, updated_at = now()
   where id = p_application
     and created_by is null
  returning * into v_app;

  if v_app.id is null then
    raise exception 'LEAD_UNAVAILABLE' using errcode = 'check_violation';
  end if;

  return jsonb_build_object('id', v_app.id, 'parent_id', v_app.parent_id);
end $$;
