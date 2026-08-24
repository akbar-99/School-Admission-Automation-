-- Open (unassigned) assessment slots: an admin can publish a slot without
-- pre-picking a teacher, and any teacher can claim it from the pool. Claiming
-- is atomic, mirroring the parent-facing book_assessment_slot RPC — first
-- teacher to claim wins, no double-assignment (SRS FR-13 pattern).

alter table assessment_slots
  alter column teacher_id drop not null;

-- Fast lookup of the unclaimed pool shown on the teacher dashboard.
create index if not exists idx_slots_unassigned
  on assessment_slots(starts_at)
  where teacher_id is null and application_id is null and is_open = true;

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
     set teacher_id = p_teacher, updated_at = now()
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
