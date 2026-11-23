-- ============================================================================
-- Rollback for 0085_class_change.sql. Run in the SQL Editor only if 0085
-- has to be undone.
--
-- 1. Any class change still waiting for its assessment is put back first
--    (class, curriculum, old result, old slot, old status) so no applicant is
--    left half-changed when the history table disappears.
-- 2. The new functions and the history table are dropped. Applied, failed
--    and cancelled changes keep their effect on the applications; only the
--    history rows are lost (the audit log still has the start/finish events).
-- 3. admin_grant_retest goes back to the 0073 version (old slot left linked).
--    Its EXECUTE stays limited to service_role — re-opening it to the
--    browser-facing roles would only bring back a security hole; the app
--    calls it from the server.
-- ============================================================================

do $$
declare
  v_change record;
begin
  if to_regclass('public.application_class_changes') is null then
    return;
  end if;
  for v_change in
    select id from application_class_changes where status = 'awaiting_assessment'
  loop
    perform class_change_restore(v_change.id);
    update application_class_changes set status = 'cancelled', finished_at = now() where id = v_change.id;
  end loop;
end $$;

drop function if exists start_class_change(uuid, text, text, text, boolean, text, uuid);
drop function if exists finish_class_change(uuid, boolean, uuid);
drop function if exists cancel_class_change(uuid, uuid);
drop function if exists class_change_land(uuid, uuid);
drop function if exists class_change_restore(uuid);
drop table if exists application_class_changes;

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

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'FORM_SUBMITTED' where id = p_application;

  return jsonb_build_object(
    'status', 'OK',
    'previous_outcome', v_result.outcome,
    'previous_remarks', v_result.remarks
  );
end $$;
