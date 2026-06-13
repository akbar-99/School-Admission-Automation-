-- Per-teacher Zoom account email. Assessment meetings are hosted under the
-- assigned teacher's own Zoom account; this lets an admin map a teacher to their
-- real Zoom login when it differs from their portal login email. When unset,
-- the integration falls back to users.email, then ZOOM_DEFAULT_HOST_EMAIL
-- (see src/lib/zoom.ts).
alter table users
  add column if not exists zoom_email text;
