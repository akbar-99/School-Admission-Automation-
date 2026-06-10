import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { resolveSeat } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { AdmissionsCharts } from "@/components/admin/admissions-charts";
import { SlotRequestAlert } from "@/components/admin/slot-request-alert";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { AppStatus } from "@/lib/types";

interface Row {
  id: string;
  status: AppStatus;
  category: string | null;
  grade_applying: string | null;
  admission_number: string | null;
  created_at: string;
  parents: { full_name: string } | null;
  students: { full_name: string } | null;
  sections: { grade: string; name: string } | null;
}

export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("applications")
    .select(
      "id, status, category, grade_applying, admission_number, created_at, parents(full_name), students(full_name), sections(grade, name)",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  const rows = (data ?? []) as unknown as Row[];

  // Lightweight, full-history pull for the analytics charts (status + date only).
  const { data: chartData } = await admin
    .from("applications")
    .select("status, created_at")
    .order("created_at", { ascending: true })
    .limit(2000);
  const chartRows = (chartData ?? []) as { status: AppStatus; created_at: string }[];

  const stat = (pred: (r: Row) => boolean) => rows.filter(pred).length;
  const stats = [
    { label: "Total applications", value: rows.length },
    { label: "Enrolled", value: stat((r) => r.status === "ENROLLED") },
    { label: "Awaiting payment", value: stat((r) => r.status === "AGREEMENT_SENT" || r.status === "PAYMENT_PENDING") },
    { label: "Needs admin", value: stat((r) => r.status === "NEEDS_ADMIN") },
  ];
  const needsAdmin = rows.filter((r) => r.status === "NEEDS_ADMIN");
  const pendingRequests = rows.filter(
    (r) => r.status === "FORM_SUBMITTED" && r.category === "GRADE",
  ).length;

  return (
    <div className="space-y-6">
      <SlotRequestAlert initialCount={pendingRequests} />
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Admissions overview</h1>
        <p className="text-muted-foreground">Monitor applications, payments and seat allocation.</p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

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

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Student / Parent</TH>
                  <TH>Category</TH>
                  <TH>Grade</TH>
                  <TH>Status</TH>
                  <TH>Admission no.</TH>
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
    </div>
  );
}
