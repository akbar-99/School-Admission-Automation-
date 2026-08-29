-- ============================================================================
-- Tighten staff RLS (OWASP audit item 5). 0003_rls.sql granted one blanket
-- is_staff() SELECT policy per table to all four staff roles (marketing,
-- teacher, class_teacher, admin). This migration replaces that blanket grant,
-- table by table, with role-scoped policies instead. Written as a NEW
-- migration — 0003_rls.sql already ran and is not edited.
--
-- Every page and server action in this app reads these tables via the
-- service-role client (createSupabaseAdminClient), which bypasses RLS
-- entirely — confirmed by reading every .from(...) call site on these five
-- tables. So none of this changes what any page/action shows; it only closes
-- direct Supabase REST API access using a staff member's own JWT beyond what
-- their own UI already shows them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- payments — admin only (was: any staff role)
-- ---------------------------------------------------------------------------
drop policy if exists payments_staff_read on payments;
create policy payments_admin_read on payments for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- audit_logs — admin only (was: any staff role)
-- ---------------------------------------------------------------------------
drop policy if exists audit_logs_staff_read on audit_logs;
create policy audit_logs_admin_read on audit_logs for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- parents — admin + marketing keep full read (matches /marketing, which
-- already shows every parent's contact details, not just leads that user
-- created). teacher + class_teacher are scoped to only parents whose
-- applicant has an assessment slot assigned to them, matching what /teacher
-- already shows (parent details only for applications tied to that
-- teacher's own slots).
-- ---------------------------------------------------------------------------
drop policy if exists parents_staff_read on parents;

create policy parents_admin_marketing_read on parents for select to authenticated
  using (public.app_role() in ('admin', 'marketing'));

create policy parents_teacher_read on parents for select to authenticated
  using (
    public.app_role() in ('teacher', 'class_teacher')
    and exists (
      select 1
      from applications a
      join assessment_slots s on s.application_id = a.id
      where a.parent_id = parents.id
        and s.teacher_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- assessment_slots — admin + marketing keep full read (unchanged; marketing
-- was never asked to be restricted here). teacher + class_teacher are scoped
-- to their own teacher_id — matches /teacher's own queries, and the Realtime
-- subscriptions behind the live-alerts popup, which already filter on the
-- teacher's own id.
-- ---------------------------------------------------------------------------
drop policy if exists assessment_slots_staff_read on assessment_slots;

create policy assessment_slots_admin_marketing_read on assessment_slots for select to authenticated
  using (public.app_role() in ('admin', 'marketing'));

create policy assessment_slots_teacher_read on assessment_slots for select to authenticated
  using (
    public.app_role() in ('teacher', 'class_teacher')
    and teacher_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- assessment_results — admin + marketing keep full read (unchanged). teacher
-- + class_teacher scoped to results they personally recorded.
-- ---------------------------------------------------------------------------
drop policy if exists assessment_results_staff_read on assessment_results;

create policy assessment_results_admin_marketing_read on assessment_results for select to authenticated
  using (public.app_role() in ('admin', 'marketing'));

create policy assessment_results_teacher_read on assessment_results for select to authenticated
  using (
    public.app_role() in ('teacher', 'class_teacher')
    and teacher_id = auth.uid()
  );
