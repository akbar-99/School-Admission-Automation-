-- A withdrawal is layered on top of whatever status the application already
-- reached (payment/admission/added to course) — it never overwrites
-- `status`, so historical funnel stats stay accurate. pre_admission = paid
-- but never added to the class roster (erp_status != synced) at the moment
-- of withdrawal; post_admission = already added to the roster and then
-- discontinued.
alter table applications
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawal_type text check (withdrawal_type in ('pre_admission', 'post_admission')),
  add column if not exists withdrawal_reason text,
  add column if not exists withdrawn_by uuid references users(id);

create index if not exists idx_applications_withdrawn on applications(withdrawn_at) where withdrawn_at is not null;
