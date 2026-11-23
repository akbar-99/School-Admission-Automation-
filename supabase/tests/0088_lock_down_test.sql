-- ============================================================================
-- Test for 0088 — read-only (only looks at settings), safe on live.
-- Also catches any function created by hand in the SQL Editor that the
-- browser key could still call.
-- ============================================================================

with app_functions as (
  select p.oid, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prorettype <> 'trigger'::regtype
     -- skip functions that belong to an extension (e.g. pgcrypto)
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
open_to_browser as (
  select signature from app_functions
   where proname not in ('app_role', 'is_staff', 'is_admin')
     and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
)
select 'no app function is callable with the browser key / by logged-in users directly' as test,
       case when count(*) = 0 then 'PASS' else 'FAIL — still open: ' || string_agg(signature, ', ') end as result
  from open_to_browser
union all
select 'RLS helpers still usable by logged-in users (needed by access rules)',
       case when has_function_privilege('authenticated', 'app_role()', 'execute')
             and has_function_privilege('authenticated', 'is_staff()', 'execute')
             and has_function_privilege('authenticated', 'is_admin()', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'server can still enrol, record manual payments and reset',
       case when has_function_privilege('service_role', 'enroll_application(uuid,integer,boolean)', 'execute')
             and has_function_privilege('service_role', 'admin_record_manual_payment(uuid,integer,text)', 'execute')
             and has_function_privilege('service_role', 'factory_reset_applicants()', 'execute')
             and has_function_privilege('service_role', 'admin_overview_data(integer,integer)', 'execute')
            then 'PASS' else 'FAIL' end;
