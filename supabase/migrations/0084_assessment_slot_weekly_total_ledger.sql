-- 0083's weekly cap computed "total open-pool slots this week" by counting
-- currently-existing rows live. That count shrinks whenever a slot gets
-- booked (application_id gets set, dropping it out of the "application_id
-- is null" filter) or expires unclaimed and is cron-deleted (see
-- src/app/api/cron/assessment-reminders/route.ts's cleanup) — so a
-- teacher's fair share could silently shrink mid-week even though nothing
-- about how many slots were actually posted changed, leaving some teachers
-- stuck below a cap that had briefly been higher when they claimed theirs.
--
-- Fix: track "how many open-pool slots were ever posted this week" as a
-- standalone, append-only ledger, incremented once by the admin action that
-- creates them (see createAssessmentSlot). A week's total now only ever
-- grows (when the admin opens more slots) and never shrinks from bookings
-- or expiry cleanup.

create table if not exists assessment_slot_weekly_totals (
  week_start date primary key,
  pool_slots_opened int not null default 0
);

-- One-time backfill from whatever's still live right now. Anything already
-- consumed by booking/expiry before this ships can't be recovered, but
-- every week from here on is tracked accurately from the moment its slots
-- are created.
insert into assessment_slot_weekly_totals (week_start, pool_slots_opened)
select (date_trunc('week', starts_at at time zone 'Asia/Kolkata'))::date as week_start,
       count(*) as pool_slots_opened
  from assessment_slots
 where claimed_by_teacher = true
    or (teacher_id is null and application_id is null and is_open = true)
 group by 1
on conflict (week_start) do update set pool_slots_opened = excluded.pool_slots_opened;

create or replace function increment_weekly_pool_total(p_week_start date, p_delta int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into assessment_slot_weekly_totals (week_start, pool_slots_opened)
  values (p_week_start, p_delta)
  on conflict (week_start) do update
    set pool_slots_opened = assessment_slot_weekly_totals.pool_slots_opened + excluded.pool_slots_opened;
$$;

create or replace function claim_assessment_slot(p_slot uuid, p_teacher uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target assessment_slots;
  v_week_start_date date;
  v_week_start_ts timestamptz;
  v_week_end_ts timestamptz;
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
    v_week_start_date := (date_trunc('week', v_target.starts_at at time zone 'Asia/Kolkata'))::date;
    v_week_start_ts := (v_week_start_date::timestamp) at time zone 'Asia/Kolkata';
    v_week_end_ts := v_week_start_ts + interval '7 days';

    select count(*) into v_teacher_count
      from users
     where role = 'teacher' and not disabled;

    select coalesce(pool_slots_opened, 0) into v_week_total
      from assessment_slot_weekly_totals
     where week_start = v_week_start_date;

    v_cap := ceil(coalesce(v_week_total, 0)::numeric / greatest(v_teacher_count, 1));

    select count(*) into v_teacher_claimed
      from assessment_slots
     where teacher_id = p_teacher
       and claimed_by_teacher = true
       and starts_at >= v_week_start_ts
       and starts_at < v_week_end_ts;

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
