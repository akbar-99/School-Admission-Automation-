-- ============================================================================
-- Fix: factory_reset_applicants() failed with "UPDATE requires a WHERE clause"
-- because `update sections set filled = 0` had no WHERE, which Supabase's
-- safe-update guard rejects. Since the function is one transaction, the failed
-- UPDATE rolled back the TRUNCATE too — so nothing was wiped.
-- Adding an explicit WHERE clause satisfies the guard.
-- ============================================================================

create or replace function factory_reset_applicants()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Wipe applicant-side data. CASCADE clears FK-dependent rows; RESTART IDENTITY
  -- resets serial counters (e.g. admission_numbers).
  truncate table
    parents,
    students,
    applications,
    payments,
    assessment_results,
    assessment_slots,
    admission_numbers,
    notifications,
    audit_logs
  restart identity cascade;

  -- Free every occupied seat (sections themselves are kept). The WHERE clause is
  -- required by the safe-update guard.
  update sections set filled = 0 where filled is distinct from 0;
end $$;
