-- ============================================================================
-- Preferred assessment date now also carries a time → widen date to timestamptz.
-- ============================================================================

alter table applications
  alter column preferred_assessment_date type timestamptz
    using preferred_assessment_date::timestamptz,
  alter column preferred_assessment_date_alt type timestamptz
    using preferred_assessment_date_alt::timestamptz;
