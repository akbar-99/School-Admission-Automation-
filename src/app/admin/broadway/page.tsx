import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { syncBroadwayNow, retryBroadwayAdmission } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

interface BroadwayClassRow {
  id: string;
  name: string;
  curriculum: string;
  grade_label: string;
  this_year_seats_left: number | null;
  next_year_seats_left: number | null;
  synced_at: string;
}

interface NeedsAttentionRow {
  id: string;
  admission_number: string | null;
  grade_applying: string | null;
  broadway_status: "no_mapping" | "send_failed";
  broadway_class_name: string | null;
  broadway_warning: string | null;
  students: { full_name: string } | null;
  parents: { full_name: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  no_mapping: "Section has no Broadway class linked",
  send_failed: "Broadway send failed",
};

export default async function BroadwayIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; q?: string }>;
}) {
  const { ok, error, q } = await searchParams;
  const query = q?.trim() ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Broadway integration</h1>
        <p className="text-muted-foreground">
          Cached Broadway classes (reference only) and admissions that need attention syncing to
          Broadway.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardContent className="pt-6">
          <form action="/admin/broadway" method="get" className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1 space-y-1.5">
              <label htmlFor="q" className="text-sm font-medium">
                Search classes or students
              </label>
              <Input id="q" name="q" defaultValue={query} placeholder="Class name, student name, or admission number" />
            </div>
            <Button type="submit" variant="outline">
              Search
            </Button>
            {query && (
              <Link href="/admin/broadway" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
          </form>
        </CardContent>
      </Card>

      {query ? (
        <Suspense fallback={<BroadwayBodySkeleton />}>
          <SearchResults query={query} />
        </Suspense>
      ) : (
        <>
          <Alert variant="info">
            Which Broadway class each section corresponds to is set per-section under{" "}
            <Link href="/admin/sections" className="underline">
              Admin → Sections
            </Link>{" "}
            — this app&apos;s own sections already decide which division a student lands in, so
            Broadway just needs to know which of its own classes that division maps to.
          </Alert>

          <Suspense fallback={<BroadwayBodySkeleton />}>
            <BroadwayBody />
          </Suspense>
        </>
      )}
    </div>
  );
}

interface StudentCacheRow {
  student_id: string;
  admission_no: string | null;
  full_name: string;
  class_id: string | null;
  class_name: string | null;
  planned_class_id: string | null;
  planned_class_name: string | null;
  status: string;
  application_id: string | null;
}

async function SearchResults({ query }: { query: string }) {
  const admin = createSupabaseAdminClient();
  const like = `%${query}%`;

  const [{ data: classRows }, { data: byName }, { data: byAdmissionNo }, { count: cacheCount }] = await Promise.all([
    admin
      .from("broadway_classes")
      .select("id, name, curriculum, grade_label, this_year_seats_left, next_year_seats_left")
      .ilike("name", like)
      .order("name", { ascending: true })
      .limit(50),
    admin
      .from("broadway_students")
      .select("student_id, admission_no, full_name, class_id, class_name, planned_class_id, planned_class_name, status, application_id")
      .ilike("full_name", like)
      .limit(50),
    admin
      .from("broadway_students")
      .select("student_id, admission_no, full_name, class_id, class_name, planned_class_id, planned_class_name, status, application_id")
      .ilike("admission_no", like)
      .limit(50),
    admin.from("broadway_students").select("student_id", { count: "exact", head: true }),
  ]);

  const classes = classRows ?? [];
  const merged = new Map<string, StudentCacheRow>();
  for (const r of [...((byName ?? []) as StudentCacheRow[]), ...((byAdmissionNo ?? []) as StudentCacheRow[])]) {
    merged.set(r.student_id, r);
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
                <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <Link href={`/admin/broadway/classes/${encodeURIComponent(c.id)}`} className="font-medium hover:underline">
                    {c.name} <span className="text-muted-foreground">({c.curriculum} {c.grade_label})</span>
                  </Link>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {c.this_year_seats_left ?? "∞"} left this yr
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
              The student search cache is empty — click &quot;Sync now&quot; to pull the roster from
              Broadway first.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {cacheEmpty ? (
            <form action={syncBroadwayNow}>
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
                  <TH>Admission no.</TH>
                  <TH>Full name</TH>
                  <TH>Status</TH>
                  <TH>Class</TH>
                  <TH>Tracked locally</TH>
                </TR>
              </THead>
              <TBody>
                {students.map((s) => {
                  const classId = s.class_id ?? s.planned_class_id;
                  const className = s.class_name ?? s.planned_class_name;
                  return (
                    <TR key={s.student_id}>
                      <TD className="font-mono text-xs">{s.admission_no ?? "—"}</TD>
                      <TD className="font-medium">{s.full_name}</TD>
                      <TD>{s.status}</TD>
                      <TD>
                        {classId ? (
                          <Link href={`/admin/broadway/classes/${encodeURIComponent(classId)}`} className="hover:underline">
                            {className}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TD>
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
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BroadwayBodySkeleton() {
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

async function BroadwayBody() {
  const admin = createSupabaseAdminClient();

  const [{ data: classRows }, { data: attentionRows }] = await Promise.all([
    admin
      .from("broadway_classes")
      .select("id, name, curriculum, grade_label, this_year_seats_left, next_year_seats_left, synced_at")
      .order("grade", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("applications")
      .select(
        "id, admission_number, grade_applying, broadway_status, broadway_class_name, broadway_warning, students(full_name), parents(full_name)",
      )
      .in("broadway_status", ["no_mapping", "send_failed"])
      .order("created_at", { ascending: false }),
  ]);

  const classes = (classRows ?? []) as BroadwayClassRow[];
  const attention = (attentionRows ?? []) as unknown as NeedsAttentionRow[];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Cached Broadway classes ({classes.length})</CardTitle>
          <CardDescription>
            Reference only — not used for local seat allocation (this app&apos;s own sections decide
            that). Useful for picking the right Broadway class while linking a section under Admin →
            Sections. Click a class name to see which students this app has mapped to it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={syncBroadwayNow}>
            <SubmitButton size="sm" pendingText="Syncing…">
              Sync now
            </SubmitButton>
          </form>
          {classes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cached classes yet — click &quot;Sync now&quot; to pull them from Broadway.
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Class name</TH>
                  <TH>Curriculum / grade</TH>
                  <TH>Seats left (this yr)</TH>
                  <TH>Seats left (next yr)</TH>
                  <TH>Synced</TH>
                </TR>
              </THead>
              <TBody>
                {classes.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">
                      <Link href={`/admin/broadway/classes/${encodeURIComponent(c.id)}`} className="hover:underline">
                        {c.name}
                      </Link>
                    </TD>
                    <TD>{c.curriculum} {c.grade_label}</TD>
                    <TD>{c.this_year_seats_left ?? "∞"}</TD>
                    <TD>{c.next_year_seats_left ?? "∞"}</TD>
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
          <CardDescription>Admissions that couldn&apos;t sync to Broadway automatically.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing needs attention.</p>
          ) : (
            <>
              <Link href="/admin/sections" className={buttonVariants({ variant: "outline", size: "sm" })}>
                Edit section links
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
                        <Badge tone="warning">{STATUS_LABEL[a.broadway_status] ?? a.broadway_status}</Badge>
                        {a.broadway_class_name && (
                          <span className="ml-2 text-xs text-muted-foreground">→ {a.broadway_class_name}</span>
                        )}
                        {a.broadway_warning && (
                          <div className="mt-1 max-w-56 text-xs text-muted-foreground">{a.broadway_warning}</div>
                        )}
                      </TD>
                      <TD className="text-right">
                        <form action={retryBroadwayAdmission} className="inline-flex">
                          <input type="hidden" name="application_id" value={a.id} />
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
