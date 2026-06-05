-- ============================================================================
-- Record the parent's IANA timezone (e.g. 'Asia/Dubai') alongside the
-- preferred assessment instant, so staff can show it in both School and
-- parent-local time.
-- ============================================================================

alter table applications
  add column if not exists preferred_assessment_tz text;
