import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, cn } from "@/lib/utils";
import { resolveSeat } from "./actions";
import { getClassOptions } from "@/lib/classes";
import { needsAssessment } from "@/lib/assessment";
import {
  describeFilters,
  fetchAdmissionsReportRows,
  parseAdmissionsFilters,
  type AdmissionsReportFilters,
} from "@/lib/admissions-report";
import { StatusBadge } from "@/components/status-badge";
import { AdmissionsCharts } from "@/components/admin/admissions-charts";
import { SlotRequestAlert } from "@/components/admin/slot-request-alert";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { STATUS_LABEL, leadSourceLabel, type AppStatus } from "@/lib/types";

interface Row {
  id: string;
  status: AppStatus;
  category: string | null;
  grade_applying: string | null;
  admission_number: string | null;
  lead_source: string | null;
  lead_source_other: string | null;
  created_at: string;
  parents: { full_name: string } | null;
  students: { full_name: string } | null;
  sections: { grade: string; name: string } | null;
}

// The heading needs no data and used to be the LCP element blocked behind
// ~3s of queries below it — moving the slow sections into their own
// Suspense boundaries lets this (and the rest of the static shell) paint
// immediately, independent of how long those queries take.
export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    status?: string;
    category?: string;
    grade?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const { ok, error } = sp;
  const filters = parseAdmissionsFilters(sp);
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Admissions overview</h1>
        <p className="text-muted-foreground">Monitor applications, payments and seat allocation.</p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Suspense fallback={<OverviewStatsSkeleton />}>
        <OverviewStatsSection />
      </Suspense>

      <Suspense fallback={<ApplicationsTableSkeleton />}>
        <ApplicationsTableSection filters={filters} hasFilters={hasFilters} />
      </Suspense>
    </div>
  );
}

function OverviewStatsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="space-y-2 pt-6">
              <div className="h-9 w-14 animate-pulse rounded bg-muted" />
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="h-64 w-full animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}

function ApplicationsTableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Applications</CardTitle>
        <CardDescription>Filter the list and export it as a branded PDF or Excel report.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

