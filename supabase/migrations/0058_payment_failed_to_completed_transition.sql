-- Standard Checkout (unlike the old Hosted Checkout) lets the SAME order
-- receive multiple payment attempts in one session — a declined card, then a
-- successful retry, both under one order_id. A failed sub-attempt correctly
-- flips the application to PAYMENT_FAILED; when the very next attempt on
-- that same order succeeds, the application must be able to advance straight
-- to PAYMENT_COMPLETED instead of getting stuck, since PAYMENT_FAILED here
-- was never a final/terminal outcome. See markPaymentCompleted in
-- src/lib/payments.ts, which now relies on this transition being valid.
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
    when 'PAYMENT_FAILED'       then new.status in ('PAYMENT_PENDING','ABANDONED','PAYMENT_COMPLETED')
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
