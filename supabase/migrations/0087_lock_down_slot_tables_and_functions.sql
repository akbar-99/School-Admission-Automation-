-- ============================================================================
-- 0087 — server-only access for the assessment-slot ledger and RPCs.
--
-- assessment_slot_weekly_totals (0084) was created without row level
-- security, so the public browser (anon) key could read it — and, with
-- Supabase's default table grants, change it — through the REST API.
-- That table drives every teacher's weekly fair-share limit. RLS on with no
-- policies leaves it to service_role only, which is all the app uses
-- (createAssessmentSlot and the admin pages read/write it server-side, and
-- claim_assessment_slot reads it as security definer).
--
-- claim_assessment_slot(p_slot, p_teacher) and book_assessment_slot(p_slot,
-- p_application) were also callable with the browser key, with any teacher /
-- application id. Both are only ever called by server actions through the
-- service-role client (teacher claim, parent booking), which take the
-- identity from the session; increment_weekly_pool_total (0084) likewise.
-- EXECUTE is revoked from public/anon/authenticated and kept for service_role.
-- ============================================================================

alter table assessment_slot_weekly_totals enable row level security;

revoke all on function claim_assessment_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function book_assessment_slot(uuid, uuid) from public, anon, authenticated;
revoke all on function increment_weekly_pool_total(date, int) from public, anon, authenticated;

grant execute on function claim_assessment_slot(uuid, uuid) to service_role;
grant execute on function book_assessment_slot(uuid, uuid) to service_role;
grant execute on function increment_weekly_pool_total(date, int) to service_role;
