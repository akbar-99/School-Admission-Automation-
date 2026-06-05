-- ============================================================================
-- Factory reset: wipe ALL applicant data but keep staff logins, class sections,
-- and configuration. Resets seat counts and admission-number counters.
-- Admin-only; called from a typed-confirmation action.
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

  -- Free every seat (sections themselves are kept).
  update sections set filled = 0;
end $$;
