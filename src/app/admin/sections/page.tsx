import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isNextYearAdmission } from "@/lib/broadway";
import { adjustCapacity, createSection, updateSection, deleteSection, retrySectionBroadwaySync } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SectionBroadwayFields } from "@/components/admin/section-broadway-fields";
import { SectionStudentsToggle, type SectionStudentRow } from "@/components/admin/section-students-toggle";
import type { AppStatus, Section } from "@/lib/types";

const BROADWAY_HINT =
  "Broadway class name: start with STD (CBSE) or STAGE (Cambridge); for KG include CBSE or Cambridge.";

export default async function SectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Class sections &amp; capacity</h1>
        <p className="text-muted-foreground">
          Seats fill A → B → C automatically. Add, edit or remove sections here — each one saved is
          sent to Broadway.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Add a section</CardTitle>
          <CardDescription>Create a new division for a grade.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <form action={createSection} className="flex flex-wrap items-end gap-4">
            <SectionBroadwayFields
              variant="create"
              between={
                <div className="space-y-1.5">
                  <Label htmlFor="capacity">Capacity</Label>
                  <Input id="capacity" name="capacity" type="number" defaultValue={30} className="w-28" />
                </div>
              }
            />
            <SubmitButton pendingText="Creating…">Add section</SubmitButton>
          </form>
          <p className="text-xs text-muted-foreground">{BROADWAY_HINT}</p>
        </CardContent>
      </Card>

      <Suspense fallback={<SectionsListSkeleton />}>
        <SectionsList />
      </Suspense>
    </div>
  );
}

function SectionsListSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="space-y-2 pt-6">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-20 w-full animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface BroadwayCountsRow {
  id: string;
  this_year_students: number;
  next_year_students: number;
}

