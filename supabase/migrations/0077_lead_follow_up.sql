-- A marketing counselor sets a next-follow-up date on a lead; a daily cron
-- (src/app/api/cron/follow-up-reminders) reminds ONLY that lead's creator —
-- never the whole team, never the parent — by email/WhatsApp once the date
-- arrives. next_follow_up_reminder_sent guards against a double-send across
-- overlapping cron polls, same pattern as assessment_slots.reminder_sent;
-- it's reset to false whenever the date itself is changed, so picking a new
-- date always re-arms the reminder.
alter table applications
  add column if not exists next_follow_up_at date,
  add column if not exists next_follow_up_reminder_sent boolean not null default false;
