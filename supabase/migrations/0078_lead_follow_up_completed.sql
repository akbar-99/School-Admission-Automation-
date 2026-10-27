-- "Mark done" on a follow-up must NOT wipe out the date itself (the
-- counselor still wants to see what it was and when) — a separate
-- completed marker, not a reuse of next_follow_up_at being cleared.
-- Cleared back to null whenever the date is changed to a new one (a fresh
-- follow-up cycle starts un-done), so it only ever reflects THIS follow-up
-- having been dealt with, not some earlier one.
alter table applications
  add column if not exists next_follow_up_completed_at timestamptz;
