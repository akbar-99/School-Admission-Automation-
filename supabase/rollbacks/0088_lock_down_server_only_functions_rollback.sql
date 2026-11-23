-- ============================================================================
-- Rollback for 0088. Only use this if something genuinely broke after 0088
-- (nothing in the app should — it calls all of these with the service-role
-- key). Running it re-opens browser-key access to every function below,
-- including factory_reset_applicants and admin_record_manual_payment.
-- ============================================================================

grant execute on function factory_reset_applicants() to anon, authenticated;
grant execute on function admin_overview_data(integer, integer) to anon, authenticated;
grant execute on function claim_lead(uuid, uuid) to anon, authenticated;
grant execute on function transfer_application_section(uuid, uuid) to anon, authenticated;
grant execute on function admin_release_missed_slot(uuid) to anon, authenticated;
grant execute on function admin_correct_grade_needs_assessment(uuid, text) to anon, authenticated;
grant execute on function admin_correct_grade_no_longer_needs_assessment(uuid, text) to anon, authenticated;
grant execute on function admin_undo_misfiled_assessment(uuid) to anon, authenticated;
grant execute on function release_assessment_slot(uuid) to anon, authenticated;
grant execute on function enroll_application(uuid, integer, boolean) to anon, authenticated;
grant execute on function admin_record_manual_payment(uuid, integer, text) to anon, authenticated;
grant execute on function next_broadway_admission_number() to anon, authenticated;
grant execute on function next_admission_number(integer, text) to anon, authenticated;
