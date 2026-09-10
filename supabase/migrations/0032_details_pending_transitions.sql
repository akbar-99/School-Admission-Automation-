-- ============================================================================
-- Wire DETAILS_PENDING into the state machine, and add applications.reported_age
-- for the minimal form's rough self-reported age (the precise DOB is only
-- collected later, in the remaining-details form).
-- ============================================================================
alter table applications add column if not exists reported_age integer;

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
    when 'ASSESSMENT_SCHEDULED' then new.status in ('ASSESSMENT_COMPLETED')
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
