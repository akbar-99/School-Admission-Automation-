-- ============================================================================
-- Some KG sections are identified by batch alone (e.g. a single "DAHLIA"
-- batch under "KG 1" with no lettered division) — the "Section" (division
-- name) field becomes optional. Batch already was optional; a section must
-- now carry at least one of the two, or it has no identifying label at all.
-- ============================================================================

alter table sections alter column name drop not null;

-- Replace the (grade, name, batch) uniqueness with a NULL-safe version: a
-- plain unique index never treats two NULLs as equal, so two batch-only rows
-- with the same (grade, batch) and name = NULL would otherwise both be
-- allowed to exist — coalesce both sides so real duplicates are still caught.
drop index if exists sections_grade_name_batch_key;
create unique index sections_grade_name_batch_key
  on sections (grade, coalesce(name, ''), coalesce(batch, ''));

alter table sections drop constraint if exists sections_name_or_batch_check;
alter table sections add constraint sections_name_or_batch_check
  check (coalesce(name, '') <> '' or coalesce(batch, '') <> '');

-- ---------------------------------------------------------------------------
-- enroll_application — redefined again (following the 0005/0024 precedent),
-- same behavior, just NULL-safe on `name`: the fill-order sort and the
-- returned display string both need to handle a batch-only section without
-- sorting oddly or producing a NULL/mangled label.
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
  v_label      text;
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
  -- division; batch-only sections sort by batch alone), row-locked to avoid
  -- over-fill. Plain FOR UPDATE (no SKIP LOCKED) preserves strict ordering
  -- under concurrency.
  select id, name, batch into v_section_id, v_section_nm, v_section_batch
    from sections
   where grade = v_grade and filled < capacity
   order by coalesce(name, ''), coalesce(batch, '')
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

  v_label := v_grade
    || case when v_section_nm is not null and v_section_nm <> '' then '-' || v_section_nm else '' end
    || case when v_section_batch is not null and v_section_batch <> '' then ' - ' || v_section_batch else '' end;

  return jsonb_build_object(
    'status', 'ENROLLED',
    'admission_number', v_adm,
    'section_id', v_section_id,
    'section', v_label
  );
end $$;
