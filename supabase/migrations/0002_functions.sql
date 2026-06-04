-- ============================================================================
-- Atomic / concurrency-safe operations (SRS FR-13, FR-21, FR-22)
-- and the application state-machine guard (SRS §2.3).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- State-machine guard: reject invalid status transitions.
-- Set GUC app.bypass_status_check='on' (transaction-local) for admin overrides.
-- ---------------------------------------------------------------------------
create or replace function enforce_status_transition() returns trigger
language plpgsql as $$
declare
  ok boolean;
  bypass text := current_setting('app.bypass_status_check', true);
begin
  if new.status = old.status then return new; end if;
  if bypass = 'on' then return new; end if;

  ok := case old.status
    when 'LEAD_CREATED'         then new.status in ('FORM_SUBMITTED')
    when 'FORM_SUBMITTED'       then new.status in ('ASSESSMENT_SCHEDULED','AGREEMENT_SENT')
    when 'ASSESSMENT_SCHEDULED' then new.status in ('ASSESSMENT_COMPLETED')
    when 'ASSESSMENT_COMPLETED' then new.status in ('AGREEMENT_SENT','REJECTED')
    when 'AGREEMENT_SENT'       then new.status in ('PAYMENT_PENDING')
    when 'PAYMENT_PENDING'      then new.status in ('PAYMENT_COMPLETED','PAYMENT_FAILED','ABANDONED')
    when 'PAYMENT_FAILED'       then new.status in ('PAYMENT_PENDING','ABANDONED')
    when 'ABANDONED'            then new.status in ('PAYMENT_PENDING')
    when 'PAYMENT_COMPLETED'    then new.status in ('ENROLLED','NEEDS_ADMIN')
    when 'NEEDS_ADMIN'          then new.status in ('ENROLLED','REJECTED')
    when 'ENROLLED'             then new.status in ('NEEDS_ADMIN')
    else false
  end;

  if not ok then
    raise exception 'Invalid status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_status_transition on applications;
create trigger trg_status_transition before update of status on applications
  for each row execute function enforce_status_transition();

-- ---------------------------------------------------------------------------
-- next_admission_number — atomic per (year, grade) (SRS FR-21)
-- Format: YEAR-GRADE-RUNNINGNUMBER  e.g. 2026-G1-045
-- ---------------------------------------------------------------------------
create or replace function next_admission_number(p_year int, p_grade text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_num int;
begin
  insert into admission_numbers (year, grade, last_number)
  values (p_year, p_grade, 1)
  on conflict (year, grade)
  do update set last_number = admission_numbers.last_number + 1
  returning last_number into v_num;

  return p_year::text || '-' || p_grade || '-' || lpad(v_num::text, 3, '0');
end $$;

-- ---------------------------------------------------------------------------
-- book_assessment_slot — atomic, no double-booking (SRS FR-13)
-- ---------------------------------------------------------------------------
create or replace function book_assessment_slot(p_slot uuid, p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot assessment_slots;
begin
  update assessment_slots
     set application_id = p_application, is_open = false, updated_at = now()
   where id = p_slot
     and application_id is null
     and is_open = true
     and starts_at > now()
  returning * into v_slot;

  if v_slot.id is null then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'check_violation';
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications
     set status = 'ASSESSMENT_SCHEDULED'
   where id = p_application
     and status in ('FORM_SUBMITTED', 'ASSESSMENT_SCHEDULED');

  return jsonb_build_object(
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at,
    'ends_at', v_slot.ends_at,
    'teacher_id', v_slot.teacher_id
  );
end $$;

-- ---------------------------------------------------------------------------
-- enroll_application — atomic admission number + capacity-based section
-- allocation in a single transaction (SRS FR-21, FR-22).
-- Falls back to NEEDS_ADMIN when every section is full.
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

  -- first section with space (A -> B -> C ...), row-locked to avoid over-fill
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
