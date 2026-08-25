-- Removing a staff member bans their auth account (revokes login) rather than
-- deleting it — users.id cascades from auth.users, and assessment_slots /
-- assessment_results reference users.id, so a hard delete would wipe their
-- assessment history. `disabled` just tracks that ban for UI filtering.
alter table users
  add column if not exists disabled boolean not null default false;

create index if not exists idx_users_role_disabled on users(role, disabled);
