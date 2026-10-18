-- ============================================================================
-- Mirror of 0071, for the opposite direction: an admin corrects a grade FROM
-- one that needed an assessment TO "KG 1" (the one grade exempt from it) —
-- confirmed live: "Eliana" applied for STAGE 1, booked and missed an
-- assessment slot, then was corrected to KG 1. The slot stayed linked to her
-- application (still showing a stale "Missed" row in Admin → Assessments,
-- for an assessment she no longer needs at all), and her status stayed
-- ASSESSMENT_SCHEDULED — a status the parent-facing UI has nothing useful to
-- show for once the grade no longer needs an assessment, so she'd be stuck
-- there with no way forward either.
--
-- Releases any linked assessment slot exactly like admin_release_missed_slot
-- (0064) does, then moves status to DETAILS_PENDING — the same destination a
-- fresh KG 1 submission reaches immediately (handleFormSubmitted's "no
-- assessment" branch). Only handles the two states where nothing is stuck
-- yet in a way worth touching: FORM_SUBMITTED (no slot booked) and
-- ASSESSMENT_SCHEDULED (slot booked, possibly missed). Deliberately leaves
-- every other status alone — ASSESSMENT_COMPLETED onward already has a real
-- recorded result or has already moved forward on its own, so there's
-- nothing stuck to unstick, and silently discarding a real assessment
-- outcome just because the grade later changed is a judgment call for a
-- human, not this function.
-- ============================================================================
create or replace function admin_correct_grade_no_longer_needs_assessment(p_application uuid, p_grade text)
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
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;
  if v_app.status not in ('FORM_SUBMITTED', 'ASSESSMENT_SCHEDULED') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;

  if v_app.status = 'ASSESSMENT_SCHEDULED' then
    select * into v_slot from assessment_slots where application_id = p_application for update;
    if v_slot.id is not null then
      update assessment_slots
         set application_id = null,
             is_open = true,
             confirmed_at = null,
             reminder_sent = false,
             reminder_2h_sent = false,
             updated_at = now()
       where id = v_slot.id;
    end if;
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications
     set grade_applying = p_grade,
         status = 'DETAILS_PENDING'
   where id = p_application;

  return jsonb_build_object(
    'status', 'OK',
    'previous_status', v_app.status,
    'slot_released', v_slot.id is not null
  );
end $$;
