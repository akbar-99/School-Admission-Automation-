import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import {
  computeCooStatsByCreator,
  computeSourceBreakdown,
  EMPTY_COO_STATS,
  type CooStatsRow,
} from "@/lib/marketing-stats";
import {
  computeTeacherStatsByTeacher,
  EMPTY_TEACHER_STATS,
  type TeacherResultRow,
  type TeacherSlotRow,
} from "@/lib/teacher-stats";
import { CooDashboard } from "@/components/admin/coo-dashboard";
import { TeacherDashboard } from "@/components/admin/teacher-dashboard";
import { DashboardTabs } from "@/components/admin/dashboard-tabs";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export default async function CooDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const hasFilters = Boolean(from || to);
  const today = isoDate(new Date());
  const presetHref = (f: string, t: string) => `/admin/coo-dashboard?from=${f}&to=${t}`;
  const presets = [
    { label: "Today", href: presetHref(today, today) },
    { label: "Last 7 days", href: presetHref(isoDate(daysAgo(6)), today) },
    { label: "Last 30 days", href: presetHref(isoDate(daysAgo(29)), today) },
    {
      label: "This month",
      href: presetHref(isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), today),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Team dashboard</h1>
        <p className="text-muted-foreground">
          Every enquiry, from first contact through assessment, payment, admission and course
          enrollment — one row per marketing team member.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form
            action="/admin/coo-dashboard"
            method="get"
            className="flex flex-wrap items-end gap-3 border-b border-border pb-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="from">Created from</Label>
              <Input id="from" name="from" type="date" defaultValue={from ?? ""} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Created to</Label>
              <Input id="to" name="to" type="date" defaultValue={to ?? ""} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/admin/coo-dashboard" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Quick range:</span>
              {presets.map((p) => (
                <Link key={p.label} href={p.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {p.label}
                </Link>
              ))}
            </div>
          </form>
        </CardContent>
      </Card>

      <DashboardTabs
        panels={[
          {
            label: "Marketing",
            content: (
              <Suspense fallback={<DashboardSkeleton />}>
                <CooDashboardData from={from} to={to} />
              </Suspense>
            ),
          },
          {
            label: "Assessment teachers",
            content: (
              <Suspense fallback={<DashboardSkeleton />}>
                <TeacherDashboardData from={from} to={to} />
              </Suspense>
            ),
          },
        ]}
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

async function CooDashboardData({ from, to }: { from?: string; to?: string }) {
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("applications")
    .select(
      "id, status, grade_applying, created_by, erp_status, created_at, lead_student_name, lead_source, lead_source_other, external_contact_id, students(full_name), parents(full_name), payments(amount, status)",
    )
    .not("created_by", "is", null);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);

  const [{ data: staffData }, { data: appsData }] = await Promise.all([
    admin
      .from("users")
      .select("id, full_name, email")
      .eq("role", "marketing")
      .order("full_name", { ascending: true }),
    query,
  ]);

  const staff = staffData ?? [];
  const rows = (appsData ?? []) as unknown as CooStatsRow[];
  const statsByStaff = computeCooStatsByCreator(rows);

  const totals = staff.reduce(
    (acc, m) => {
      const s = statsByStaff.get(m.id)?.stats ?? EMPTY_COO_STATS;
      acc.enquiries += s.enquiries;
      acc.claimed += s.claimed;
      acc.waitingAssessment += s.waitingAssessment;
      acc.assessmentCompleted += s.assessmentCompleted;
      acc.waitingPayment += s.waitingPayment;
      acc.admissionCompleted += s.admissionCompleted;
      acc.addedToCourse += s.addedToCourse;
      acc.revenuePaise += s.revenuePaise;
      return acc;
    },
    { ...EMPTY_COO_STATS },
  );
  const sourceBreakdown = computeSourceBreakdown(rows);

  return (
    <CooDashboard
      staff={staff.map((m) => ({
        id: m.id,
        name: m.full_name ?? m.email ?? "—",
        stats: statsByStaff.get(m.id)?.stats ?? EMPTY_COO_STATS,
        rows: statsByStaff.get(m.id)?.rows ?? {
          enquiries: [],
          claimed: [],
          waitingAssessment: [],
          assessmentCompleted: [],
          waitingPayment: [],
          admissionCompleted: [],
          addedToCourse: [],
        },
      }))}
      totals={totals}
      sourceBreakdown={sourceBreakdown}
      from={from}
      to={to}
    />
  );
}

async function TeacherDashboardData({ from, to }: { from?: string; to?: string }) {
  const admin = createSupabaseAdminClient();

  // "When did this assessment happen" — starts_at, not created_at, is the
  // natural date range for this tab, distinct from the marketing table's
  // cohort-based created_at filter.
  let slotQuery = admin
    .from("assessment_slots")
    .select(
      "id, teacher_id, starts_at, application_id, claimed_by_teacher, unavailable_reported, applications(lead_student_name, students(full_name))",
    )
    .not("teacher_id", "is", null);
  if (from) slotQuery = slotQuery.gte("starts_at", `${from}T00:00:00`);
  if (to) slotQuery = slotQuery.lte("starts_at", `${to}T23:59:59`);

  const [{ data: teacherData }, { data: slotData }] = await Promise.all([
    admin.from("users").select("id, full_name, email").eq("role", "teacher").order("full_name", { ascending: true }),
    slotQuery,
  ]);

  const teachers = teacherData ?? [];
  const slots = (slotData ?? []) as unknown as TeacherSlotRow[];

  // Results have no date column of their own — scope them to exactly the
  // applications already pulled from the ranged slots query above.
  const applicationIds = slots.map((s) => s.application_id).filter((id): id is string => Boolean(id));
  const { data: resultData } =
    applicationIds.length > 0
      ? await admin.from("assessment_results").select("application_id, teacher_id, outcome").in("application_id", applicationIds)
      : { data: [] };
  const results = (resultData ?? []) as unknown as TeacherResultRow[];

  const statsByTeacher = computeTeacherStatsByTeacher(slots, results);

  const totals = teachers.reduce(
    (acc, t) => {
      const s = statsByTeacher.get(t.id)?.stats ?? EMPTY_TEACHER_STATS;
      acc.totalSlots += s.totalSlots;
      acc.claimed += s.claimed;
      acc.assignedByAdmin += s.assignedByAdmin;
      acc.booked += s.booked;
      acc.completed += s.completed;
      acc.eligible += s.eligible;
      acc.notEligible += s.notEligible;
      acc.unavailableReported += s.unavailableReported;
      return acc;
    },
    { ...EMPTY_TEACHER_STATS },
  );

  return (
    <TeacherDashboard
      teachers={teachers.map((t) => ({
        id: t.id,
        name: t.full_name ?? t.email ?? "—",
        stats: statsByTeacher.get(t.id)?.stats ?? EMPTY_TEACHER_STATS,
        slots: statsByTeacher.get(t.id)?.slots ?? {
          totalSlots: [],
          claimed: [],
          assignedByAdmin: [],
          booked: [],
          completed: [],
          eligible: [],
          notEligible: [],
          unavailableReported: [],
        },
      }))}
      totals={totals}
      from={from}
      to={to}
    />
  );
}
