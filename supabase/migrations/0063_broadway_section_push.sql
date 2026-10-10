-- ============================================================================
-- Revision: sections are still made in the tracker (Admin → Sections), and
-- every one saved is now PUSHED to Broadway (POST /classes), not just linked
-- to a class picked from a cache. 0062 already added sections.broadway_class_id
-- / broadway_class_name for the earlier "link to an existing Broadway class"
-- design — those columns are reused as-is here (same meaning: Broadway's
-- class id / Broadway's own returned name), now populated from the push
-- response instead of an admin-chosen dropdown.
-- ============================================================================

-- The admin-typed class name sent to Broadway as `erpClassName` (the field
-- that encodes curriculum — STD.../STAGE... or an explicit CBSE/Cambridge
-- for KG). Kept separate from broadway_class_name (Broadway's own returned,
-- prettified name) since the two can differ in format and only this one is
-- safe to resend.
alter table sections add column if not exists broadway_input_name text;
alter table sections add column if not exists broadway_sync_status text not null default 'pending'
  check (broadway_sync_status in ('pending', 'synced', 'failed'));
alter table sections add column if not exists broadway_warning text;
alter table sections add column if not exists broadway_error text;

-- GET /classes now also returns trackerId (this app's own section id, for
-- classes it sent) and the current/next academic year labels (duplicated
-- onto every cached row — simplest way to carry one global value alongside
-- a cache table without a second settings round-trip).
alter table broadway_classes add column if not exists tracker_id text;
alter table broadway_classes add column if not exists academic_year_current text;
alter table broadway_classes add column if not exists academic_year_next text;

-- ---------------------------------------------------------------------------
-- enroll_application — redefined again to also treat a linked section as
-- full once *Broadway's* own student count for it (this year's or next
-- year's, whichever this admission cycle is running) reaches capacity, not
-- just this app's own `filled` counter. A section's local `filled` only
-- counts students the tracker itself enrolled; Broadway's number is the
-- superset (it also includes students added directly in Broadway, and next
-- year's continuing/joining students the tracker has no other way to know
-- about). Takes the greater of the two rather than trusting either alone,
-- so a section is never offered as open when Broadway already considers it
-- full, and a Broadway cache miss/lag never blocks fill order that local
-- data alone would have allowed. p_use_next_year selects which of
-- Broadway's two counts applies — the app resolves that once per enrollment
-- batch (comparing ADMISSION_YEAR against Broadway's cached current/next
-- academic year), not per application.
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE matches by name + argument list — adding a third
-- parameter would overload rather than replace the old 2-arg version, so
-- drop that signature explicitly first (same precedent as 0024's
-- `drop function if exists claim_erp_seat(text)`).
drop function if exists enroll_application(uuid, int);

create or replace function enroll_application(p_application uuid, p_year int, p_use_next_year boolean default false)
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
  v_section_batch text;
  v_adm        text;
  v_was_needs  boolean;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    raise exception 'APPLICATION_NOT_FOUND';
  end if;
  if v_app.status not in ('PAYMENT_COMPLETED', 'NEEDS_ADMIN') then
    raise exception 'NOT_READY_FOR_ENROLLMENT: %', v_app.status using errcode = 'check_violation';
  end if;
  if v_app.admission_number is not null then
    return jsonb_build_object('status', 'ENROLLED', 'admission_number', v_app.admission_number,
                              'section_id', v_app.section_id, 'already', true);
  end if;

  v_was_needs := (v_app.status = 'NEEDS_ADMIN');
  v_grade := coalesce(v_app.grade_applying, v_app.category::text, 'KG');

  -- Sections matching the parent's preferred timing sort first (still
  -- A -> B -> C / batch order among themselves); everything else follows in
  -- the same order as before. A section is skipped once GREATEST(local
  -- filled, Broadway's own count for it) reaches capacity.
  select s.id, s.name, s.batch into v_section_id, v_section_nm, v_section_batch
    from sections s
    left join broadway_classes bc on bc.id = s.broadway_class_id
   where s.grade = v_grade
     and greatest(
           s.filled,
           coalesce(case when p_use_next_year then bc.next_year_students else bc.this_year_students end, 0)
         ) < s.capacity
   order by
     case when v_app.preferred_class_timing is not null
               and s.class_timing = v_app.preferred_class_timing
          then 0 else 1 end,
     s.name, coalesce(s.batch, '')
   for update
   limit 1;

  perform set_config('app.bypass_status_check', 'on', true);

  if v_section_id is null then
    update applications set status = 'NEEDS_ADMIN' where id = p_application;
    return jsonb_build_object('status', 'NEEDS_ADMIN', 'grade', v_grade, 'already', v_was_needs);
  end if;

  update sections set filled = filled + 1 where id = v_section_id;
  v_adm := next_admission_number(p_year, v_grade);

  update applications
     set status = 'ENROLLED', section_id = v_section_id, admission_number = v_adm
   where id = p_application;

  return jsonb_build_object(
    'status', 'ENROLLED',
    'admission_number', v_adm,
    'section_id', v_section_id,
    'section', v_grade || '-' || v_section_nm || coalesce(' - ' || v_section_batch, '')
  );
end $$;
