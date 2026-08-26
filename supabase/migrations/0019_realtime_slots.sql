-- Enable Realtime (Postgres Changes) on assessment_slots so the teacher
-- portal can pop up a live alert the instant a parent books one of a
-- teacher's slots (or a slot is (re)assigned to them), without polling.
-- RLS already allows any staff to SELECT this table (0003_rls.sql), which
-- Realtime honors — the client subscription further filters to teacher_id.
--
-- REPLICA IDENTITY FULL so UPDATE events carry the full "old" row (default
-- replica identity only includes the primary key), which the client needs to
-- diff old.application_id/teacher_id against new to tell "booked" apart from
-- "self-claimed".
alter table assessment_slots replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'assessment_slots'
  ) then
    alter publication supabase_realtime add table assessment_slots;
  end if;
end $$;
