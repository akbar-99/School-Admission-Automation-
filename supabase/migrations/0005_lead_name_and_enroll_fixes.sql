-- ============================================================================
-- 0005 — follow-up fixes
--   1. Persist the optional student name captured at lead entry (SRS FR-1).
--   2. enroll_application: report `already` on the NEEDS_ADMIN path so repeat
--      calls (the /verify + /webhook double-fire, or repeated admin resolves)
--      don't re-notify admins.
--   3. Allocate sections strictly A -> B -> C (SRS FR-22): wait on a locked
--      candidate section instead of skipping it, so a section is filled before
--      the next one is touched. Application row is locked first, so the lock
--      order (application, then section by name) is consistent -> no deadlock.
-- ============================================================================

alter table applications
  add column if not exists lead_student_name text;

create or replace function enroll_application(p_application uuid, p_year int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app          applications;
  v_grade        text;
  v_section_id   uuid;
  v_section_nm   text;
  v_adm          text;
  v_was_needs    boolean;
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

  -- first section with space (A -> B -> C ...), row-locked to avoid over-fill.
  -- Plain FOR UPDATE (no SKIP LOCKED) preserves strict ordering under concurrency.
  select id, name into v_section_id, v_section_nm
    from sections
   where grade = v_grade and filled < capacity
   order by name
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
    'section', v_grade || '-' || v_section_nm
  );
end $$;
