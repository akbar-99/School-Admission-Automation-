-- ============================================================================
-- ERP integration, take 2: the live ERP data doesn't actually group non-KG
-- divisions under a shared "base" (each is its own singleton, base ==
-- class_name) — so claim_erp_seat/erp_grade_map from 0023 can never deliver
-- real auto-fill for STAGE/STD. This app's own `sections` already has a
-- working, fill-ordered division system (enroll_application) — so instead of
-- re-deriving allocation from the ERP's capacity numbers, this app's own
-- sections become the source of truth for which division a student lands in,
-- and each section just carries the exact ERP class_name it corresponds to.
-- ============================================================================

-- KG sections now also carry a batch (e.g. "DAHLIA") alongside the existing
-- division `name` — real KG data shows multiple batches can share the same
-- division letter (e.g. "KG 2"+"C" has TULIP, BLUEBELL and ROSE as separate
-- batches), so uniqueness must include batch, not just (grade, name).
alter table sections add column if not exists batch text;
alter table sections drop constraint if exists sections_grade_name_key;
create unique index if not exists sections_grade_name_batch_key
  on sections (grade, name, coalesce(batch, ''));

-- The exact ERP class_name this section corresponds to. Admin-set per
-- section (Admin → Sections); null until configured, which routes that
-- section's admissions to the review queue rather than guessing.
alter table sections add column if not exists erp_class_name text;

-- claim_erp_seat/erp_grade_map (0023) are no longer used — allocation is this
-- app's own sections now, not a separate ERP-capacity race.
drop function if exists claim_erp_seat(text);
drop table if exists erp_grade_map;

-- "no_capacity" is no longer a distinct ERP outcome — a full section is
-- already handled by the existing NEEDS_ADMIN application status before ERP
-- sync is ever reached.
alter table applications drop constraint if exists applications_erp_status_check;
alter table applications add constraint applications_erp_status_check
  check (erp_status in ('pending','no_mapping','send_failed','synced'));
update applications set erp_status = 'no_mapping' where erp_status = 'no_capacity';

-- ---------------------------------------------------------------------------
-- enroll_application — redefined again (following the 0005 precedent) to
-- also consider `batch` in fill order and to return it, without changing any
-- other behavior. Ties (same division name, different batch) are broken
-- alphabetically by batch, same reasoning as before: strict, deterministic
-- fill order under concurrency.
-- ---------------------------------------------------------------------------
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

  -- first section with space (A -> B -> C, batch alphabetically within a tied
  -- division), row-locked to avoid over-fill. Plain FOR UPDATE (no SKIP
  -- LOCKED) preserves strict ordering under concurrency.
  select id, name, batch into v_section_id, v_section_nm, v_section_batch
    from sections
   where grade = v_grade and filled < capacity
   order by name, coalesce(batch, '')
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
