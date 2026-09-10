-- ============================================================================
-- Track where a lead came from, captured once at lead-creation time on the
-- "New lead" form. A fixed, short list (matching the dropdown) rather than
-- free text, so it stays useful for grouping/reporting later.
-- ============================================================================
alter table applications add column if not exists lead_source text;
alter table applications drop constraint if exists applications_lead_source_check;
alter table applications add constraint applications_lead_source_check
  check (lead_source is null or lead_source in ('instagram', 'facebook', 'whatsapp', 'google', 'referral', 'other'));
