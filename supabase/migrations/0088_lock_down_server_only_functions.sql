-- ============================================================================
-- 0088 — every remaining server-only database function: service_role only.
--
-- Supabase grants EXECUTE on public-schema functions to anon and
-- authenticated by default, and nothing revoked it, so the public browser
-- key (shipped in every page) could call these through the REST API with
-- any ids — including wiping all applicants (factory_reset_applicants),
-- marking an application paid without payment (admin_record_manual_payment),
-- reading the applicant overview (admin_overview_data), and enrolling or
-- moving students (enroll_application, transfer_application_section).
--
-- Every caller in the app uses the service-role client from server code,
-- where the acting user comes from the logged-in session — so this changes
-- nothing for the app. 0085/0087 already locked the slot and class-change
-- functions.
--
-- Deliberately left open: app_role(), is_staff(), is_admin() — row level
-- security policies call them as the logged-in user. Trigger functions
-- (set_updated_at, enforce_status_transition, extend_token_on_status_change)
-- can't be called over the API, and triggers don't check EXECUTE.
-- ============================================================================

-- Admin / staff actions
revoke all on function factory_reset_applicants() from public, anon, authenticated;
revoke all on function admin_overview_data(integer, integer) from public, anon, authenticated;
revoke all on function claim_lead(uuid, uuid) from public, anon, authenticated;
revoke all on function transfer_application_section(uuid, uuid) from public, anon, authenticated;
revoke all on function admin_release_missed_slot(uuid) from public, anon, authenticated;
revoke all on function admin_correct_grade_needs_assessment(uuid, text) from public, anon, authenticated;
revoke all on function admin_correct_grade_no_longer_needs_assessment(uuid, text) from public, anon, authenticated;
revoke all on function admin_undo_misfiled_assessment(uuid) from public, anon, authenticated;

-- Parent portal (called by the server on the parent's behalf)
revoke all on function release_assessment_slot(uuid) from public, anon, authenticated;

-- Payment / enrolment / admission numbers
revoke all on function enroll_application(uuid, integer, boolean) from public, anon, authenticated;
revoke all on function admin_record_manual_payment(uuid, integer, text) from public, anon, authenticated;
revoke all on function next_broadway_admission_number() from public, anon, authenticated;
revoke all on function next_admission_number(integer, text) from public, anon, authenticated;

grant execute on function factory_reset_applicants() to service_role;
grant execute on function admin_overview_data(integer, integer) to service_role;
grant execute on function claim_lead(uuid, uuid) to service_role;
grant execute on function transfer_application_section(uuid, uuid) to service_role;
grant execute on function admin_release_missed_slot(uuid) to service_role;
grant execute on function admin_correct_grade_needs_assessment(uuid, text) to service_role;
grant execute on function admin_correct_grade_no_longer_needs_assessment(uuid, text) to service_role;
grant execute on function admin_undo_misfiled_assessment(uuid) to service_role;
grant execute on function release_assessment_slot(uuid) to service_role;
grant execute on function enroll_application(uuid, integer, boolean) to service_role;
grant execute on function admin_record_manual_payment(uuid, integer, text) to service_role;
grant execute on function next_broadway_admission_number() to service_role;
grant execute on function next_admission_number(integer, text) to service_role;
