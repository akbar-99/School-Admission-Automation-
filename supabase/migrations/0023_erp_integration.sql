-- ============================================================================
-- ERP integration: auto-create a student record in the school ERP on
-- admission. This is additive and fully separate from this app's own
-- sections/seat-allocation system (applications.status, section_id,
-- admission_number) — the ERP has its own, independent notion of class
-- capacity that this migration tracks in parallel.
-- ============================================================================

-- Cached mirror of the ERP's capacity endpoint, refreshed by sync (manual
-- admin button + periodic external-cron poll). This is the ONLY place
-- capacity is read from when claiming a seat — the ERP is never called live
-- during an admission.
create table if not exists erp_classes (
  class_name          text primary key,        -- exact ERP class_name, used verbatim in the webhook
  base                text not null,            -- e.g. "STAGE 1", "KG 1"
  division            text not null,            -- e.g. "A"
  batch               text,                     -- e.g. "DAHLIA"; null for non-KG
  is_kg               boolean not null default false,
  capacity            integer not null,
  enrolled            integer not null default 0,   -- last-synced ERP "enrolled" count
  admitted_since_sync integer not null default 0,   -- this app's own running tally since that sync
  synced_at           timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_erp_classes_base on erp_classes(base);
alter table erp_classes enable row level security;
create policy erp_classes_admin_read on erp_classes for select to authenticated
  using (public.is_admin());

-- Admin-editable mapping from this app's grade_applying values to the ERP's
-- base class names (they don't match 1:1 — e.g. this app's "G5" vs the ERP's
-- "STAGE 5"). Seeded empty; must be filled in per grade before that grade's
-- admissions can sync — an unmapped grade routes to the review queue rather
-- than guessing.
create table if not exists erp_grade_map (
  app_grade  text primary key,
  erp_base   text not null,
  updated_at timestamptz not null default now()
);
alter table erp_grade_map enable row level security;
create policy erp_grade_map_admin_read on erp_grade_map for select to authenticated
  using (public.is_admin());

-- Per-application ERP sync outcome. Fully separate from `status`/`section_id`
-- (this app's own state machine) — not touched by enforce_status_transition.
alter table applications add column if not exists erp_status text not null default 'pending'
  check (erp_status in ('pending','no_mapping','no_capacity','send_failed','synced'));
alter table applications add column if not exists erp_class_name text;   -- set once a seat is claimed
alter table applications add column if not exists erp_student_id text;   -- ERP's returned id, once synced
alter table applications add column if not exists erp_warning text;      -- non-null warning from a synced response

create index if not exists idx_applications_erp_status on applications(erp_status)
  where erp_status != 'synced';

-- ---------------------------------------------------------------------------
-- claim_erp_seat — atomically pick the next division/batch with room for a
-- base class, filling one to capacity before the next (division, then batch,
-- alphabetically) under concurrency. Plain `for update` (not `skip locked`) —
-- same reasoning as enroll_application: we need strict fill order, not
-- "first free row wins".
-- ---------------------------------------------------------------------------
create or replace function claim_erp_seat(p_base text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_name text;
begin
  select class_name into v_class_name
    from erp_classes
   where base = p_base
     and (capacity - enrolled - admitted_since_sync) > 0
   order by division, coalesce(batch, '')
   for update
   limit 1;

  if v_class_name is null then
    return jsonb_build_object('status', 'FULL');
  end if;

  update erp_classes
     set admitted_since_sync = admitted_since_sync + 1, updated_at = now()
   where class_name = v_class_name;

  return jsonb_build_object('status', 'CLAIMED', 'class_name', v_class_name);
end $$;
