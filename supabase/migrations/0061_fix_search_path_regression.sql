-- enforce_status_transition and extend_token_on_status_change were already
-- hardened against search_path hijacking once (0039_fix_search_path.sql, via
-- ALTER FUNCTION ... SET search_path = public), but ALTER FUNCTION's setting
-- doesn't survive a later CREATE OR REPLACE — 0058 and 0060 each redefined
-- one of these two functions for unrelated reasons and silently dropped the
-- protection, since neither included `set search_path` in its own
-- definition. Re-applying it directly inside each function's own
-- CREATE OR REPLACE this time (not as a separate ALTER afterward) so it's
-- part of the function's actual source and can't be silently lost by a
-- future edit that doesn't know to re-add a separate ALTER statement.

create or replace function enforce_status_transition() returns trigger
language plpgsql
set search_path = public
as $$
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

create or replace function extend_token_on_status_change() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    new.token_expires_at := now() + interval '6 months';
  end if;
  return new;
end $$;