async function SectionsList() {
  const admin = createSupabaseAdminClient();
  const [{ data }, useNextYear] = await Promise.all([
    admin.from("sections").select("*").order("grade", { ascending: true }).order("name", { ascending: true }),
    isNextYearAdmission(),
  ]);
  const sections = (data ?? []) as Section[];

  // Broadway's own student counts for every linked section — a section is
  // treated as fuller than this app's own `filled` counter alone would
  // show whenever Broadway's number (this year's or next year's, whichever
  // admission cycle is running) is the bigger of the two. Broadway's count
  // is the superset: it also includes students added directly in Broadway
  // and, for next year, continuing/joining students this app has no other
  // way to know about.
  const classIds = sections.map((s) => s.broadway_class_id).filter((id): id is string => Boolean(id));
  const { data: countsData } = classIds.length
    ? await admin.from("broadway_classes").select("id, this_year_students, next_year_students").in("id", classIds)
    : { data: [] };
  const countsByClassId = new Map(
    ((countsData ?? []) as BroadwayCountsRow[]).map((c) => [
      c.id,
      useNextYear ? c.next_year_students : c.this_year_students,
    ]),
  );

  const byGrade = sections.reduce<Record<string, Section[]>>((acc, s) => {
    (acc[s.grade] ??= []).push(s);
    return acc;
  }, {});

  // Students currently enrolled in each section — section_id is only ever
  // set by enroll_application, so this is exactly "who's enrolled here".
  // Excludes a withdrawn student: they no longer occupy the seat, even
  // though section_id is deliberately left on their application as a
  // historical record (see markWithdrawn, src/app/marketing/actions.ts).
  const sectionIds = sections.map((s) => s.id);
  const { data: enrolledData } = sectionIds.length
    ? await admin
        .from("applications")
        .select("id, section_id, admission_number, status, students(full_name), parents(full_name)")
        .in("section_id", sectionIds)
        .is("withdrawn_at", null)
    : { data: [] };
  const enrolledRows = (enrolledData ?? []) as unknown as {
    id: string;
    section_id: string;
    admission_number: string | null;
    status: AppStatus;
    students: { full_name: string } | null;
    parents: { full_name: string } | null;
  }[];
  const studentsBySection = enrolledRows.reduce<Record<string, SectionStudentRow[]>>((acc, r) => {
    (acc[r.section_id] ??= []).push({
      id: r.id,
      studentName: r.students?.full_name ?? "—",
      parentName: r.parents?.full_name ?? "—",
      admissionNumber: r.admission_number,
      status: r.status,
    });
    return acc;
  }, {});

  return (
    <>
      {Object.entries(byGrade).map(([grade, list]) => (
        <Card key={grade}>
          <CardHeader>
            <CardTitle>{grade}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {list.map((s) => {
              const broadwayCount = s.broadway_class_id ? countsByClassId.get(s.broadway_class_id) : undefined;
              const effectiveFilled = Math.max(s.filled, broadwayCount ?? 0);
              const pct = Math.min(100, Math.round((effectiveFilled / s.capacity) * 100));
              const full = effectiveFilled >= s.capacity;
              return (
                <div key={s.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <SectionStudentsToggle
                      label={
                        <>
                          Section {s.name}
                          {s.batch && <span className="font-normal text-muted-foreground"> — {s.batch}</span>}
                        </>
                      }
                      students={studentsBySection[s.id] ?? []}
                      currentSectionId={s.id}
                      targetSections={list.map((t) => ({
                        id: t.id,
                        name: t.name,
                        batch: t.batch,
                        filled: t.filled,
                        capacity: t.capacity,
                      }))}
                    />
                    <div className="text-sm text-muted-foreground">
                      {effectiveFilled} / {s.capacity} seats {full && "· full"}
                      {broadwayCount !== undefined && broadwayCount > s.filled && (
                        <span className="ml-1">(Broadway: {broadwayCount})</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {s.broadway_sync_status === "synced" ? (
                      <Badge tone="success">In Broadway: {s.broadway_class_name ?? s.broadway_input_name}</Badge>
                    ) : s.broadway_sync_status === "failed" ? (
                      <>
                        <Badge tone="danger">Not in Broadway: {s.broadway_error}</Badge>
                        <form action={retrySectionBroadwaySync} className="inline-flex">
                          <input type="hidden" name="section_id" value={s.id} />
                          <SubmitButton size="sm" variant="ghost" pendingText="Retrying…">
                            Retry
                          </SubmitButton>
                        </form>
                      </>
                    ) : s.broadway_input_name ? (
                      <Badge tone="neutral">Not sent to Broadway yet</Badge>
                    ) : (
                      <Badge tone="neutral">No Broadway class name set</Badge>
                    )}
                    {s.broadway_warning && (
                      <span className="text-warning">⚠ {s.broadway_warning}</span>
                    )}
                    {s.class_timing && (
                      <span>
                        Timing: <span className="font-medium text-foreground">{s.class_timing}</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={full ? "h-full bg-destructive" : "h-full bg-primary"}
                      style={{ width: `${pct}%` }}
                    />
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <div className="flex flex-wrap items-end gap-3">
                      {/* Edit grade / section / capacity */}
                      <form action={updateSection} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="section_id" value={s.id} />
                        <SectionBroadwayFields
                          variant="edit"
                          idPrefix={s.id}
                          initialGrade={s.grade}
                          initialName={s.name}
                          initialBatch={s.batch ?? ""}
                          initialBroadwayInputName={s.broadway_input_name ?? ""}
                          initialClassTiming={s.class_timing ?? ""}
                          between={
                            <div className="space-y-1">
                              <Label htmlFor={`cap-${s.id}`} className="text-xs">Capacity</Label>
                              <Input
                                id={`cap-${s.id}`}
                                name="capacity"
                                type="number"
                                min={s.filled}
                                defaultValue={s.capacity}
                                className="h-9 w-24"
                                required
                              />
                            </div>
                          }
                        />
                        <SubmitButton size="sm" variant="outline" pendingText="Saving…">
                          Save
                        </SubmitButton>
                      </form>

                      {/* Quick +5 seats */}
                      <form action={adjustCapacity}>
                        <input type="hidden" name="section_id" value={s.id} />
                        <input type="hidden" name="delta" value="5" />
                        <SubmitButton size="sm" variant="outline" pendingText="Adding…">
                          +5 seats
                        </SubmitButton>
                      </form>

                      {/* Delete (only when empty) */}
                      {s.filled === 0 ? (
                        <form action={deleteSection}>
                          <input type="hidden" name="section_id" value={s.id} />
                          <SubmitButton size="sm" variant="destructive" pendingText="Deleting…">
                            Delete
                          </SubmitButton>
                        </form>
                      ) : (
                        <span className="pb-1.5 text-xs text-muted-foreground">
                          Empty before deleting
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{BROADWAY_HINT}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
