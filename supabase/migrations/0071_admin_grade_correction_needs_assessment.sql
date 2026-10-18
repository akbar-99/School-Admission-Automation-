-- ============================================================================
-- Supports updateApplicationGrade (src/app/admin/actions.ts) for the case
-- where an admin corrects a parent's mis-picked class (e.g. "KG 1" -> "KG 2")
-- AFTER the form was already submitted and the application moved on to
-- DETAILS_PENDING or AGREEMENT_SENT — stages a KG 1 application (exempt from
-- the mandatory assessment) reaches by skipping the assessment stage
-- entirely. The new grade requires an assessment the old one didn't, but
-- both the parent's own slot-booking UI (src/app/apply/[token]/page.tsx) and
-- the admin assignAssessment action hard-require status = 'FORM_SUBMITTED'
-- — without resetting status back there, the parent would be stuck with no
-- way to ever book an assessment. enforce_status_transition (0061) only
-- allows forward moves, so this backward one needs the same
-- app.bypass_status_check escape hatch enroll_application and
-- admin_release_missed_slot already use for their own legitimate
-- out-of-order transitions.
--
-- Deliberately only accepts DETAILS_PENDING/AGREEMENT_SENT as the starting
-- point — both are purely form/UI stages with no payment activity yet.
-- Anything with real payment history (PAYMENT_PENDING onward) is rejected
-- here and the caller blocks that case before ever reaching this function,
-- since silently rewinding status after money has moved risks desyncing
-- from the actual payment/order records.
-- ============================================================================
create or replace function admin_correct_grade_needs_assessment(p_application uuid, p_grade text)
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
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;
  if v_app.status not in ('FORM_SUBMITTED', 'DETAILS_PENDING', 'AGREEMENT_SENT') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications
     set grade_applying = p_grade,
         status = 'FORM_SUBMITTED'
   where id = p_application;

  return jsonb_build_object('status', 'OK', 'previous_status', v_app.status);
end $$;
