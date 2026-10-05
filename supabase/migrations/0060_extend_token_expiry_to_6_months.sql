-- Admission links were expiring after 14 days, too short for some families.
-- Extended to 6 months everywhere the duration is set: the column default
-- (new applications), the auto-refresh-on-progress trigger (0033), and a
-- one-time extension of every currently non-terminal application's link so
-- already-sent links benefit too, not just new ones going forward.

alter table applications
  alter column token_expires_at set default (now() + interval '6 months');

create or replace function extend_token_on_status_change() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    new.token_expires_at := now() + interval '6 months';
  end if;
  return new;
end $$;

update applications
   set token_expires_at = now() + interval '6 months'
 where status not in ('ENROLLED', 'REJECTED', 'ABANDONED');
