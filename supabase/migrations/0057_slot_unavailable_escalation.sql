-- A teacher's "can't attend" report (unavailable_reported, see 0018) only
-- alerts admin/COO once. If nobody reassigns the slot in time, the parent's
-- booking just sits there with no teacher and nobody finds out. This adds a
-- one-shot escalation flag so a cron pass (see /api/cron/assessment-reminders)
-- can re-alert admin/COO if a slot has stayed unreassigned past a configurable
-- threshold (settings.unavailableSlotEscalationHours).
--
-- reassignSlotTeacher must reset this to false alongside unavailable_reported/
-- unavailable_reported_at, so a slot that's reassigned, later re-flagged, and
-- left unattended again can escalate a second time instead of being silently
-- skipped forever.
alter table assessment_slots
  add column if not exists unavailable_escalated boolean not null default false;

create index if not exists idx_slots_unavailable_escalation_pending
  on assessment_slots(unavailable_reported_at)
  where unavailable_escalated = false and unavailable_reported = true;
