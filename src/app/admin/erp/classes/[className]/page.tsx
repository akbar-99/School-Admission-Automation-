import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { BadgeTone } from "@/lib/types";

interface StudentRow {
  id: string;
  admission_number: string | null;
  grade_applying: string | null;
  erp_status: "pending" | "no_mapping" | "send_failed" | "synced";
  erp_student_id: string | null;
  erp_warning: string | null;
  students: { full_name: string; dob: string } | null;
  parents: { full_name: string; phone: string } | null;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  synced: "success",
  send_failed: "danger",
  no_mapping: "warning",
  pending: "neutral",
};

export default async function ErpClassStudentsPage({
  params,
}: {
  params: Promise<{ className: string }>;
}) {
  const { className } = await params;
  if (!className) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/erp" className="text-sm text-muted-foreground hover:underline">
          ← Back to ERP integration
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{className}</h1>
        <p className="text-muted-foreground">Students this app has mapped to this ERP class.</p>
      </div>

      <Suspense fallback={<ClassStudentsSkeleton />}>
        <ClassStudents className={className} />
      </Suspense>
    </div>
  );
}

function ClassStudentsSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

async function ClassStudents({ className }: { className: string }) {
  const admin = createSupabaseAdminClient();

  const { data } = await admin
    .from("applications")
    .select(
      "id, admission_number, grade_applying, erp_status, erp_student_id, erp_warning, students(full_name, dob), parents(full_name, phone)",
    )
    .eq("erp_class_name", className)
    .order("admission_number", { ascending: true });

  const rows = (data ?? []) as unknown as StudentRow[];
  const synced = rows.filter((r) => r.erp_status === "synced").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Students ({rows.length})</CardTitle>
        <CardDescription>
          {synced} confirmed in the ERP · {rows.length - synced} pending or failed sync.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No applications are mapped to this class yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Student</TH>
                <TH>Admission no.</TH>
                <TH>ERP student ID</TH>
                <TH>Grade</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/admin/applications/${r.id}`} className="font-medium hover:underline">
                      {r.students?.full_name ?? r.parents?.full_name ?? "—"}
                    </Link>
                    {r.students?.dob && (
                      <div className="text-xs text-muted-foreground">DOB {formatDate(r.students.dob)}</div>
                    )}
                  </TD>
                  <TD className="font-mono text-xs">{r.admission_number ?? "—"}</TD>
                  <TD className="font-mono text-xs">{r.erp_student_id ?? "—"}</TD>
                  <TD>{r.grade_applying ?? "—"}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.erp_status] ?? "neutral"}>{r.erp_status}</Badge>
                    {r.erp_warning && (
                      <div className="mt-1 max-w-56 text-xs text-muted-foreground">{r.erp_warning}</div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      <CardContent className="pt-0">
        <Link href="/admin/erp" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Back to ERP integration
        </Link>
      </CardContent>
    </Card>
  );
}
