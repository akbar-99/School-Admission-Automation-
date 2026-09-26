import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { computeCooStatsByCreator, EMPTY_COO_STATS, type CooStatsRow } from "@/lib/marketing-stats";
import { CooDashboard } from "@/components/admin/coo-dashboard";

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

      <Suspense fallback={<DashboardSkeleton />}>
        <CooDashboardData from={from} to={to} />
      </Suspense>
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
      "id, status, grade_applying, created_by, erp_status, created_at, lead_student_name, students(full_name), parents(full_name)",
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
      acc.waitingAssessment += s.waitingAssessment;
      acc.assessmentCompleted += s.assessmentCompleted;
      acc.waitingPayment += s.waitingPayment;
      acc.admissionCompleted += s.admissionCompleted;
      acc.addedToCourse += s.addedToCourse;
      return acc;
    },
    { ...EMPTY_COO_STATS },
  );

  return (
    <CooDashboard
      staff={staff.map((m) => ({
        id: m.id,
        name: m.full_name ?? m.email ?? "—",
        stats: statsByStaff.get(m.id)?.stats ?? EMPTY_COO_STATS,
        rows: statsByStaff.get(m.id)?.rows ?? {
          enquiries: [],
          waitingAssessment: [],
          assessmentCompleted: [],
          waitingPayment: [],
          admissionCompleted: [],
          addedToCourse: [],
        },
      }))}
      totals={totals}
    />
  );
}
