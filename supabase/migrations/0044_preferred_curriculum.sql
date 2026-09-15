-- Captured at stage 1 (the minimal admission form) so it can pre-fill the
-- same field on stage 2 (the full details form) instead of asking again —
-- same pattern as reported_age / preferred_class_timing, a plain text value
-- from a small fixed set (CURRICULUM_OPTIONS), no DB-level enum needed.
alter table applications add column if not exists preferred_curriculum text;
