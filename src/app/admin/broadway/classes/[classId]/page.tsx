import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { BadgeTone } from "@/lib/types";

interface PendingRow {
  id: string;
  admission_number: string | null;
  broadway_status: "pending" | "no_mapping" | "send_failed" | "synced" | "cancelled";
  broadway_warning: string | null;
  students: { full_name: string } | null;
  parents: { full_name: string } | null;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  synced: "success",
  send_failed: "danger",
  no_mapping: "warning",
  pending: "neutral",
  cancelled: "neutral",
};

export default async function BroadwayClassStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { classId: rawClassId } = await params;
  if (!rawClassId) notFound();
  let classId: string;
  try {
    classId = decodeURIComponent(rawClassId);
  } catch {
    notFound();
  }
  const { ok, error } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/broadway" className="text-sm text-muted-foreground hover:underline">
          ← Back to Broadway integration
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Class roster</h1>
        <p className="text-muted-foreground">
          Cached Broadway roster for this class, cross-linked with this app&apos;s own records where
          available. Refreshed by &quot;Sync now&quot; on the Broadway integration page, not fetched
          live.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Suspense fallback={<ClassStudentsSkeleton />}>
        <ClassStudents classId={classId} />
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

async function ClassStudents({ classId }: { classId: string }) {
  const admin = createSupabaseAdminClient();

  const [{ data: classRow }, { data: rosterData }, { data: pendingData }] = await Promise.all([
    admin.from("broadway_classes").select("name, curriculum, grade_label").eq("id", classId).maybeSingle(),
    admin
      .from("broadway_students")
      .select("student_id, admission_no, full_name, status, application_id")
      .or(`class_id.eq.${classId},planned_class_id.eq.${classId}`)
      .order("full_name", { ascending: true }),
    admin
      .from("applications")
      .select("id, admission_number, broadway_status, broadway_warning, students(full_name), parents(full_name)")
      .eq("broadway_class_id", classId)
      .neq("broadway_status", "synced")
      .order("admission_number", { ascending: true }),
  ]);

  const roster = rosterData ?? [];
  const pending = (pendingData ?? []) as unknown as PendingRow[];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {classRow ? `${classRow.name} (${classRow.curriculum} ${classRow.grade_label})` : classId}
          </CardTitle>
          <CardDescription>Students in Broadway&apos;s roster for this class ({roster.length}).</CardDescription>
        </CardHeader>
        <CardContent>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No students cached for this class yet — sync from{" "}
              <Link href="/admin/broadway" className="underline">
                Admin → Broadway
              </Link>
              .
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Admission no.</TH>
                  <TH>Full name</TH>
                  <TH>Status</TH>
                  <TH>Tracked locally</TH>
                </TR>
              </THead>
              <TBody>
                {roster.map((s) => (
                  <TR key={s.student_id}>
                    <TD className="font-mono text-xs">{s.admission_no ?? "—"}</TD>
                    <TD className="font-medium">{s.full_name}</TD>
                    <TD>{s.status}</TD>
                    <TD>
                      {s.application_id ? (
                        <Link href={`/admin/applications/${s.application_id}`} className="text-sm hover:underline">
                          View application →
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Entered directly in Broadway</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending sync to this class ({pending.length})</CardTitle>
            <CardDescription>
              Linked to this class locally but not yet confirmed in Broadway — won&apos;t appear above
              until a retry succeeds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <THead>
                <TR>
                  <TH>Applicant</TH>
                  <TH>Admission no.</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {pending.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/admin/applications/${p.id}`} className="font-medium hover:underline">
                        {p.students?.full_name ?? p.parents?.full_name ?? "—"}
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs">{p.admission_number ?? "—"}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[p.broadway_status] ?? "neutral"}>{p.broadway_status}</Badge>
                      {p.broadway_warning && (
                        <div className="mt-1 max-w-56 text-xs text-muted-foreground">{p.broadway_warning}</div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Link href="/admin/broadway" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Retry from Broadway integration →
            </Link>
          </CardContent>
        </Card>
      )}

      <Link href="/admin/broadway" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Back to Broadway integration
      </Link>
    </>
  );
}
