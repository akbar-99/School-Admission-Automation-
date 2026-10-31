-- Fair-share weekly cap on self-claimed open assessment slots, so one fast
-- teacher can't grab most of a week's open pool and leave the rest with
-- almost none. Per teacher, per week (Mon-Sun, school time): cap = ceil(total
-- open-pool slots that week / number of active teachers) — e.g. 50 open
-- slots and 5 teachers => 10 each; 5 open slots and 5 teachers => 1 each.
-- Self-adjusts as the admin opens more slots through the week.
--
-- Escape hatch: a slot still unclaimed 24h after it was opened becomes
-- free-for-all — any teacher can take it even if they're already at their
-- cap — so a teacher who's slow to claim doesn't leave real capacity idle.

alter table assessment_slots
  add column if not exists claimed_at timestamptz;

-- Backfill: no exact claim time exists for already-claimed slots, so
-- `updated_at` (last touched, which for most of these is the claim itself)
-- is the closest available approximation.
update assessment_slots
   set claimed_at = updated_at
 where claimed_by_teacher = true
   and claimed_at is null;

create or replace function claim_assessment_slot(p_slot uuid, p_teacher uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target assessment_slots;
  v_week_start timestamptz;
  v_week_end timestamptz;
  v_teacher_count int;
  v_week_total int;
  v_cap int;
  v_teacher_claimed int;
  v_free_for_all boolean;
begin
  select * into v_target
    from assessment_slots
   where id = p_slot
     and teacher_id is null
     and application_id is null
     and is_open = true
     and starts_at > now()
   for update;

  if v_target.id is null then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'check_violation';
  end if;

  v_free_for_all := v_target.created_at <= now() - interval '24 hours';

  if not v_free_for_all then
    v_week_start := date_trunc('week', v_target.starts_at at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    v_week_end := v_week_start + interval '7 days';

    select count(*) into v_teacher_count
      from users
     where role = 'teacher' and not disabled;

    -- Total open-pool slots for that week: already claimed by some teacher,
    -- plus still sitting open. Excludes slots admin assigned directly to one
    -- teacher at creation time (those never go through this fair-share pool).
    select count(*) into v_week_total
      from assessment_slots
     where application_id is null
       and starts_at >= v_week_start
       and starts_at < v_week_end
       and (claimed_by_teacher = true or (teacher_id is null and is_open = true));

    v_cap := ceil(v_week_total::numeric / greatest(v_teacher_count, 1));

    select count(*) into v_teacher_claimed
      from assessment_slots
     where teacher_id = p_teacher
       and claimed_by_teacher = true
       and starts_at >= v_week_start
       and starts_at < v_week_end;

    if v_teacher_claimed >= v_cap then
      raise exception 'WEEKLY_CAP_REACHED' using errcode = 'check_violation';
    end if;
  end if;

  update assessment_slots
     set teacher_id = p_teacher, claimed_by_teacher = true, claimed_at = now(), updated_at = now()
   where id = p_slot
  returning * into v_target;

  return jsonb_build_object(
    'slot_id', v_target.id,
    'starts_at', v_target.starts_at,
    'ends_at', v_target.ends_at
  );
end $$;
