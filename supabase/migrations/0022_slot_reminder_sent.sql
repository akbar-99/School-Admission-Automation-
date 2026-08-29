-- ============================================================================
-- 10-minutes-before assessment reminders — track which slots have already
-- been reminded so the polling cron route (which may run every few minutes
-- and could overlap itself) never double-sends.
-- ============================================================================

alter table assessment_slots
  add column if not exists reminder_sent boolean not null default false;

-- Only unreminded, booked, upcoming slots are ever scanned by the poller.
create index if not exists idx_slots_reminder_pending
  on assessment_slots (starts_at)
  where reminder_sent = false and application_id is not null;
