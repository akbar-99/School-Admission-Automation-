-- Two-way Facebook Page Messenger chat thread per lead, identical shape to
-- instagram_messages (0052) — including the unique index on
-- provider_message_id from the start, which had to be backported for
-- Instagram in migration 0055 after hitting a dedup gap.
create table if not exists facebook_messages (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references applications(id) on delete cascade,
  direction            text not null check (direction in ('inbound','outbound')),
  message_text         text not null,
  provider_message_id  text,
  sent_by              uuid references users(id) on delete set null, -- null for inbound or an app-typed echo
  created_at           timestamptz not null default now()
);
create index if not exists idx_facebook_messages_application
  on facebook_messages(application_id, created_at);
create unique index if not exists uq_facebook_messages_provider_id
  on facebook_messages(provider_message_id);

alter table facebook_messages enable row level security;
create policy "staff can read facebook_messages" on facebook_messages
  for select using (public.is_staff());
