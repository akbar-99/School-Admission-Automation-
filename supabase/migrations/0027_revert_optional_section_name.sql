-- ============================================================================
-- Revert 0026 (optional Section/name for KG). Restores the pre-0026 schema
-- exactly: `name` required again, plain (grade, name, coalesce(batch,''))
-- uniqueness, no name-or-batch check constraint, and enroll_application back
-- to its 0024 form. The one section created under 0026 with name = null
-- (grade "KG 2", batch "TEST 30") had 0 filled seats and no linked
-- applications — confirmed safe to remove before restoring NOT NULL.
-- ============================================================================

delete from sections where name is null;

alter table sections drop constraint if exists sections_name_or_batch_check;

drop index if exists sections_grade_name_batch_key;

alter table sections alter column name set not null;

create unique index if not exists sections_grade_name_batch_key
  on sections (grade, name, coalesce(batch, ''));

-- ---------------------------------------------------------------------------
-- enroll_application — restored to the 0024 definition (name required again).
-- ---------------------------------------------------------------------------
create or replace function enroll_application(p_application uuid, p_year int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app        applications;
  v_grade      text;
  v_section_id uuid;
  v_section_nm text;
  v_section_batch text;
  v_adm        text;
  v_was_needs  boolean;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if v_app.status not in ('PAYMENT_COMPLETED', 'NEEDS_ADMIN') then
    raise exception 'NOT_READY_FOR_ENROLLMENT: %', v_app.status using errcode = 'check_violation';
  end if;
  if v_app.admission_number is not null then
    return jsonb_build_object('status', 'ENROLLED', 'admission_number', v_app.admission_number,
                              'section_id', v_app.section_id, 'already', true);
  end if;

  v_was_needs := (v_app.status = 'NEEDS_ADMIN');
  v_grade := coalesce(v_app.grade_applying, v_app.category::text, 'KG');

  -- first section with space (A -> B -> C, batch alphabetically within a tied
  -- division), row-locked to avoid over-fill. Plain FOR UPDATE (no SKIP
  -- LOCKED) preserves strict ordering under concurrency.
  select id, name, batch into v_section_id, v_section_nm, v_section_batch
    from sections
   where grade = v_grade and filled < capacity
   order by name, coalesce(batch, '')
   for update
   limit 1;

  perform set_config('app.bypass_status_check', 'on', true);

  if v_section_id is null then
    update applications set status = 'NEEDS_ADMIN' where id = p_application;
    return jsonb_build_object('status', 'NEEDS_ADMIN', 'grade', v_grade, 'already', v_was_needs);
  end if;

  update sections set filled = filled + 1 where id = v_section_id;
  v_adm := next_admission_number(p_year, v_grade);

  update applications
     set status = 'ENROLLED', section_id = v_section_id, admission_number = v_adm
   where id = p_application;

  return jsonb_build_object(
    'status', 'ENROLLED',
    'admission_number', v_adm,
    'section_id', v_section_id,
    'section', v_grade || '-' || v_section_nm || coalesce(' - ' || v_section_batch, '')
  );
end $$;
