-- ============================================================================
-- Let a parent express a preferred class timing on the remaining-details
-- form (stage 2), and have the automatic seat-fill honor it when possible.
-- A section matching the preference is tried first (still filled in the
-- existing A -> B -> C / batch order among matches); if none has room, this
-- falls back to the normal any-section order rather than routing to
-- NEEDS_ADMIN just because the exact preferred timing is full.
-- ============================================================================
alter table applications add column if not exists preferred_class_timing text;

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

  -- Sections matching the parent's preferred timing sort first (still
  -- A -> B -> C / batch order among themselves); everything else follows in
  -- the same order as before. When there's no preference, the "matches"
  -- rank is a tie for every row, so this is identical to the old order.
  select id, name, batch into v_section_id, v_section_nm, v_section_batch
    from sections
   where grade = v_grade and filled < capacity
   order by
     case when v_app.preferred_class_timing is not null
               and class_timing = v_app.preferred_class_timing
          then 0 else 1 end,
     name, coalesce(batch, '')
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
