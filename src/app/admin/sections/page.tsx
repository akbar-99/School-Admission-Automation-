import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { adjustCapacity, createSection, updateSection, deleteSection } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SectionErpFields } from "@/components/admin/section-erp-fields";
import { DuplicateBlockedAlert } from "@/components/admin/duplicate-blocked-alert";
import { SectionStudentsToggle, type SectionStudentRow } from "@/components/admin/section-students-toggle";
import type { AppStatus, Section } from "@/lib/types";

const ERP_SYNC_LABEL: Record<Section["erp_sync_status"], { label: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  pending: { label: "Not yet pushed to ERP", tone: "neutral" },
  synced: { label: "Synced to ERP", tone: "success" },
  conflict: { label: "ERP conflict — resolve in ERP", tone: "danger" },
  failed: { label: "ERP push failed", tone: "warning" },
};

export default async function SectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; duplicate?: string }>;
}) {
  const { ok, error, duplicate } = await searchParams;

  return (
    <div className="space-y-6">
      {duplicate && <DuplicateBlockedAlert message={duplicate} />}
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Class sections &amp; capacity</h1>
        <p className="text-muted-foreground">
          Seats fill A → B → C automatically. Add, edit or remove sections here.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Add a section</CardTitle>
          <CardDescription>Create a new division for a grade.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createSection} className="flex flex-wrap items-end gap-4">
            <SectionErpFields
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

async function SectionsList() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("sections")
    .select("*")
    .order("grade", { ascending: true })
    .order("name", { ascending: true });
  const sections = (data ?? []) as Section[];

  const byGrade = sections.reduce<Record<string, Section[]>>((acc, s) => {
    (acc[s.grade] ??= []).push(s);
    return acc;
  }, {});

  // Students currently enrolled in each section — section_id is only ever
  // set by enroll_application, so this is exactly "who's enrolled here".
  const sectionIds = sections.map((s) => s.id);
  const { data: enrolledData } = sectionIds.length
    ? await admin
        .from("applications")
        .select("id, section_id, admission_number, status, students(full_name), parents(full_name)")
        .in("section_id", sectionIds)
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
              const pct = Math.min(100, Math.round((s.filled / s.capacity) * 100));
              const full = s.filled >= s.capacity;
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
                      {s.filled} / {s.capacity} seats {full && "· full"}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      ERP class:{" "}
                      {s.erp_class_name ? (
                        <span className="font-medium text-foreground">{s.erp_class_name}</span>
                      ) : (
                        <span className="text-warning">not mapped</span>
                      )}
                    </span>
                    <Badge tone={ERP_SYNC_LABEL[s.erp_sync_status].tone}>
                      {ERP_SYNC_LABEL[s.erp_sync_status].label}
                    </Badge>
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

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    {/* Edit grade / section / capacity */}
                    <form action={updateSection} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="section_id" value={s.id} />
                      <SectionErpFields
                        variant="edit"
                        idPrefix={s.id}
                        initialGrade={s.grade}
                        initialName={s.name}
                        initialBatch={s.batch ?? ""}
                        initialErpClassName={s.erp_class_name ?? ""}
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
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
