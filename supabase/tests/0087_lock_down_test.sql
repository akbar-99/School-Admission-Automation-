-- ============================================================================
-- Tests for 0087 — run after it. Read-only: only checks settings and grants.
-- ============================================================================

select test, case when ok then 'PASS' else 'FAIL' end as result
from (values
  ('weekly totals table has RLS on',
   (select relrowsecurity from pg_class where oid = 'public.assessment_slot_weekly_totals'::regclass)),
  ('weekly totals: no policy lets anyone in (server only)',
   not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assessment_slot_weekly_totals')),
  ('browser key cannot claim a slot',
   not has_function_privilege('anon', 'claim_assessment_slot(uuid,uuid)', 'execute')),
  ('logged-in users cannot claim a slot directly',
   not has_function_privilege('authenticated', 'claim_assessment_slot(uuid,uuid)', 'execute')),
  ('browser key cannot book a slot',
   not has_function_privilege('anon', 'book_assessment_slot(uuid,uuid)', 'execute')),
  ('logged-in users cannot book a slot directly',
   not has_function_privilege('authenticated', 'book_assessment_slot(uuid,uuid)', 'execute')),
  ('browser key cannot change the weekly totals',
   not has_function_privilege('anon', 'increment_weekly_pool_total(date,integer)', 'execute')),
  ('server (service_role) can still claim, book and count',
   has_function_privilege('service_role', 'claim_assessment_slot(uuid,uuid)', 'execute')
   and has_function_privilege('service_role', 'book_assessment_slot(uuid,uuid)', 'execute')
   and has_function_privilege('service_role', 'increment_weekly_pool_total(date,integer)', 'execute'))
) as t(test, ok);
