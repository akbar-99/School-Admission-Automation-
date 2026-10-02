-- handlePaymentCompleted can be interrupted mid-flight (a proxy/gateway
-- timeout while it's still working through notifications, ERP sync, and
-- Google Sheets export — all genuinely slow, external-call-backed steps).
-- Previously a second call for the same application was treated as fully
-- done the moment admission_number was set, silently abandoning whatever
-- hadn't finished yet (a parent who never got their WhatsApp/email
-- confirmation, a student never synced to the ERP or Sheets, with no record
-- anywhere that anything was missing). This lets enroll_application be
-- called again on an already-ENROLLED application instead of raising
-- NOT_READY_FOR_ENROLLMENT, and gives the app code a way to know whether
-- the Sheets export specifically already succeeded.
alter table applications
  add column if not exists google_sheet_synced boolean not null default false;

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
  v_adm        text;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if v_app.status not in ('PAYMENT_COMPLETED', 'NEEDS_ADMIN', 'ENROLLED') then
    raise exception 'NOT_READY_FOR_ENROLLMENT: %', v_app.status using errcode = 'check_violation';
  end if;
  if v_app.admission_number is not null then
    select name into v_section_nm from sections where id = v_app.section_id;
    return jsonb_build_object(
      'status', 'ENROLLED',
      'admission_number', v_app.admission_number,
      'section_id', v_app.section_id,
      'section', coalesce(v_app.grade_applying, v_app.category::text, 'KG') || '-' || coalesce(v_section_nm, '?'),
      'already', true
    );
  end if;

  v_grade := coalesce(v_app.grade_applying, v_app.category::text, 'KG');

  select id, name into v_section_id, v_section_nm
    from sections
   where grade = v_grade and filled < capacity
   order by name
   for update skip locked
   limit 1;

  perform set_config('app.bypass_status_check', 'on', true);

  if v_section_id is null then
    update applications set status = 'NEEDS_ADMIN' where id = p_application;
    return jsonb_build_object('status', 'NEEDS_ADMIN', 'grade', v_grade);
  end if;

  update sections set filled = filled + 1 where id = v_section_id;
  v_adm := next_broadway_admission_number();

  update applications
     set status = 'ENROLLED', section_id = v_section_id, admission_number = v_adm
   where id = p_application;

  return jsonb_build_object(
    'status', 'ENROLLED',
    'admission_number', v_adm,
    'section_id', v_section_id,
    'section', v_grade || '-' || v_section_nm
  );
end $$;
