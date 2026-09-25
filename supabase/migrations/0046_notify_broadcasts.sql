-- Lets an admin opt a specific staff account out of role-broadcast
-- notifications (fanToStaff / staffContacts) — for someone who holds two
-- accounts (e.g. an "admin" account purely for elevated permissions, plus a
-- separate "marketing" account they actually work from on the same phone),
-- so the admin-role broadcasts don't also land on a phone that's really
-- there for marketing-specific messages. Defaults to true so every existing
-- and new staff account keeps today's behavior unless explicitly turned off.
alter table users add column if not exists notify_broadcasts boolean not null default true;
