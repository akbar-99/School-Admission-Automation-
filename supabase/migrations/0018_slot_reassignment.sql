-- A teacher can flag a booked assessment slot as "can't attend" so the admin
-- sees it needs reassigning to another teacher (see reportUnavailable /
-- reassignSlotTeacher).
alter table assessment_slots
  add column if not exists unavailable_reported boolean not null default false,
  add column if not exists unavailable_reported_at timestamptz;

create index if not exists idx_slots_unavailable
  on assessment_slots(unavailable_reported)
  where unavailable_reported = true;
