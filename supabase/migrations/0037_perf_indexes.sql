-- Performance pass: indexes for columns that admin/marketing/teacher pages
-- filter, join or order by, but that had no supporting index — each of
-- these was a full-table scan that gets slower as the school's data grows.

-- Marketing pages scope leads by the staff member who created them, and the
-- admin marketing-performance report filters to applications with any owner.
create index if not exists idx_applications_created_by
  on applications(created_by);

-- Admin Sections page looks up every application enrolled in a given set of
-- sections.
create index if not exists idx_applications_section
  on applications(section_id);

-- Equality lookups for a specific teacher's own slots (teacher dashboard,
-- history, admin assessments filter). The existing idx_slots_unassigned
-- index only covers the "teacher_id is null" pool-lookup case.
create index if not exists idx_slots_teacher
  on assessment_slots(teacher_id)
  where teacher_id is not null;

-- A teacher's own assessment-result history.
create index if not exists idx_results_teacher
  on assessment_results(teacher_id);

-- Both admin log views order by created_at desc with a limit; without an
-- index on created_at, that requires a full sort of the whole table.
create index if not exists idx_notifications_created_at
  on notifications(created_at desc);
create index if not exists idx_audit_logs_created_at
  on audit_logs(created_at desc);
