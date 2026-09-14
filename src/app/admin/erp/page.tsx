import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { syncErpNow, retryErpAdmission } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

interface ErpClassRow {
  class_name: string;
  base: string;
  division: string;
  batch: string | null;
  capacity: number;
  enrolled: number;
  admitted_since_sync: number;
  synced_at: string;
}

interface NeedsAttentionRow {
  id: string;
  admission_number: string | null;
  grade_applying: string | null;
  erp_status: "no_mapping" | "send_failed";
  erp_class_name: string | null;
  students: { full_name: string } | null;
  parents: { full_name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  no_mapping: "Section has no ERP class name set",
  send_failed: "ERP send failed",
};

export default async function ErpIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">ERP integration</h1>
        <p className="text-muted-foreground">
          Cached ERP class capacity (reference only) and admissions that need attention syncing to
          the school ERP.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Alert variant="info">
        Which ERP class each division corresponds to is set per-section under{" "}
        <Link href="/admin/sections" className="underline">
          Admin → Sections
        </Link>{" "}
        (the &quot;ERP class name&quot; field) — this app&apos;s own sections already decide which
        division a student lands in, so the ERP side just needs to know which of its own class names
        that division maps to.
      </Alert>

      <Suspense fallback={<ErpBodySkeleton />}>
        <ErpBody />
      </Suspense>
    </div>
  );
}

function ErpBodySkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-2 pt-6">
            <div className="h-5 w-48 animate-pulse rounded bg-muted" />
            <div className="h-24 w-full animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

async function ErpBody() {
  const admin = createSupabaseAdminClient();

  const [{ data: classRows }, { data: attentionRows }] = await Promise.all([
    admin
      .from("erp_classes")
      .select("class_name, base, division, batch, capacity, enrolled, admitted_since_sync, synced_at")
      .order("base", { ascending: true })
      .order("division", { ascending: true })
      .order("batch", { ascending: true }),
    admin
      .from("applications")
      .select("id, admission_number, grade_applying, erp_status, erp_class_name, students(full_name), parents(full_name)")
      .in("erp_status", ["no_mapping", "send_failed"])
      .order("created_at", { ascending: false }),
  ]);

  const classes = (classRows ?? []) as ErpClassRow[];
  const attention = (attentionRows ?? []) as unknown as NeedsAttentionRow[];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Cached ERP capacity ({classes.length})</CardTitle>
          <CardDescription>
            Reference only — not used for allocation. Useful for checking real ERP class names and
            capacity while setting up the mapping under Admin → Sections. Click a class name to see
            which students this app has mapped to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={syncErpNow}>
            <SubmitButton size="sm" pendingText="Syncing…">
              Sync now
            </SubmitButton>
          </form>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cached classes yet — click &quot;Sync now&quot; to pull capacity from the ERP.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Class name</TH>
                  <TH>Capacity</TH>
                  <TH>Enrolled (at sync)</TH>
                  <TH>Synced</TH>
                </TR>
              </THead>
              <TBody>
                {classes.map((c) => (
                  <TR key={c.class_name}>
                    <TD className="font-medium">
                      <Link
                        href={`/admin/erp/classes/${encodeURIComponent(c.class_name)}`}
                        className="hover:underline"
                      >
                        {c.class_name}
                      </Link>
                    </TD>
                    <TD>{c.capacity}</TD>
                    <TD>{c.enrolled}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(c.synced_at)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Needs attention ({attention.length})</CardTitle>
          <CardDescription>Admissions that couldn&apos;t sync to the ERP automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
          ) : (
            <>
              <Link href="/admin/sections" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Edit section mappings
              </Link>
              <Table>
                <THead>
                  <TR>
                    <TH>Applicant</TH>
                    <TH>Grade</TH>
                    <TH>Admission no.</TH>
                    <TH>Issue</TH>
                    <TH className="text-right">Retry</TH>
                  </TR>
                </THead>
                <TBody>
                  {attention.map((a) => (
                    <TR key={a.id}>
                      <TD className="font-medium">{a.students?.full_name ?? a.parents?.full_name ?? "—"}</TD>
                      <TD>{a.grade_applying ?? "—"}</TD>
                      <TD className="font-mono text-xs">{a.admission_number ?? "—"}</TD>
                      <TD>
                        <Badge tone="warning">{STATUS_LABEL[a.erp_status] ?? a.erp_status}</Badge>
                        {a.erp_class_name && (
                          <span className="ml-2 text-xs text-muted-foreground">→ {a.erp_class_name}</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        <form action={retryErpAdmission} className="inline-flex">
                          <input type="hidden" name="application_id" value={a.id} />
                          <input type="hidden" name="erp_status" value={a.erp_status} />
                          <SubmitButton size="sm" variant="outline" pendingText="Retrying…">
                            Retry
                          </SubmitButton>
                        </form>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
