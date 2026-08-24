-- Track how a slot got its teacher: admin-assigned at creation time vs a
-- teacher self-claiming it from the open pool. Powers the admin "which
-- teacher claimed which slot" report.
alter table assessment_slots
  add column if not exists claimed_by_teacher boolean not null default false;

create or replace function claim_assessment_slot(p_slot uuid, p_teacher uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot assessment_slots;
begin
  update assessment_slots
     set teacher_id = p_teacher, claimed_by_teacher = true, updated_at = now()
   where id = p_slot
     and teacher_id is null
     and application_id is null
     and is_open = true
     and starts_at > now()
  returning * into v_slot;

  if v_slot.id is null then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at,
    'ends_at', v_slot.ends_at
  );
end $$;