// Stat cards, the funnel/trend charts, and the manual-seat-allocation queue
// — all derived from the same "whole account" pull of recent applications,
// independent of whatever filter is applied to the Applications table below
// (otherwise filtering to e.g. "Enrolled" would make "Needs admin" silently
// show a stale/wrong count).
async function OverviewStatsSection() {
  const admin = createSupabaseAdminClient();
  // One round-trip instead of two separate selects — see admin_overview_data
  // in 0038_admin_overview_rpc.sql. Cross-region latency to the database
  // makes every extra round-trip here directly add to page-load time.
  const { data } = await admin.rpc("admin_overview_data", { p_limit: 300, p_chart_limit: 2000 });
  const result = data as { overview_rows: unknown[]; chart_rows: { status: AppStatus; created_at: string }[] } | null;
  const allRows = (result?.overview_rows ?? []) as unknown as Row[];
  const chartRows = result?.chart_rows ?? [];

  const stat = (pred: (r: Row) => boolean) => allRows.filter(pred).length;
  const stats = [
    { label: "Total applications", value: allRows.length },
    { label: "Enrolled", value: stat((r) => r.status === "ENROLLED") },
    { label: "Awaiting payment", value: stat((r) => r.status === "AGREEMENT_SENT" || r.status === "PAYMENT_PENDING") },
    { label: "Needs admin", value: stat((r) => r.status === "NEEDS_ADMIN") },
  ];
  const needsAdmin = allRows.filter((r) => r.status === "NEEDS_ADMIN");
  const pendingRequests = allRows.filter(
    (r) => r.status === "FORM_SUBMITTED" && needsAssessment(r.grade_applying ?? ""),
  ).length;

  return (
    <>
      <SlotRequestAlert initialCount={pendingRequests} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="text-3xl font-bold">{s.value}</div>
              <div className="text-sm text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <AdmissionsCharts rows={chartRows} />

      {needsAdmin.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Needs manual seat allocation ({needsAdmin.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsAdmin.map((r) => (
              <form
                key={r.id}
                action={resolveSeat}
                className="flex items-center justify-between rounded-md border border-border px-4 py-3"
              >
                <input type="hidden" name="application_id" value={r.id} />
                <div className="text-sm">
                  <span className="font-medium">{r.students?.full_name ?? r.parents?.full_name}</span>
                  <span className="text-muted-foreground"> · {r.grade_applying ?? r.category}</span>
                </div>
                <SubmitButton size="sm" pendingText="Allocating…">
                  Allocate seat
                </SubmitButton>
              </form>
            ))}
            <p className="text-xs text-muted-foreground">
              If all sections are full, add capacity under{" "}
              <a href="/admin/sections" className="underline">Sections</a> first.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

async function ApplicationsTableSection({
  filters,
  hasFilters,
}: {
  filters: AdmissionsReportFilters;
  hasFilters: boolean;
}) {
  const [reportRows, classOptions] = await Promise.all([
    fetchAdmissionsReportRows(filters, 300),
    getClassOptions(),
  ]);

  const rows: Row[] = reportRows.map((r) => ({
    id: r.id,
    status: r.status,
    category: r.category,
    grade_applying: r.gradeApplying,
    admission_number: r.admissionNumber,
    lead_source: r.leadSource,
    lead_source_other: r.leadSourceOther,
    created_at: r.createdAt,
    parents: { full_name: r.parentName },
    students: { full_name: r.studentName },
    sections: r.sectionGrade ? { grade: r.sectionGrade, name: r.sectionName ?? "" } : null,
  }));
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Applications</CardTitle>
        <CardDescription>
          Filter the list and export it as a branded PDF or Excel report.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-4">
          <Link
            href="/admin"
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              !filters.status
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
            )}
          >
            All
          </Link>
          {(Object.keys(STATUS_LABEL) as AppStatus[]).map((s) => (
            <Link
              key={s}
              href={`/admin?status=${s}`}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                filters.status === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
              )}
            >
              {STATUS_LABEL[s]}
            </Link>
          ))}
        </div>

        <form action="/admin" method="get" className="mb-4 space-y-4 border-b border-border pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={filters.status ?? ""} className="w-48">
                <option value="">All statuses</option>
                {(Object.keys(STATUS_LABEL) as AppStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Category</Label>
              <Select id="category" name="category" defaultValue={filters.category ?? ""} className="w-28">
                <option value="">All</option>
                <option value="KG">KG</option>
                <option value="GRADE">Grade</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grade">Grade</Label>
              <Select id="grade" name="grade" defaultValue={filters.grade ?? ""} className="w-28">
                <option value="">All</option>
                {classOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Created from</Label>
              <Input id="from" name="from" type="date" defaultValue={filters.from ?? ""} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Created to</Label>
              <Input id="to" name="to" type="date" defaultValue={filters.to ?? ""} className="w-40" />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" variant="outline">
                Filter
              </Button>
              {hasFilters && (
                <Link href="/admin" className={buttonVariants({ variant: "ghost" })}>
                  Clear
                </Link>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Export: <span className="font-medium text-foreground">{describeFilters(filters)}</span>
            </p>
            <div className="flex items-center gap-2">
              <a
                href={`/api/admin/export/pdf${exportQuery ? `?${exportQuery}` : ""}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FileDown className="size-4" />
                Export PDF
              </a>
              <a
                href={`/api/admin/export/excel${exportQuery ? `?${exportQuery}` : ""}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FileSpreadsheet className="size-4" />
                Export Excel
              </a>
            </div>
          </div>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "No applications match this filter." : "No applications yet."}
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Student / Parent</TH>
                <TH>Category</TH>
                <TH>Grade</TH>
                <TH>Status</TH>
                <TH>Admission no.</TH>
                <TH>Source</TH>
                <TH>Section</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/admin/applications/${r.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {r.students?.full_name ?? "View details"}
                    </Link>
                    <div className="text-xs text-muted-foreground">{r.parents?.full_name}</div>
                  </TD>
                  <TD>{r.category ?? "—"}</TD>
                  <TD>{r.grade_applying ?? "—"}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="font-mono text-xs">{r.admission_number ?? "—"}</TD>
                  <TD>{leadSourceLabel(r.lead_source, r.lead_source_other)}</TD>
                  <TD>{r.sections ? `${r.sections.grade}-${r.sections.name}` : "—"}</TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.created_at)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
