-- ============================================================================
-- Replace the old ERP integration (Supabase project lxnwnkgyjywoolnqsrjy) with
-- the Broadway platform, per docs/broadway-integration.md. Broadway now owns
-- classes, students and families; the tracker talks to its REST API
-- (BROADWAY_API_URL / BROADWAY_API_KEY) instead of the old ERP's bespoke
-- Edge Functions (ERP_ADMISSIONS_SECRET / ERP_CLASS_WEBHOOK_SECRET).
--
-- Mirrors the old erp_classes/erp_students cache tables and the
-- applications/sections erp_* columns, renamed and reshaped to match
-- Broadway's actual response shapes (GET /classes, GET /students) so the
-- cache can be read back without re-deriving anything. Old tables/columns
-- are dropped in this same migration since every call site is updated
-- alongside it — nothing is left reading the old names after this ships.
-- ============================================================================

-- Cached mirror of GET /classes — refreshed by the periodic cron poll and the
-- admin "Sync now" button. Admin → Sections reads this to let an admin link
-- a local section to a real Broadway class by id, with seats-left visible.
create table if not exists broadway_classes (
  id                   text primary key,   -- Broadway's class id, sent back as classId on admissions
  name                 text not null,
  curriculum           text not null,
  grade                int not null,
  grade_label          text not null,
  section              text not null,
  batch                text,
  division             text,
  timing_id            text,
  timing               text,
  seats                int,                -- null = no limit
  this_year_students   int not null default 0,
  this_year_seats_left int,                -- null = no limit
  next_year_continuing int not null default 0,
  next_year_joining    int not null default 0,
  next_year_students   int not null default 0,
  next_year_seats_left int,                -- null = no limit
  synced_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_broadway_classes_grade on broadway_classes(grade, curriculum);
alter table broadway_classes enable row level security;
create policy broadway_classes_admin_read on broadway_classes for select to authenticated
  using (public.is_admin());

-- Cached mirror of GET /students, paged in (limit 500) by the same cron —
-- Broadway has no cross-class search of its own, so this is what Admin →
-- Broadway's search reads. Keyed on Broadway's own studentId, not this app's
-- application id (applicationId is only set for students the tracker sent).
create table if not exists broadway_students (
  student_id          text primary key,
  admission_no        text,
  full_name           text not null,
  curriculum          text,
  grade               int,
  grade_label         text,
  status              text not null,   -- Active | Incoming | Left
  class_id            text,
  class_name          text,
  planned_class_id    text,
  planned_class_name  text,
  joins_year          text,
  application_id      uuid references applications(id) on delete set null,
  parent_name         text,
  parent_email        text,
  synced_at           timestamptz not null default now()
);
create index if not exists idx_broadway_students_class_id on broadway_students(class_id);
create index if not exists idx_broadway_students_planned_class_id on broadway_students(planned_class_id);
create index if not exists idx_broadway_students_full_name on broadway_students(full_name);
create index if not exists idx_broadway_students_application_id on broadway_students(application_id);
alter table broadway_students enable row level security;
create policy broadway_students_admin_read on broadway_students for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- sections: linked to a real Broadway class by id, chosen from the cached
-- broadway_classes list — replaces the free-text erp_class_name field.
-- Sections are no longer created/pushed to Broadway from here at all
-- (Admin → Classes in Broadway owns that now), so the sync-status tracking
-- columns (erp_sync_status/erp_synced_at) go with it; "linked" vs "not
-- linked" is just whether broadway_class_id is set.
-- ---------------------------------------------------------------------------
alter table sections add column if not exists broadway_class_id text;
alter table sections add column if not exists broadway_class_name text;
alter table sections drop column if exists erp_class_name;
alter table sections drop column if exists erp_sync_status;
alter table sections drop column if exists erp_synced_at;

-- ---------------------------------------------------------------------------
-- applications: the fields POST /admissions returns, replacing the old
-- erp_status/erp_class_name/erp_student_id/erp_warning. 'cancelled' is new —
-- set when POST /admissions/cancel succeeds for a withdrawn-but-not-yet-
-- joined applicant (the old ERP had no equivalent of this; a cancelled
-- Broadway admission would otherwise still misleadingly read 'synced').
-- ---------------------------------------------------------------------------
alter table applications add column if not exists broadway_status text not null default 'pending'
  check (broadway_status in ('pending','no_mapping','send_failed','synced','cancelled'));
alter table applications add column if not exists broadway_student_id text;
alter table applications add column if not exists broadway_admission_no text;
alter table applications add column if not exists broadway_class_id text;
alter table applications add column if not exists broadway_class_name text;
alter table applications add column if not exists broadway_warning text;

create index if not exists idx_applications_broadway_status on applications(broadway_status)
  where broadway_status != 'synced';

drop index if exists idx_applications_erp_status;
alter table applications drop column if exists erp_status;
alter table applications drop column if exists erp_class_name;
alter table applications drop column if exists erp_student_id;
alter table applications drop column if exists erp_warning;

drop table if exists erp_classes;
drop table if exists erp_students;

-- Redefined only to swap the returned erp_class_name for broadway_class_id
-- (the dropped column above) — no other behavior change.
create or replace function transfer_application_section(p_application uuid, p_new_section uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app            applications;
  v_old_section_id uuid;
  v_old_section    sections;
  v_new_section    sections;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if v_app.section_id is null then
    return jsonb_build_object('status', 'NOT_ENROLLED');
  end if;

  v_old_section_id := v_app.section_id;
  if v_old_section_id = p_new_section then
    return jsonb_build_object('status', 'SAME_SECTION');
  end if;

  select * into v_old_section from sections where id = v_old_section_id;

  select * into v_new_section from sections where id = p_new_section for update;
  if v_new_section.id is null then
    raise exception 'SECTION_NOT_FOUND';
  end if;
  if v_new_section.grade <> v_old_section.grade then
    return jsonb_build_object('status', 'GRADE_MISMATCH');
  end if;
  if v_new_section.filled >= v_new_section.capacity then
    return jsonb_build_object('status', 'FULL');
  end if;

  update sections set filled = filled - 1 where id = v_old_section_id;
  update sections set filled = filled + 1 where id = p_new_section;
  update applications set section_id = p_new_section where id = p_application;

  return jsonb_build_object(
    'status', 'TRANSFERRED',
    'old_section_id', v_old_section_id,
    'new_section_id', p_new_section,
    'grade', v_new_section.grade,
    'name', v_new_section.name,
    'batch', v_new_section.batch,
    'broadway_class_id', v_new_section.broadway_class_id
  );
end $$;
