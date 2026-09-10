-- ============================================================================
-- 2-hours-before assessment reminder, with a confirm link and a reschedule
-- link. Reschedule needs to release the slot and send the application back
-- to FORM_SUBMITTED so the SlotPicker shows again — a new backward
-- transition, so the state machine needs to allow it explicitly.
-- ============================================================================
alter table assessment_slots add column if not exists reminder_2h_sent boolean not null default false;
alter table assessment_slots add column if not exists confirmed_at timestamptz;

create index if not exists idx_assessment_slots_reminder_2h
  on assessment_slots (starts_at)
  where reminder_2h_sent = false and application_id is not null;

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
    when 'FORM_SUBMITTED'       then new.status in ('ASSESSMENT_SCHEDULED','DETAILS_PENDING')
    when 'ASSESSMENT_SCHEDULED' then new.status in ('ASSESSMENT_COMPLETED','FORM_SUBMITTED')
    when 'ASSESSMENT_COMPLETED' then new.status in ('DETAILS_PENDING','REJECTED')
    when 'DETAILS_PENDING'      then new.status in ('AGREEMENT_SENT')
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

-- Releases the parent's currently-booked slot back into the open pool and
-- sends the application back to FORM_SUBMITTED so they can pick a new one.
-- Blocked once the slot has already started — that's a no-show, not a
-- reschedule, and needs a human either way.
create or replace function release_assessment_slot(p_application uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot assessment_slots;
begin
  select * into v_slot from assessment_slots where application_id = p_application for update;
  if v_slot.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_slot.starts_at <= now() then
    return jsonb_build_object('status', 'TOO_LATE');
  end if;

  update assessment_slots
     set application_id = null,
         is_open = true,
         confirmed_at = null,
         reminder_sent = false,
         reminder_2h_sent = false,
         updated_at = now()
   where id = v_slot.id;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'FORM_SUBMITTED' where id = p_application;

  return jsonb_build_object('status', 'RELEASED', 'slot_id', v_slot.id, 'teacher_id', v_slot.teacher_id, 'starts_at', v_slot.starts_at);
end $$;
