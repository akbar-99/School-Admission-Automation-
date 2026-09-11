-- The admin overview page's stats/funnel/chart section previously made two
-- separate PostgREST round-trips (a 300-row joined select + a 2000-row
-- select). On this deployment the app server sits far from the database
-- (cross-region), so each extra round-trip is pure added latency — this
-- collapses both into a single RPC call.
create or replace function admin_overview_data(p_limit integer, p_chart_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_overview jsonb;
  v_chart    jsonb;
begin
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_overview
  from (
    select
      a.id, a.status, a.category, a.grade_applying, a.admission_number,
      a.lead_source, a.created_at,
      case when p.id is null then null else jsonb_build_object('full_name', p.full_name) end as parents,
      case when st.id is null then null else jsonb_build_object('full_name', st.full_name) end as students,
      case when s.id is null then null else jsonb_build_object('grade', s.grade, 'name', s.name) end as sections
    from applications a
    left join parents p on p.id = a.parent_id
    left join students st on st.id = a.student_id
    left join sections s on s.id = a.section_id
    order by a.created_at desc
    limit p_limit
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('status', t2.status, 'created_at', t2.created_at)), '[]'::jsonb)
    into v_chart
  from (
    select status, created_at from applications order by created_at asc limit p_chart_limit
  ) t2;

  return jsonb_build_object('overview_rows', v_overview, 'chart_rows', v_chart);
end $$;
