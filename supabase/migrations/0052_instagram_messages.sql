-- Two-way Instagram chat thread per lead. Purely additive — doesn't touch
-- any existing table's meaning or the capture/claim flow already built.
create table if not exists instagram_messages (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references applications(id) on delete cascade,
  direction            text not null check (direction in ('inbound','outbound')),
  message_text         text not null,
  provider_message_id  text,
  sent_by              uuid references users(id) on delete set null, -- null for inbound
  created_at           timestamptz not null default now()
);
create index if not exists idx_instagram_messages_application
  on instagram_messages(application_id, created_at);

alter table instagram_messages enable row level security;
create policy "staff can read instagram_messages" on instagram_messages
  for select using (public.is_staff());
