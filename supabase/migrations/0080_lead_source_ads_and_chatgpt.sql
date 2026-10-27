-- ============================================================================
-- Adds Google Ads, Meta Ads, and ChatGPT to the fixed set of lead sources
-- (applications_lead_source_check, 0029) so the "New lead" form's dropdown
-- can offer them.
-- ============================================================================
alter table applications drop constraint if exists applications_lead_source_check;
alter table applications add constraint applications_lead_source_check
  check (lead_source is null or lead_source in (
    'instagram', 'facebook', 'whatsapp', 'google', 'google_ads', 'meta_ads', 'chatgpt', 'referral', 'other'
  ));
