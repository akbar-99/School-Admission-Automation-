-- ============================================================================
-- Class timing (weekday range + hours, e.g. "Monday - Friday, 9:30 AM -
-- 12:55 PM IST") shown to parents so they know their child's schedule before
-- committing to payment. Free text, admin-set per section under Admin ->
-- Sections, since different divisions of the same grade can run different
-- schedules (e.g. a Mon-Fri track and a Sun-Thu track).
-- ============================================================================
alter table sections add column if not exists class_timing text;
