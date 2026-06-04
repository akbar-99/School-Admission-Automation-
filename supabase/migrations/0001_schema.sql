-- ============================================================================
-- Online School Admission Automation System — Schema (SRS §5)
-- Tables, enums, status machine, timestamps on every row.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('marketing','parent','teacher','admin','class_teacher');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Application state machine (SRS §2.3)
  create type app_status as enum (
    'LEAD_CREATED','FORM_SUBMITTED','ASSESSMENT_SCHEDULED','ASSESSMENT_COMPLETED',
    'AGREEMENT_SENT','PAYMENT_PENDING','PAYMENT_COMPLETED','PAYMENT_FAILED',
    'ABANDONED','ENROLLED','NEEDS_ADMIN','REJECTED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type category_type as enum ('KG','GRADE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gender_type as enum ('male','female','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type assessment_outcome as enum ('PASS','FAIL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_state as enum ('created','pending','completed','failed','abandoned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_channel as enum ('email','sms','whatsapp');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_status as enum ('queued','sent','failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------------------
-- app_config — configurable values (cutoff date, age bands, capacity, fee)
-- ---------------------------------------------------------------------------
create table if not exists app_config (
  key         text primary key,
  value       text not null,
  description text,
  updated_at  timestamptz not null default now()
);
create trigger trg_app_config_updated before update on app_config
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- users — staff accounts; id maps to auth.users (SRS roles §2.2)
-- ---------------------------------------------------------------------------
create table if not exists users (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       user_role not null,
  full_name  text,
  email      text,
  phone      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_users_updated before update on users
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------
create table if not exists parents (
  id         uuid primary key default gen_random_uuid(),
  full_name  text not null,
  email      text,
  phone      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_parents_updated before update on parents
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
create table if not exists students (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid not null references parents(id) on delete cascade,
  full_name       text not null,
  dob             date not null,
  gender          gender_type,
  previous_school text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_students_updated before update on students
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- sections — class divisions with capacity (SRS FR-22)
-- ---------------------------------------------------------------------------
create table if not exists sections (
  id         uuid primary key default gen_random_uuid(),
  grade      text not null,
  name       text not null,
  capacity   integer not null default 30 check (capacity > 0),
  filled     integer not null default 0 check (filled >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (grade, name),
  check (filled <= capacity)
);
create trigger trg_sections_updated before update on sections
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- applications — central entity carrying the status machine
-- ---------------------------------------------------------------------------
create table if not exists applications (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid not null references parents(id) on delete cascade,
  student_id       uuid references students(id) on delete set null,
  status           app_status not null default 'LEAD_CREATED',
  category         category_type,
  grade_applying   text,
  documents        jsonb not null default '[]'::jsonb,
  consent_accepted boolean not null default false,
  consent_at       timestamptz,
  section_id       uuid references sections(id) on delete set null,
  admission_number text unique,
  -- secure, expirable admission link (SRS FR-2)
  access_token     text not null unique default encode(gen_random_bytes(24),'hex'),
  token_expires_at timestamptz not null default (now() + interval '14 days'),
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger trg_applications_updated before update on applications
  for each row execute function set_updated_at();
create index if not exists idx_applications_status on applications(status);
create index if not exists idx_applications_parent on applications(parent_id);

-- ---------------------------------------------------------------------------
-- assessment_slots — teacher-opened slots; atomic booking (SRS FR-10..13)
-- ---------------------------------------------------------------------------
create table if not exists assessment_slots (
  id             uuid primary key default gen_random_uuid(),
  teacher_id     uuid not null references users(id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  is_open        boolean not null default true,
  application_id uuid references applications(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (ends_at > starts_at)
);
create trigger trg_slots_updated before update on assessment_slots
  for each row execute function set_updated_at();
-- one application may book at most one slot
create unique index if not exists uq_slot_application
  on assessment_slots(application_id) where application_id is not null;
create index if not exists idx_slots_open on assessment_slots(is_open, starts_at);

-- ---------------------------------------------------------------------------
-- assessment_results (SRS FR-14, FR-15a)
-- ---------------------------------------------------------------------------
create table if not exists assessment_results (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references applications(id) on delete cascade,
  slot_id        uuid references assessment_slots(id) on delete set null,
  teacher_id     uuid references users(id) on delete set null,
  outcome        assessment_outcome not null,
  remarks        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_results_updated before update on assessment_results
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- payments — Razorpay; status set only via verified webhook (SRS FR-20)
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references applications(id) on delete cascade,
  razorpay_order_id  text unique,
  razorpay_payment_id text,
  razorpay_signature text,
  amount             integer not null,           -- in paise
  currency           text not null default 'INR',
  status             payment_state not null default 'created',
  receipt            text,
  notes              jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_payments_updated before update on payments
  for each row execute function set_updated_at();
create index if not exists idx_payments_application on payments(application_id);

-- ---------------------------------------------------------------------------
-- admission_numbers — atomic running counter per (year, grade) (SRS FR-21)
-- ---------------------------------------------------------------------------
create table if not exists admission_numbers (
  id          bigserial primary key,
  year        integer not null,
  grade       text not null,
  last_number integer not null default 0,
  updated_at  timestamptz not null default now(),
  unique (year, grade)
);
create trigger trg_admno_updated before update on admission_numbers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- notifications — every lifecycle event (SRS §3.7)
-- ---------------------------------------------------------------------------
create table if not exists notifications (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid references applications(id) on delete cascade,
  event          text not null,                  -- N-1 .. N-10
  channel        notification_channel not null,
  recipient      text not null,
  subject        text,
  body           text,
  payload        jsonb,
  status         notification_status not null default 'queued',
  error          text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_notifications_application on notifications(application_id);

-- ---------------------------------------------------------------------------
-- audit_logs — who changed what and when (SRS §5, DPDP traceability)
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id         bigserial primary key,
  actor_id   uuid,
  actor_role text,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_logs(entity, entity_id);
