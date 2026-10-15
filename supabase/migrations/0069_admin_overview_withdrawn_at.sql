-- ============================================================================
-- admin_overview_data (0038) never selected a.withdrawn_at, even though
-- src/app/admin/page.tsx's `Row` type has always declared it — the field was
-- silently null/undefined for every row this RPC returns, so a withdrawn
-- (and refunded) applicant's "Enrolled" status still counted toward the
-- Overview page's "Enrolled" stat tile, since there was no way to filter it
-- out from data that was never actually fetched. The applications TABLE
-- below that tile shows the withdrawal badge correctly because it's fed by
-- a completely different query (admissions-report.ts), not this RPC —
-- confirmed live: the stat tile and the table can and did disagree.
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

  select coalesce(jsonb_agg(jsonb_build_object('status', t2.status, 'created_at', t2.created_at)), '[]'::jsonb)
    into v_chart
  from (
    select status, created_at from applications order by created_at asc limit p_chart_limit
  ) t2;

  return jsonb_build_object('overview_rows', v_overview, 'chart_rows', v_chart);
end $$;
