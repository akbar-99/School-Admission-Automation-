-- ============================================================================
-- Recovery for a teacher mis-selecting the application when submitting an
-- assessment result (confirmed live: a result meant for one applicant was
-- submitted against a different applicant's record, which auto-advanced that
-- applicant's status via handleAssessmentResult). Once the misfiled
-- assessment_results row has been moved off this application onto the
-- correct one, this puts the wrongly-advanced application back to
-- ASSESSMENT_SCHEDULED so its real assessment can be submitted normally
-- through the teacher portal.
--
-- DETAILS_PENDING/ASSESSMENT_COMPLETED -> ASSESSMENT_SCHEDULED has no
-- forward path in enforce_status_transition (0061) — it falls to the
-- `else false` branch — so this needs the same app.bypass_status_check
-- escape hatch every other legitimate out-of-order transition already uses
-- (admin_grant_retest, admin_release_missed_slot, etc.).
--
-- Guarded on no assessment_results row remaining for this application, so
-- this can't be used to silently discard a result that actually belongs
-- here.
-- ============================================================================
create or replace function admin_undo_misfiled_assessment(p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app applications;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_app.status not in ('ASSESSMENT_COMPLETED', 'DETAILS_PENDING') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;
  if exists (select 1 from assessment_results where application_id = p_application) then
    return jsonb_build_object('status', 'STILL_HAS_RESULT');
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'ASSESSMENT_SCHEDULED' where id = p_application;

  return jsonb_build_object('status', 'OK');
end $$;
