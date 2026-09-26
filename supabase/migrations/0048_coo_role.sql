-- New "coo" role: full admin-equivalent access, plus a dedicated
-- cross-team performance dashboard (src/app/admin/coo-dashboard).
-- Run as two separate statements/pastes — Postgres won't allow a new enum
-- value to be used in the same transaction that adds it.
alter type user_role add value if not exists 'coo';
