-- Study material is a second, separate payment from the admission fee, and
-- (unlike the flat admission fee) its amount varies by grade.
create table if not exists study_material_fees (
  grade      text primary key,
  fee_paise  integer not null default 0,
  updated_at timestamptz not null default now()
);
create trigger trg_study_material_fees_updated before update on study_material_fees
  for each row execute function set_updated_at();

-- Each payment/order can now cover admission, study material, or (typically)
-- both together — admission_amount/study_material_amount are a snapshot of
-- what was actually charged for each component at the time, independent of
-- whatever the current settings say later. `amount` (existing column)
-- remains the total charged, unchanged in meaning.
alter table payments add column if not exists includes_admission boolean not null default true;
alter table payments add column if not exists includes_study_material boolean not null default false;
alter table payments add column if not exists admission_amount integer not null default 0;
alter table payments add column if not exists study_material_amount integer not null default 0;

-- Every payment before this migration was admission-only; backfill the
-- snapshot so historical records stay consistent with the new columns.
update payments set admission_amount = amount where admission_amount = 0 and amount > 0;

-- Study material can be paid later, separately from admission (a parent may
-- decline it at the main payment step and pay afterward from their portal),
-- so it needs its own standalone completion flag rather than being inferred
-- from the application's overall status.
alter table applications add column if not exists study_material_paid boolean not null default false;
