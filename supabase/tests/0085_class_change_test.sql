-- ============================================================================
-- Tests for 0085_class_change.sql — run on the TEST project only, after 0085.
-- Paste the whole file into the SQL Editor and Run. It creates its own fake
-- parents/applicants, checks every case, returns a PASS/FAIL table, and then
-- throws everything it created away (nothing is left behind).
-- ============================================================================

create or replace function pg_temp.check_(name text, ok boolean, detail text default null)
returns text language sql as $$
  select name || '|' || case when ok then 'PASS' else 'FAIL' || coalesce(' — ' || detail, '') end
$$;

-- A parent + application in a given state, with a PASS/FAIL result linked
-- to a past slot (what a real assessed applicant looks like).
create or replace function pg_temp.make_applicant(
  p_status app_status, p_grade text, p_curriculum text, p_with_student boolean,
  p_outcome assessment_outcome, p_agreement_signed boolean default false)
returns uuid language plpgsql as $$
declare v_parent uuid; v_student uuid; v_app uuid; v_slot uuid;
begin
  insert into parents (full_name, phone) values ('Test Parent', '+910000000000') returning id into v_parent;
  if p_with_student then
    insert into students (parent_id, full_name, dob, curriculum)
    values (v_parent, 'Test Child', '2019-01-01', p_curriculum) returning id into v_student;
  end if;
  insert into applications (parent_id, student_id, status, grade_applying, category, preferred_curriculum,
                            agreement_accepted, agreement_accepted_at, agreement_signature, agreement_ip)
  values (v_parent, v_student, p_status, p_grade,
          (case when p_grade ~* 'kg' then 'KG' else 'GRADE' end)::category_type, p_curriculum,
          p_agreement_signed, case when p_agreement_signed then now() end,
          case when p_agreement_signed then 'Test Parent' end, case when p_agreement_signed then '1.2.3.4' end)
  returning id into v_app;
  insert into assessment_slots (teacher_id, starts_at, ends_at, is_open, application_id)
  values (null, now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', false, v_app)
  returning id into v_slot;
  insert into assessment_results (application_id, slot_id, outcome, remarks)
  values (v_app, v_slot, p_outcome, 'original result');
  return v_app;
end $$;

-- What booking + a teacher recording the new result does to the row.
create or replace function pg_temp.take_new_assessment(p_app uuid, p_outcome assessment_outcome, p_future boolean default false)
returns uuid language plpgsql as $$
declare v_slot uuid;
begin
  insert into assessment_slots (teacher_id, starts_at, ends_at, is_open, application_id)
  values (null,
          case when p_future then now() + interval '2 days' else now() - interval '1 hour' end,
          case when p_future then now() + interval '2 days' else now() - interval '1 hour' end + interval '30 minutes',
          false, p_app)
  returning id into v_slot;
  perform set_config('app.bypass_status_check', 'off', true);
  update applications set status = 'ASSESSMENT_SCHEDULED' where id = p_app;
  if p_outcome is not null then
    insert into assessment_results (application_id, slot_id, outcome, remarks) values (p_app, v_slot, p_outcome, 'new class');
    update applications set status = 'ASSESSMENT_COMPLETED' where id = p_app;
  end if;
  return v_slot;
end $$;

create or replace function pg_temp.class_change_tests()
returns table (test text, result text) language plpgsql as $$
declare
  r     text[] := '{}';
  v_app uuid; v_app2 uuid; v_app3 uuid; v_app4 uuid; v_app5 uuid;
  v_res jsonb; v_row applications; v_change application_class_changes;
  v_old_result uuid; v_old_slot uuid; v_new_slot uuid; v_section uuid; v_cnt int; v_text text;
begin
  begin
    -- 1. Curriculum switch from AGREEMENT_SENT (details filled, agreement signed), then PASS.
    v_app := pg_temp.make_applicant('AGREEMENT_SENT', 'STD 3', 'CBSE', true, 'PASS', true);
    select id, slot_id into v_old_result, v_old_slot from assessment_results where application_id = v_app;
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := start_class_change(v_app, 'STAGE 3', 'Cambridge', 'curriculum', true, 'parent prefers Cambridge', null);
    select * into v_row from applications where id = v_app;
    r := r || pg_temp.check_('1a start returns STARTED', v_res->>'status' = 'STARTED', v_res::text);
    r := r || pg_temp.check_('1b back to awaiting assessment', v_row.status = 'FORM_SUBMITTED', v_row.status::text);
    r := r || pg_temp.check_('1c class + curriculum switched', v_row.grade_applying = 'STAGE 3' and v_row.preferred_curriculum = 'Cambridge');
    r := r || pg_temp.check_('1d student curriculum switched',
      (select curriculum from students where id = v_row.student_id) = 'Cambridge');
    r := r || pg_temp.check_('1e old result moved to history',
      not exists (select 1 from assessment_results where application_id = v_app)
      and (select old_result->>'outcome' from application_class_changes where application_id = v_app) = 'PASS');
    r := r || pg_temp.check_('1f old slot unlinked, remembered',
      (select application_id from assessment_slots where id = v_old_slot) is null
      and (select old_slot_id from application_class_changes where application_id = v_app) = v_old_slot);

    v_res := start_class_change(v_app, 'STAGE 4', 'Cambridge', 'other', true, null, null);
    r := r || pg_temp.check_('2  second change refused while one is open', v_res->>'status' = 'CHANGE_OPEN', v_res::text);

    perform pg_temp.take_new_assessment(v_app, 'PASS');
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := finish_class_change(v_app, true, null);
    select * into v_row from applications where id = v_app;
    select * into v_change from application_class_changes where application_id = v_app;
    r := r || pg_temp.check_('3a PASS lands the change', v_res->>'status' = 'APPLIED' and v_change.status = 'applied', v_res::text);
    r := r || pg_temp.check_('3b back at the agreement (details not asked again)', v_row.status = 'AGREEMENT_SENT', v_row.status::text);
    r := r || pg_temp.check_('3c agreement to be signed again, old one kept',
      not v_row.agreement_accepted and v_row.agreement_signature is null
      and v_change.old_agreement->>'signature' = 'Test Parent');
    r := r || pg_temp.check_('3d new class kept', v_row.grade_applying = 'STAGE 3' and v_row.preferred_curriculum = 'Cambridge');

    -- 4. One class up from DETAILS_PENDING (no details yet), then FAIL -> everything restored.
    v_app2 := pg_temp.make_applicant('DETAILS_PENDING', 'STD 3', 'CBSE', false, 'PASS');
    select id, slot_id into v_old_result, v_old_slot from assessment_results where application_id = v_app2;
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := start_class_change(v_app2, 'STD 4', 'CBSE', 'next_class', true, null, null);
    v_new_slot := pg_temp.take_new_assessment(v_app2, 'FAIL');
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := finish_class_change(v_app2, false, null);
    select * into v_row from applications where id = v_app2;
    select * into v_change from application_class_changes where application_id = v_app2;
    r := r || pg_temp.check_('4a FAIL reverts', v_res->>'status' = 'REVERTED' and v_change.status = 'failed', v_res::text);
    r := r || pg_temp.check_('4b original stage back', v_row.status = 'DETAILS_PENDING', v_row.status::text);
    r := r || pg_temp.check_('4c original class back', v_row.grade_applying = 'STD 3' and v_row.preferred_curriculum = 'CBSE');
    r := r || pg_temp.check_('4d original result back (same row)',
      (select id from assessment_results where application_id = v_app2) = v_old_result
      and (select outcome from assessment_results where application_id = v_app2) = 'PASS');
    r := r || pg_temp.check_('4e failed new result kept in history', v_change.new_result->>'outcome' = 'FAIL');
    r := r || pg_temp.check_('4f old slot relinked, new slot unlinked',
      (select application_id from assessment_slots where id = v_old_slot) = v_app2
      and (select application_id from assessment_slots where id = v_new_slot) is null);

    -- 5. Cancel before the result, after a future slot was booked -> slot freed, everything back.
    v_app3 := pg_temp.make_applicant('REJECTED', 'STD 5', 'CBSE', false, 'FAIL');
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := start_class_change(v_app3, 'STAGE 5', 'Cambridge', 'curriculum', true, null, null);
    v_new_slot := pg_temp.take_new_assessment(v_app3, null, true);
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := cancel_class_change(v_app3, null);
    select * into v_row from applications where id = v_app3;
    r := r || pg_temp.check_('5a cancel', v_res->>'status' = 'CANCELLED', v_res::text);
    r := r || pg_temp.check_('5b back to REJECTED with the original FAIL',
      v_row.status = 'REJECTED' and v_row.grade_applying = 'STD 5'
      and (select outcome from assessment_results where application_id = v_app3) = 'FAIL');
    r := r || pg_temp.check_('5c booked future slot is free again',
      (select application_id is null and is_open from assessment_slots where id = v_new_slot));
    v_res := cancel_class_change(v_app3, null);
    r := r || pg_temp.check_('5d nothing left to cancel', v_res->>'status' = 'NO_OPEN_CHANGE', v_res::text);

    -- 6. To KG 1 (no assessment): lands immediately.
    v_app4 := pg_temp.make_applicant('DETAILS_PENDING', 'KG 2', 'Cambridge', false, 'PASS');
    perform set_config('app.bypass_status_check', 'off', true);
    v_res := start_class_change(v_app4, 'KG 1', 'Cambridge', 'other', false, null, null);
    select * into v_row from applications where id = v_app4;
    r := r || pg_temp.check_('6a KG 1 applies at once', v_res->>'status' = 'APPLIED', v_res::text);
    r := r || pg_temp.check_('6b continues to details, category KG',
      v_row.status = 'DETAILS_PENDING' and v_row.grade_applying = 'KG 1' and v_row.category = 'KG');
    r := r || pg_temp.check_('6c no open change left',
      not exists (select 1 from application_class_changes where application_id = v_app4 and status = 'awaiting_assessment'));

    -- 7. Guards.
    v_app5 := pg_temp.make_applicant('AGREEMENT_SENT', 'STD 2', 'CBSE', true, 'PASS');
    insert into payments (application_id, amount) values (v_app5, 100);
    r := r || pg_temp.check_('7a refused once a payment exists',
      start_class_change(v_app5, 'STAGE 2', 'Cambridge', 'curriculum', true, null, null)->>'status' = 'PAYMENT_STARTED');
    delete from payments where application_id = v_app5;
    insert into sections (grade, name, capacity) values ('TEST 99', 'Z', 5) returning id into v_section;
    update applications set section_id = v_section where id = v_app5;
    r := r || pg_temp.check_('7b refused once in a section',
      start_class_change(v_app5, 'STAGE 2', 'Cambridge', 'curriculum', true, null, null)->>'status' = 'ALREADY_SECTIONED');
    update applications set section_id = null where id = v_app5;
    r := r || pg_temp.check_('7c same class refused',
      start_class_change(v_app5, 'STD 2', 'CBSE', 'other', true, null, null)->>'status' = 'NO_CHANGE');
    perform set_config('app.bypass_status_check', 'on', true);
    update applications set status = 'FORM_SUBMITTED' where id = v_app5;
    r := r || pg_temp.check_('7d refused before an assessment stage',
      start_class_change(v_app5, 'STAGE 2', 'Cambridge', 'curriculum', true, null, null)->>'status' = 'INVALID_STATUS');
    r := r || pg_temp.check_('7e finish with no change -> normal flow',
      finish_class_change(v_app5, true, null)->>'status' = 'NO_OPEN_CHANGE');

    -- 8. Retest fix: granting a retest unlinks the old slot so the parent can book.
    v_app := pg_temp.make_applicant('REJECTED', 'STD 6', 'CBSE', false, 'FAIL');
    select slot_id into v_old_slot from assessment_results where application_id = v_app;
    v_res := admin_grant_retest(v_app);
    r := r || pg_temp.check_('8  retest unlinks the old slot',
      v_res->>'status' = 'OK' and (select application_id from assessment_slots where id = v_old_slot) is null);

    -- 9. Only the server may call these.
    r := r || pg_temp.check_('9a browser key (anon) cannot start a change',
      not has_function_privilege('anon', 'start_class_change(uuid,text,text,text,boolean,text,uuid)', 'execute'));
    r := r || pg_temp.check_('9b logged-in users cannot start a change',
      not has_function_privilege('authenticated', 'start_class_change(uuid,text,text,text,boolean,text,uuid)', 'execute'));
    r := r || pg_temp.check_('9c logged-in users cannot finish/cancel',
      not has_function_privilege('authenticated', 'finish_class_change(uuid,boolean,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'cancel_class_change(uuid,uuid)', 'execute'));
    r := r || pg_temp.check_('9d the server (service_role) can',
      has_function_privilege('service_role', 'start_class_change(uuid,text,text,text,boolean,text,uuid)', 'execute'));
    r := r || pg_temp.check_('9e retest also server-only',
      not has_function_privilege('anon', 'admin_grant_retest(uuid)', 'execute'));

    raise exception 'ROLLBACK_TEST_DATA';
  exception when others then
    if sqlerrm <> 'ROLLBACK_TEST_DATA' then
      r := r || ('ERROR (test stopped)|' || sqlerrm);
    end if;
  end;
  return query select split_part(x, '|', 1), split_part(x, '|', 2) from unnest(r) as x;
end $$;

select * from pg_temp.class_change_tests();
