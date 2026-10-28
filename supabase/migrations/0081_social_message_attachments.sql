-- ============================================================================
-- A client's Instagram/Facebook DM can be a voice note, photo, or video
-- instead of plain text. Previously the webhook collapsed these into a
-- generic placeholder string ("Requested an appointment via Instagram")
-- with no way for the marketing team to actually hear/see what was sent.
-- These columns carry the media URL through so the chat UI can render a
-- real player instead.
-- ============================================================================
alter table instagram_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_type text;

alter table facebook_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_type text;
