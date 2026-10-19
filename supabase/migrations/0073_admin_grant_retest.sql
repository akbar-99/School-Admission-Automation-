-- ============================================================================
-- A failed assessment always rejects an applicant outright (handleAssessmentResult,
-- src/lib/workflow.ts) — there's no path today for a teacher's "please retest"
-- remark to actually lead to a retest. Confirmed live: a teacher recorded
-- FAIL with "The student feels panicked. So I suggest a retest," and the
-- applicant was auto-rejected with no way back short of direct DB surgery.
--
-- REJECTED has no allowed forward transition in enforce_status_transition
-- (0061) — it falls to the `else false` branch — so this needs the same
-- app.bypass_status_check escape hatch every other legitimate out-of-order
-- transition in this app already uses.
--
-- assessment_results.application_id is UNIQUE (0001), so a second
-- submitResult call for a retest would fail outright unless the first
-- result is cleared first. The FAIL outcome/remarks are already permanently
-- preserved in audit_logs (assessment.result_recorded, logged at the
-- original time) — deleting the row here only frees the one-result-per-
-- application slot for the retest, it doesn't erase the history. The old
-- assessment_slot stays untouched as its own historical record; a fresh
-- slot gets created the normal way (assignAssessment) once this returns.
-- ============================================================================
create or replace function admin_grant_retest(p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    applications;
  v_result assessment_results;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_app.status <> 'REJECTED' then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;

  select * into v_result from assessment_results where application_id = p_application for update;
  delete from assessment_results where application_id = p_application;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'FORM_SUBMITTED' where id = p_application;

  return jsonb_build_object(
    'status', 'OK',
    'previous_outcome', v_result.outcome,
    'previous_remarks', v_result.remarks
  );
end $$;
