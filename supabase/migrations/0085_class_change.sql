-- ============================================================================
-- 0085 — "Change class" after an assessment (phase 1: before any payment).
--
-- A parent who has already been assessed sometimes needs a different class:
-- the other curriculum (STD 3 CBSE -> STAGE 3 Cambridge) or one class up
-- (they applied for the class the child is in now, but admissions are for
-- the next academic year). Until now the only tool was the plain class
-- dropdown, which just swapped the label and silently kept the old result
-- and the old curriculum.
--
-- start_class_change keeps everything the parent already entered, keeps the
-- old result as history (assessment_results allows one row per application,
-- so it's moved into the change row), and sends the application back to
-- "awaiting assessment" for the new class. When the teacher records the new
-- result, finish_class_change either lands the change (PASS — the
-- application returns to the stage it was at, skipping the details form if
-- it was already filled) or puts everything back exactly as it was (FAIL).
-- cancel_class_change does the same restore before a result exists.
--
-- Phase 1 only accepts applications with no section and no payment row at
-- all: an existing Razorpay order is priced for the old class, and paid /
-- enrolled applicants also need fee-difference and seat handling (phase 2).
--
-- Every status move here is backward or out of order, so — like 0064, 0071,
-- 0072, 0073 — the functions set app.bypass_status_check for their own
-- transaction only. They take the acting user's id from the server (which
-- gets it from the logged-in session), so EXECUTE is revoked from the
-- browser-facing roles and granted to service_role only.
--
-- Also fixes admin_grant_retest (0073), which left the old slot linked to
-- the application: assessment_slots allows one linked slot per application,
-- so a parent booking their own retest slot always failed with "That slot
-- was just taken" (only admin scheduling worked, because it unlinks first).
-- ============================================================================

create table if not exists application_class_changes (
  id                         uuid primary key default gen_random_uuid(),
  application_id             uuid not null references applications(id) on delete cascade,
  kind                       text not null check (kind in ('curriculum', 'next_class', 'other')),
  from_grade                 text,
  from_category              category_type,
  from_preferred_curriculum  text,
  from_student_curriculum    text,
  from_status                app_status not null,
  to_grade                   text not null,
  to_curriculum              text check (to_curriculum in ('CBSE', 'Cambridge')),
  needs_assessment           boolean not null,
  status                     text not null check (status in ('awaiting_assessment', 'applied', 'failed', 'cancelled')),
  old_result                 jsonb,
  old_slot_id                uuid references assessment_slots(id) on delete set null,
  new_result                 jsonb,
  old_agreement              jsonb,
  reason                     text,
  requested_by               uuid references users(id) on delete set null,
  finished_by                uuid references users(id) on delete set null,
  created_at                 timestamptz not null default now(),
  finished_at                timestamptz
);

create index if not exists idx_class_changes_application
  on application_class_changes(application_id, created_at desc);

-- At most one change waiting for its assessment per application.
create unique index if not exists uq_class_change_open
  on application_class_changes(application_id)
  where status = 'awaiting_assessment';

-- Server-only table: RLS on with no policies, so only service_role (which
-- bypasses RLS) can read or write it.
alter table application_class_changes enable row level security;

-- ---------------------------------------------------------------------------
-- Internal: land a passed change. The application returns to where it was —
-- DETAILS_PENDING if the parent hadn't filled the details form yet (no
-- students row), otherwise AGREEMENT_SENT. An agreement that was already
-- signed named the old class, so it is kept in the change row and reset for
-- the parent to sign again.
-- ---------------------------------------------------------------------------
create or replace function class_change_land(p_change uuid, p_actor uuid)
returns app_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change application_class_changes;
  v_app    applications;
  v_target app_status;
begin
  select * into v_change from application_class_changes where id = p_change for update;
  select * into v_app from applications where id = v_change.application_id for update;

  v_target := case when v_app.student_id is null then 'DETAILS_PENDING'::app_status
                   else 'AGREEMENT_SENT'::app_status end;

  if v_target = 'AGREEMENT_SENT' and v_app.agreement_accepted then
    update application_class_changes
       set old_agreement = jsonb_build_object(
             'accepted_at', v_app.agreement_accepted_at,
             'signature', v_app.agreement_signature,
             'ip', v_app.agreement_ip)
     where id = p_change;
    update applications
       set agreement_accepted = false,
           agreement_accepted_at = null,
           agreement_signature = null,
           agreement_ip = null
     where id = v_app.id;
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = v_target where id = v_app.id;

  update application_class_changes
     set status = 'applied', finished_at = now(), finished_by = p_actor
   where id = p_change;

  return v_target;
end $$;

