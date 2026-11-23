-- ============================================================================
-- 0086 — small follow-up to 0085.
--
-- 1. start_class_change: report "a change is already in progress"
--    (CHANGE_OPEN) before the stage check. While a change is open the
--    application sits at FORM_SUBMITTED, so a second request used to come
--    back as INVALID_STATUS — still refused, but with the wrong reason.
--    Otherwise identical to 0085. CREATE OR REPLACE keeps 0085's grants
--    (server only).
-- 2. set_updated_at: re-apply the search_path hardening from 0039. Any
--    CREATE OR REPLACE of this function (e.g. re-running 0001) silently
--    drops it; re-applying is harmless if it's still there.
-- ============================================================================

create or replace function start_class_change(
  p_application      uuid,
  p_to_grade         text,
  p_to_curriculum    text,
  p_kind             text,
  p_needs_assessment boolean,
  p_reason           text,
  p_actor            uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app         applications;
  v_student_cur text;
  v_result      assessment_results;
  v_slot_id     uuid;
  v_change_id   uuid;
  v_target      app_status;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  -- Checked first: while a change is open the status is FORM_SUBMITTED, and
  -- the stage check below would otherwise answer INVALID_STATUS instead.
  if exists (select 1 from application_class_changes
              where application_id = p_application and status = 'awaiting_assessment') then
    return jsonb_build_object('status', 'CHANGE_OPEN');
  end if;
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;
  if v_app.status not in ('DETAILS_PENDING', 'AGREEMENT_SENT', 'REJECTED') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;
  if exists (select 1 from payments where application_id = p_application) then
    return jsonb_build_object('status', 'PAYMENT_STARTED');
  end if;
  if coalesce(trim(p_to_grade), '') = '' then
    return jsonb_build_object('status', 'BAD_GRADE');
  end if;

  if v_app.student_id is not null then
    select curriculum into v_student_cur from students where id = v_app.student_id;
  end if;
  if p_to_grade = v_app.grade_applying
     and p_to_curriculum is not distinct from coalesce(v_student_cur, v_app.preferred_curriculum) then
    return jsonb_build_object('status', 'NO_CHANGE');
  end if;

  select * into v_result from assessment_results where application_id = p_application for update;
  select id into v_slot_id from assessment_slots where application_id = p_application;

  insert into application_class_changes (
    application_id, kind, from_grade, from_category, from_preferred_curriculum,
    from_student_curriculum, from_status, to_grade, to_curriculum, needs_assessment,
    status, old_result, old_slot_id, reason, requested_by
  ) values (
    p_application, p_kind, v_app.grade_applying, v_app.category, v_app.preferred_curriculum,
    v_student_cur, v_app.status, p_to_grade, p_to_curriculum, p_needs_assessment,
    'awaiting_assessment',
    case when v_result.id is null then null else to_jsonb(v_result) end,
    v_slot_id, nullif(trim(p_reason), ''), p_actor
  ) returning id into v_change_id;

  delete from assessment_results where application_id = p_application;
  update assessment_slots set application_id = null where application_id = p_application;

  if v_app.student_id is not null and p_to_curriculum is not null then
    update students set curriculum = p_to_curriculum where id = v_app.student_id;
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications
     set grade_applying = p_to_grade,
         category = (case when p_to_grade ~* 'kg' then 'KG' else 'GRADE' end)::category_type,
         preferred_curriculum = coalesce(p_to_curriculum, preferred_curriculum),
         status = 'FORM_SUBMITTED'
   where id = p_application;

  if not p_needs_assessment then
    v_target := class_change_land(v_change_id, p_actor);
    return jsonb_build_object('status', 'APPLIED', 'change_id', v_change_id, 'target_status', v_target);
  end if;

  return jsonb_build_object('status', 'STARTED', 'change_id', v_change_id);
end $$;

alter function set_updated_at() set search_path = public;
