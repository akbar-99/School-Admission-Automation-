-- ============================================================================
-- Local cache of every student in every ERP class, refreshed by the admin
-- "Sync now" button alongside erp_classes. The ERP has no cross-class
-- search API — only a per-class roster (admissions-class-students) — so a
-- global search across all real students needs this app to have already
-- pulled every class's roster in ahead of time. Read-only reference data,
-- same pattern as erp_classes.
-- ============================================================================
create table if not exists erp_students (
  internal_id text primary key,       -- the ERP's real internal id (a UUID, opaque here)
  student_id  text not null,          -- ERP's human-readable admission number, e.g. "2892"
  full_name   text not null,
  class_name  text not null,          -- exact ERP class_name this student is currently in
  admission_id uuid,                  -- this app's own applications.id, when known
  synced_at   timestamptz not null default now()
);
create index if not exists idx_erp_students_class_name on erp_students(class_name);
create index if not exists idx_erp_students_student_id on erp_students(student_id);
create index if not exists idx_erp_students_full_name on erp_students(full_name);

alter table erp_students enable row level security;
create policy erp_students_admin_read on erp_students for select to authenticated
  using (public.is_admin());
