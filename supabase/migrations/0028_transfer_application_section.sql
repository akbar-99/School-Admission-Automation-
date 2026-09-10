-- ============================================================================
-- Transfer an already-enrolled student to a different division/batch within
-- the same grade (admin action from Admin -> Sections). Restricted to the
-- same grade deliberately: the admission number already encodes the grade
-- (e.g. "2026-G1-001"), so a cross-grade move would need a new admission
-- number too — out of scope here, and blocked at the DB level as a safety
-- net regardless of what the UI sends.
-- ============================================================================
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

  -- Lock the destination row before checking capacity, same reasoning as
  -- enroll_application: a plain FOR UPDATE (not SKIP LOCKED) so a concurrent
  -- transfer/enrollment targeting the same section can't both pass the
  -- capacity check for the last seat.
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
    'erp_class_name', v_new_section.erp_class_name
  );
end $$;
