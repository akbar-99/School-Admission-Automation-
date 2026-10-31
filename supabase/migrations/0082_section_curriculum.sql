-- ============================================================================
-- KG sections mixed CBSE and Cambridge students in the same batch, because
-- curriculum was never a real, enforced property of a section — it only
-- ever existed as free text inside broadway_input_name (e.g. "CBSE KG 1-A -
-- ORCHID"), and enroll_application's section-selection query never looked
-- at it at all (confirmed live: VAMIKA BIBIN, Zara Manha and Sarah Farook,
-- all CBSE, ended up auto-enrolled into Cambridge-labelled KG batches).
--
-- This adds a real `curriculum` column, backfills it for existing KG
-- sections from the only place it was previously recorded, and makes
-- enroll_application respect it. Non-KG sections are left with
-- curriculum = null (their grade name, e.g. "STAGE 6"/"STD 6", already
-- encodes curriculum on its own), and the new filter is a no-op wherever
-- curriculum is null on either side — identical behaviour to before this
-- migration for every section that already had no ambiguity.
-- ============================================================================

alter table sections
  add column if not exists curriculum text check (curriculum in ('CBSE', 'Cambridge'));

update sections
   set curriculum = 'CBSE'
 where curriculum is null
   and broadway_input_name ilike 'CBSE %';

update sections
   set curriculum = 'Cambridge'
 where curriculum is null
   and broadway_input_name ilike 'Cambridge %';

create or replace function enroll_application(p_application uuid, p_year int, p_use_next_year boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app        applications;
  v_grade      text;
  v_curriculum text;
  v_section_id uuid;
  v_section_nm text;
  v_section_batch text;
  v_section_lbl text;
  v_adm        text;
  v_was_needs  boolean;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if v_app.admission_number is not null then
    select s.grade || '-' || s.name || coalesce(' - ' || s.batch, '')
      into v_section_lbl
      from sections s
     where s.id = v_app.section_id;
    return jsonb_build_object('status', 'ENROLLED', 'admission_number', v_app.admission_number,
                              'section_id', v_app.section_id, 'section', v_section_lbl, 'already', true);
  end if;
  if v_app.status not in ('PAYMENT_COMPLETED', 'NEEDS_ADMIN') then
    raise exception 'NOT_READY_FOR_ENROLLMENT: %', v_app.status using errcode = 'check_violation';
  end if;

  v_was_needs := (v_app.status = 'NEEDS_ADMIN');
  v_grade := coalesce(v_app.grade_applying, v_app.category::text, 'KG');

  -- Same student.curriculum ?? application.preferred_curriculum fallback
  -- used everywhere else in the app (e.g. the Sections roster's curriculum
  -- badge) — students.curriculum is authoritative once a student record
  -- exists, preferred_curriculum is the pre-formalization fallback.
  select coalesce(st.curriculum, v_app.preferred_curriculum)
    into v_curriculum
    from students st
   where st.id = v_app.student_id;
  if v_curriculum is null then
    v_curriculum := v_app.preferred_curriculum;
  end if;

  select s.id, s.name, s.batch into v_section_id, v_section_nm, v_section_batch
    from sections s
    left join broadway_classes bc on bc.id = s.broadway_class_id
   where s.grade = v_grade
     and (s.curriculum is null or v_curriculum is null or s.curriculum = v_curriculum)
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
  v_adm := next_broadway_admission_number();

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
