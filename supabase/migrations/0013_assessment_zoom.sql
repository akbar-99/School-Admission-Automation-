-- Zoom meeting details for booked assessment slots.
-- Auto-generated via the Zoom Server-to-Server OAuth API when a slot is booked
-- (see src/lib/zoom.ts + handleSlotBooked in src/lib/workflow.ts). The meeting is
-- hosted by the assigned assessment teacher's own Zoom account, so concurrent
-- assessments are supported.
alter table assessment_slots
  add column if not exists zoom_meeting_id text,
  add column if not exists zoom_join_url   text,  -- shared with the student/parent
  add column if not exists zoom_start_url  text,  -- host link for the assessment teacher
  add column if not exists zoom_passcode   text,
  add column if not exists zoom_created_at timestamptz;
