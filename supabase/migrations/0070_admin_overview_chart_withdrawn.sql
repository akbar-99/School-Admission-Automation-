-- ============================================================================
-- chart_rows (the data behind the Overview page's "Application status" donut
-- and "Admissions trend" bar chart) only ever selected status + created_at,
-- so neither chart had any way to distinguish a withdrawn-and-refunded
-- application from a normal active one — it fell into whichever status
-- bucket it was last in (usually "Enrolled"), identical to the
-- admin_overview_data gap fixed in 0069 for the stat tile, just in the
-- second half of the same function. Adds withdrawn_at/withdrawal_type here
-- too so the frontend can break withdrawals out as their own segments.
-- ============================================================================
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
      a.lead_source, a.created_at, a.withdrawn_at,
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

  select coalesce(
      jsonb_agg(jsonb_build_object(
        'status', t2.status,
        'created_at', t2.created_at,
        'withdrawn_at', t2.withdrawn_at,
        'withdrawal_type', t2.withdrawal_type
      )),
      '[]'::jsonb
    )
    into v_chart
  from (
    select status, created_at, withdrawn_at, withdrawal_type
    from applications order by created_at asc limit p_chart_limit
  ) t2;

  return jsonb_build_object('overview_rows', v_overview, 'chart_rows', v_chart);
end $$;
