import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { syncErpNow, retryErpAdmission } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  searchParams: Promise<{ ok?: string; error?: string; q?: string }>;
}) {
  const { ok, error, q } = await searchParams;
  const query = q?.trim() ?? "";

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

      <Card>
        <CardContent className="pt-6">
          <form action="/admin/erp" method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <label htmlFor="q" className="text-sm font-medium">
                Search classes or students
              </label>
              <Input id="q" name="q" defaultValue={query} placeholder="Class name, student name, or student ID" />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
            {query && (
              <Link href="/admin/erp" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {query ? (
        <Suspense fallback={<ErpBodySkeleton />}>
          <SearchResults query={query} />
        </Suspense>
      ) : (
        <>
          <Alert variant="info">
            Which ERP class each division corresponds to is set per-section under{" "}
            <Link href="/admin/sections" className="underline">
              Admin → Sections
            </Link>{" "}
            (the &quot;ERP class name&quot; field) — this app&apos;s own sections already decide which
            division a student lands in, so the ERP side just needs to know which of its own class
            names that division maps to.
          </Alert>

          <Suspense fallback={<ErpBodySkeleton />}>
            <ErpBody />
          </Suspense>
        </>
      )}
    </div>
  );
}

interface StudentCacheRow {
  internal_id: string;
  student_id: string;
  full_name: string;
  class_name: string;
  admission_id: string | null;
}

async function SearchResults({ query }: { query: string }) {
  const admin = createSupabaseAdminClient();
  const like = `%${query}%`;

  const [{ data: classRows }, { data: byName }, { data: byId }, { count: cacheCount }] = await Promise.all([
    admin
      .from("erp_classes")
      .select("class_name, capacity, enrolled")
      .ilike("class_name", like)
      .order("class_name", { ascending: true })
      .limit(50),
    admin
      .from("erp_students")
      .select("internal_id, student_id, full_name, class_name, admission_id")
      .ilike("full_name", like)
      .limit(50),
    admin
      .from("erp_students")
      .select("internal_id, student_id, full_name, class_name, admission_id")
      .ilike("student_id", like)
      .limit(50),
    admin.from("erp_students").select("internal_id", { count: "exact", head: true }),
  ]);

  const classes = classRows ?? [];
  const merged = new Map<string, StudentCacheRow>();
  for (const r of [...((byName ?? []) as StudentCacheRow[]), ...((byId ?? []) as StudentCacheRow[])]) {
    merged.set(r.internal_id, r);
  }
  const students = [...merged.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const cacheEmpty = (cacheCount ?? 0) === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Classes matching &quot;{query}&quot; ({classes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching class names.</p>
          ) : (
            <ul className="divide-y divide-border">
              {classes.map((c) => (
                <li key={c.class_name} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link
                    href={`/admin/erp/classes/${encodeURIComponent(c.class_name)}`}
                    className="font-medium hover:underline"
                  >
                    {c.class_name}
                  </Link>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {c.enrolled}/{c.capacity} enrolled
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Students matching &quot;{query}&quot; ({students.length})</CardTitle>
          {cacheEmpty && (
            <CardDescription>
              The student search cache is empty — click &quot;Sync now&quot; to pull every class&apos;s
              roster from the ERP first.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {cacheEmpty ? (
            <form action={syncErpNow}>
              <SubmitButton size="sm" pendingText="Syncing…">
                Sync now
              </SubmitButton>
            </form>
          ) : students.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching students.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Student ID</TH>
                  <TH>Full name</TH>
                  <TH>Class</TH>
                  <TH>Tracked locally</TH>
                </TR>
              </THead>
              <TBody>
                {students.map((s) => (
                  <TR key={s.internal_id}>
                    <TD className="font-mono text-xs">{s.student_id}</TD>
                    <TD className="font-medium">{s.full_name}</TD>
                    <TD>
                      <Link
                        href={`/admin/erp/classes/${encodeURIComponent(s.class_name)}`}
                        className="hover:underline"
                      >
                        {s.class_name}
                      </Link>
                    </TD>
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
          )}
        </CardContent>
      </Card>
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
