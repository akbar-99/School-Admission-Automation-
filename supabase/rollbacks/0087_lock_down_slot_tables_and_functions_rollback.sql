-- ============================================================================
-- Rollback for 0087. Only use this if something genuinely broke after 0087
-- (nothing in the app should — it calls all of these with the service-role
-- key). Running it re-opens the browser-key access 0087 closed.
-- ============================================================================

alter table assessment_slot_weekly_totals disable row level security;

grant execute on function claim_assessment_slot(uuid, uuid) to anon, authenticated;
grant execute on function book_assessment_slot(uuid, uuid) to anon, authenticated;
grant execute on function increment_weekly_pool_total(date, int) to anon, authenticated;
