-- Replaces the per-(year, grade) admission number scheme with a single,
-- never-resetting sequence shared across the whole school — a plain running
-- number, not scoped by class or grade. The old admission_numbers table and
-- next_admission_number() function are left in place for historical
-- reference; enroll_application below is repointed at the new sequence.
create table if not exists broadway_admission_sequence (
  id          integer primary key default 1,
  next_number integer not null default 1,
  updated_at  timestamptz not null default now(),
  check (id = 1)
);
insert into broadway_admission_sequence (id, next_number)
values (1, 1)
on conflict (id) do nothing;
create trigger trg_broadway_admission_sequence_updated before update on broadway_admission_sequence
  for each row execute function set_updated_at();

-- Atomic claim-and-increment in one statement — concurrent enrollments
-- serialize on this row's lock rather than racing on a read-then-write.
create or replace function next_broadway_admission_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_num int;
begin
  update broadway_admission_sequence
     set next_number = next_number + 1
   where id = 1
  returning next_number - 1 into v_num;

  return v_num::text;
end $$;

-- Same allocation/capacity logic as before — only the admission-number
-- source changed (next_broadway_admission_number() instead of the old
-- per-year-per-grade next_admission_number(year, grade)).
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
  v_adm        text;
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

  v_grade := coalesce(v_app.grade_applying, v_app.category::text, 'KG');

  select id, name into v_section_id, v_section_nm
    from sections
   where grade = v_grade and filled < capacity
   order by name
   for update skip locked
   limit 1;

  perform set_config('app.bypass_status_check', 'on', true);

  if v_section_id is null then
    update applications set status = 'NEEDS_ADMIN' where id = p_application;
    return jsonb_build_object('status', 'NEEDS_ADMIN', 'grade', v_grade);
  end if;

  update sections set filled = filled + 1 where id = v_section_id;
  v_adm := next_broadway_admission_number();

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
