-- ============================================================================
-- Admin-side equivalent of release_assessment_slot (0036), for handling a
-- no-show: a parent booked and confirmed, but didn't attend, and the slot's
-- own start time has now passed. The parent-facing release (used by the
-- "Need to reschedule?" button on their portal) explicitly blocks once
-- starts_at <= now() — that guard exists to stop a parent backing out at or
-- after their own assessment time, which is the opposite of what's needed
-- here: an admin resolving a missed assessment needs exactly the ability to
-- release it *because* time has already passed. Never exposed to the
-- parent-facing /apply flow — only called from an admin-gated server
-- action (src/app/admin/actions.ts).
--
-- Guards on the application still being ASSESSMENT_SCHEDULED (not, say,
-- already ASSESSMENT_COMPLETED with a real result recorded) — the slot row
-- itself stays linked to the application even after a result is submitted
-- (src/app/teacher/actions.ts reads it to resolve teacher_id), so without
-- this check an admin could accidentally wipe out a completed assessment.
-- ============================================================================
create or replace function admin_release_missed_slot(p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app  applications;
  v_slot assessment_slots;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_app.status <> 'ASSESSMENT_SCHEDULED' then
    return jsonb_build_object('status', 'NOT_SCHEDULED', 'current_status', v_app.status);
  end if;

  select * into v_slot from assessment_slots where application_id = p_application for update;
  if v_slot.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  update assessment_slots
     set application_id = null,
         is_open = true,
         confirmed_at = null,
         reminder_sent = false,
         reminder_2h_sent = false,
         updated_at = now()
   where id = v_slot.id;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'FORM_SUBMITTED' where id = p_application;

  return jsonb_build_object(
    'status', 'RELEASED',
    'slot_id', v_slot.id,
    'teacher_id', v_slot.teacher_id,
    'starts_at', v_slot.starts_at
  );
end $$;
