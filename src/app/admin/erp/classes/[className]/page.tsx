import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchErpClassStudents } from "@/lib/erp";
import { bulkTransferErpStudents } from "../../actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/submit-button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { BadgeTone } from "@/lib/types";

interface PendingRow {
  id: string;
  admission_number: string | null;
  erp_status: "pending" | "no_mapping" | "send_failed" | "synced";
  erp_warning: string | null;
  students: { full_name: string } | null;
  parents: { full_name: string } | null;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  synced: "success",
  send_failed: "danger",
  no_mapping: "warning",
  pending: "neutral",
};

export default async function ErpClassStudentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ className: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { className: rawClassName } = await params;
  if (!rawClassName) notFound();
  // The Link that navigates here encodes the class name (it can contain
  // spaces, e.g. "KG 2-C - TULIP"); this version of Next.js does not decode
  // dynamic segments itself, so do it explicitly here.
  let className: string;
  try {
    className = decodeURIComponent(rawClassName);
  } catch {
    notFound();
  }
  const { ok, error } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/erp" className="text-sm text-muted-foreground hover:underline">
          ← Back to ERP integration
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{className}</h1>
        <p className="text-muted-foreground">
          Live student roster from the ERP, cross-linked with this app&apos;s own records where available.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

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

  const [roster, { data: pendingData }, { data: classNameRows }] = await Promise.all([
    fetchErpClassStudents(className),
    admin
      .from("applications")
      .select(
        "id, admission_number, erp_status, erp_warning, students(full_name), parents(full_name)",
      )
      .eq("erp_class_name", className)
      .neq("erp_status", "synced")
      .order("admission_number", { ascending: true }),
    admin.from("erp_classes").select("class_name").order("class_name", { ascending: true }),
  ]);

  const pending = (pendingData ?? []) as unknown as PendingRow[];
  const targetOptions = (classNameRows ?? [])
    .map((r) => r.class_name as string)
    .filter((n) => n !== className);

  if (roster === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Students</CardTitle>
          <CardDescription>Could not reach the ERP just now.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="error">
            Failed to fetch the student roster from the ERP. Check the ERP connection and try again.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const transferableCount = roster.filter((s) => s.admission_id).length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Students in the ERP ({roster.length})</CardTitle>
          <CardDescription>
            The ERP&apos;s own roster for this class — matches its enrolled count exactly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students in this class yet.</p>
          ) : (
            <form action={bulkTransferErpStudents} className="space-y-4">
              <input type="hidden" name="from_class_name" value={className} />
              <div className="w-full overflow-x-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-8"></TH>
                      <TH>Student ID</TH>
                      <TH>Full name</TH>
                      <TH>Tracked locally</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {roster.map((s) => (
                      <TR key={s.student_id}>
                        <TD>
                          {s.admission_id ? (
                            <input
                              type="checkbox"
                              name="application_ids"
                              value={s.admission_id}
                              className="size-4 rounded border-input accent-primary"
                              aria-label={`Select ${s.full_name} for transfer`}
                            />
                          ) : null}
                        </TD>
                        <TD className="font-mono text-xs">{s.student_id}</TD>
                        <TD className="font-medium">{s.full_name}</TD>
                        <TD>
                          {s.admission_id ? (
                            <Link href={`/admin/applications/${s.admission_id}`} className="text-sm hover:underline">
                              View application →
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">Entered directly in the ERP</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>

              {transferableCount > 0 ? (
                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <div className="space-y-1.5">
                    <label htmlFor="class_name" className="text-sm font-medium">
                      Transfer selected to
                    </label>
                    <Select id="class_name" name="class_name" required className="w-56">
                      <option value="">Choose a class…</option>
                      {targetOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <SubmitButton variant="outline" pendingText="Transferring…">
                    Transfer selected students
                  </SubmitButton>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  None of the students above can be transferred from here yet — only ones tracked
                  locally (with a &quot;View application&quot; link) can be selected, since transferring
                  needs the ERP&apos;s internal id, which the roster doesn&apos;t expose for
                  directly-entered students.
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending sync to this class ({pending.length})</CardTitle>
            <CardDescription>
              Mapped to this class locally but not yet confirmed in the ERP — won&apos;t appear above until
              a retry succeeds.
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
                      <Badge tone={STATUS_TONE[p.erp_status] ?? "neutral"}>{p.erp_status}</Badge>
                      {p.erp_warning && (
                        <div className="mt-1 max-w-56 text-xs text-muted-foreground">{p.erp_warning}</div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Link href="/admin/erp" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Retry from ERP integration →
            </Link>
          </CardContent>
        </Card>
      )}

      <Link href="/admin/erp" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Back to ERP integration
      </Link>
    </>
  );
}
