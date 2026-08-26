-- The KG/GRADE `category` column is a name-based label only (see
-- src/lib/assessment.ts classCategory) — independent of whether an
-- assessment was actually required (needsAssessment, "KG 1" only exempt).
-- Between the two rule changes, some applications were stored with
-- category derived from the "only KG 1" rule instead of the name-based
-- rule (e.g. a "KG 2" application stored as category='GRADE'). This is a
-- cosmetic backfill only — it does not touch status, admission_number, or
-- any already-completed workflow step.
update applications
   set category = (case when grade_applying ~* 'kg' then 'KG' else 'GRADE' end)::category_type
 where grade_applying is not null
   and category is distinct from (case when grade_applying ~* 'kg' then 'KG' else 'GRADE' end)::category_type;
