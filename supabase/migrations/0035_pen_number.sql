-- ============================================================================
-- PEN number (Permanent Enrolment Number) — an optional administrative ID,
-- collected on the remaining-details form alongside the other student info.
-- ============================================================================
alter table students add column if not exists pen_number text;