-- ---------------------------------------------------------------------------
-- Internal: put an application back exactly as it was before the change —
-- class, category, both curriculum fields, the old result, the old slot
-- link and the old status. Any slot linked for the new assessment is
-- unlinked; if it's still in the future it goes back to being bookable.
-- ---------------------------------------------------------------------------
create or replace function class_change_restore(p_change uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_change application_class_changes;
  v_app    applications;
  v_old    assessment_results;
begin
  select * into v_change from application_class_changes where id = p_change for update;
  select * into v_app from applications where id = v_change.application_id for update;

  delete from assessment_results where application_id = v_app.id;
  if v_change.old_result is not null then
    v_old := jsonb_populate_record(null::assessment_results, v_change.old_result);
    -- The result's slot or teacher may have been deleted since; drop the
    -- link rather than fail the whole restore on a foreign key.
    if v_old.slot_id is not null and not exists (select 1 from assessment_slots where id = v_old.slot_id) then
      v_old.slot_id := null;
    end if;
    if v_old.teacher_id is not null and not exists (select 1 from users where id = v_old.teacher_id) then
      v_old.teacher_id := null;
    end if;
    insert into assessment_results select v_old.*;
  end if;

  update assessment_slots
     set application_id = null,
         is_open = starts_at > now(),
         confirmed_at = null,
         reminder_sent = false,
         reminder_2h_sent = false,
         updated_at = now()
   where application_id = v_app.id;
  if v_change.old_slot_id is not null then
    update assessment_slots
       set application_id = v_app.id
     where id = v_change.old_slot_id
       and application_id is null;
  end if;

  if v_app.student_id is not null then
    update students set curriculum = v_change.from_student_curriculum where id = v_app.student_id;
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications
     set grade_applying = v_change.from_grade,
         category = v_change.from_category,
         preferred_curriculum = v_change.from_preferred_curriculum,
         status = v_change.from_status
   where id = v_app.id;
end $$;

-- ---------------------------------------------------------------------------
-- start_class_change — begin a change for an assessed, unpaid application.
-- p_needs_assessment comes from the app's needsAssessment() (only KG 1 is
-- exempt) so the rule lives in one place; when false the change lands
-- straight away.
-- ---------------------------------------------------------------------------
create or replace function start_class_change(
  p_application      uuid,
  p_to_grade         text,
  p_to_curriculum    text,
  p_kind             text,
  p_needs_assessment boolean,
  p_reason           text,
  p_actor            uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app         applications;
  v_student_cur text;
  v_result      assessment_results;
  v_slot_id     uuid;
  v_change_id   uuid;
  v_target      app_status;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;
  if v_app.status not in ('DETAILS_PENDING', 'AGREEMENT_SENT', 'REJECTED') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;
  if exists (select 1 from payments where application_id = p_application) then
    return jsonb_build_object('status', 'PAYMENT_STARTED');
  end if;
  if exists (select 1 from application_class_changes
              where application_id = p_application and status = 'awaiting_assessment') then
    return jsonb_build_object('status', 'CHANGE_OPEN');
  end if;
  if coalesce(trim(p_to_grade), '') = '' then
    return jsonb_build_object('status', 'BAD_GRADE');
  end if;

  if v_app.student_id is not null then
    select curriculum into v_student_cur from students where id = v_app.student_id;
  end if;
  if p_to_grade = v_app.grade_applying
     and p_to_curriculum is not distinct from coalesce(v_student_cur, v_app.preferred_curriculum) then
    return jsonb_build_object('status', 'NO_CHANGE');
  end if;

  select * into v_result from assessment_results where application_id = p_application for update;
  select id into v_slot_id from assessment_slots where application_id = p_application;

  insert into application_class_changes (
    application_id, kind, from_grade, from_category, from_preferred_curriculum,
    from_student_curriculum, from_status, to_grade, to_curriculum, needs_assessment,
    status, old_result, old_slot_id, reason, requested_by
  ) values (
    p_application, p_kind, v_app.grade_applying, v_app.category, v_app.preferred_curriculum,
    v_student_cur, v_app.status, p_to_grade, p_to_curriculum, p_needs_assessment,
    'awaiting_assessment',
    case when v_result.id is null then null else to_jsonb(v_result) end,
    v_slot_id, nullif(trim(p_reason), ''), p_actor
  ) returning id into v_change_id;

  delete from assessment_results where application_id = p_application;
  update assessment_slots set application_id = null where application_id = p_application;

  if v_app.student_id is not null and p_to_curriculum is not null then
    update students set curriculum = p_to_curriculum where id = v_app.student_id;
  end if;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications
     set grade_applying = p_to_grade,
         category = (case when p_to_grade ~* 'kg' then 'KG' else 'GRADE' end)::category_type,
         preferred_curriculum = coalesce(p_to_curriculum, preferred_curriculum),
         status = 'FORM_SUBMITTED'
   where id = p_application;

  if not p_needs_assessment then
    v_target := class_change_land(v_change_id, p_actor);
    return jsonb_build_object('status', 'APPLIED', 'change_id', v_change_id, 'target_status', v_target);
  end if;

  return jsonb_build_object('status', 'STARTED', 'change_id', v_change_id);
end $$;

-- ---------------------------------------------------------------------------
-- finish_class_change — called right after a result is recorded
-- (status ASSESSMENT_COMPLETED). NO_OPEN_CHANGE tells the caller to carry on
-- with the normal result flow.
-- ---------------------------------------------------------------------------
create or replace function finish_class_change(p_application uuid, p_passed boolean, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    applications;
  v_change application_class_changes;
  v_new    assessment_results;
  v_target app_status;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  select * into v_change from application_class_changes
   where application_id = p_application and status = 'awaiting_assessment'
   for update;
  if v_change.id is null then
    return jsonb_build_object('status', 'NO_OPEN_CHANGE');
  end if;
  if v_app.status <> 'ASSESSMENT_COMPLETED' then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;

  if p_passed then
    v_target := class_change_land(v_change.id, p_actor);
    return jsonb_build_object(
      'status', 'APPLIED', 'change_id', v_change.id, 'target_status', v_target,
      'from_grade', v_change.from_grade, 'to_grade', v_change.to_grade,
      'to_curriculum', v_change.to_curriculum);
  end if;

  select * into v_new from assessment_results where application_id = p_application;
  update application_class_changes
     set new_result = case when v_new.id is null then null else to_jsonb(v_new) end
   where id = v_change.id;
  perform class_change_restore(v_change.id);
  update application_class_changes
     set status = 'failed', finished_at = now(), finished_by = p_actor
   where id = v_change.id;

  return jsonb_build_object(
    'status', 'REVERTED', 'change_id', v_change.id, 'restored_status', v_change.from_status,
    'from_grade', v_change.from_grade, 'to_grade', v_change.to_grade,
    'to_curriculum', v_change.to_curriculum);
end $$;

-- ---------------------------------------------------------------------------
-- cancel_class_change — admin changes their mind before the new result.
-- ---------------------------------------------------------------------------
create or replace function cancel_class_change(p_application uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    applications;
  v_change application_class_changes;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  select * into v_change from application_class_changes
   where application_id = p_application and status = 'awaiting_assessment'
   for update;
  if v_change.id is null then
    return jsonb_build_object('status', 'NO_OPEN_CHANGE');
  end if;
  if v_app.status not in ('FORM_SUBMITTED', 'ASSESSMENT_SCHEDULED') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;

  perform class_change_restore(v_change.id);
  update application_class_changes
     set status = 'cancelled', finished_at = now(), finished_by = p_actor
   where id = v_change.id;

  return jsonb_build_object('status', 'CANCELLED', 'change_id', v_change.id, 'restored_status', v_change.from_status);
end $$;

-- ---------------------------------------------------------------------------
-- admin_grant_retest (0073) — now also unlinks the old slot, so the parent
-- can book the retest themselves. Otherwise unchanged.
-- ---------------------------------------------------------------------------
create or replace function admin_grant_retest(p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app    applications;
  v_result assessment_results;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_app.status <> 'REJECTED' then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;

  select * into v_result from assessment_results where application_id = p_application for update;
  delete from assessment_results where application_id = p_application;
  update assessment_slots set application_id = null where application_id = p_application;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'FORM_SUBMITTED' where id = p_application;

  return jsonb_build_object(
    'status', 'OK',
    'previous_outcome', v_result.outcome,
    'previous_remarks', v_result.remarks
  );
end $$;

-- ---------------------------------------------------------------------------
-- Server only. Supabase grants EXECUTE on new public functions to anon and
-- authenticated by default, which would let anyone with the browser key
-- call these with any actor id.
-- ---------------------------------------------------------------------------
revoke all on function class_change_land(uuid, uuid) from public, anon, authenticated;
revoke all on function class_change_restore(uuid) from public, anon, authenticated;
revoke all on function start_class_change(uuid, text, text, text, boolean, text, uuid) from public, anon, authenticated;
revoke all on function finish_class_change(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function cancel_class_change(uuid, uuid) from public, anon, authenticated;
revoke all on function admin_grant_retest(uuid) from public, anon, authenticated;

grant execute on function start_class_change(uuid, text, text, text, boolean, text, uuid) to service_role;
grant execute on function finish_class_change(uuid, boolean, uuid) to service_role;
grant execute on function cancel_class_change(uuid, uuid) to service_role;
grant execute on function admin_grant_retest(uuid) to service_role;
