-- ============================================================================
-- Fix: 0063's enroll_application added `left join broadway_classes bc` to the
-- section-picking query, but kept the bare `for update` from before — Postgres
-- categorically rejects `FOR UPDATE` on a query with an outer join unless the
-- lock target is pinned to a specific table ("FOR UPDATE cannot be applied to
-- the nullable side of an outer join"), regardless of whether any given row's
-- bc columns are actually null. This broke enroll_application outright the
-- moment 0063 shipped (2026-10-10) — confirmed live: the very first payment
-- to reach it afterward (2026-10-13) failed with Postgres error code 0A000,
-- leaving the applicant stuck at PAYMENT_COMPLETED with no section or
-- admission number, silently (the TS caller only console.error's). Only
-- `sections` needs locking here (it's the row being updated right after);
-- `broadway_classes` is read-only in this query. `for update of s` scopes the
-- lock to that table alone, which Postgres allows regardless of the join.
-- ============================================================================
create or replace function enroll_application(p_application uuid, p_year int, p_use_next_year boolean default false)
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

  select s.id, s.name, s.batch into v_section_id, v_section_nm, v_section_batch
    from sections s
    left join broadway_classes bc on bc.id = s.broadway_class_id
   where s.grade = v_grade
     and greatest(
           s.filled,
           coalesce(case when p_use_next_year then bc.next_year_students else bc.this_year_students end, 0)
         ) < s.capacity
   order by
     case when v_app.preferred_class_timing is not null
               and s.class_timing = v_app.preferred_class_timing
          then 0 else 1 end,
     s.name, coalesce(s.batch, '')
   for update of s
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
