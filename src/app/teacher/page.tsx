import { getSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { formatDate, formatInZone } from "@/lib/utils";
import { submitResult, claimAssessmentSlot, reportUnavailable } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { OpenSlotsPool, type PoolSeries } from "@/components/teacher/open-slots-pool";
import { TeacherLiveAlerts } from "@/components/teacher/live-alerts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Video } from "lucide-react";

interface SlotRow {
  id: string;
  starts_at: string;
  ends_at: string;
  is_open: boolean;
  application_id: string | null;
  zoom_start_url: string | null;
  unavailable_reported: boolean;
  applications: {
    id: string;
    status: string;
    grade_applying: string | null;
    students: { full_name: string; dob: string | null } | null;
    parents: { full_name: string; phone: string; email: string | null } | null;
  } | null;
}

interface PoolSlotRow {
  id: string;
  starts_at: string;
}

export default async function TeacherPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    recorded?: string;
    claimed?: string;
    reported?: string;
    released?: string;
  }>;
}) {
  const { error, recorded, claimed, reported, released } = await searchParams;
  const session = await getSessionUser();
  const teacherId = session!.profile!.id;
  const admin = createSupabaseAdminClient();
  const schoolTz = config.school.timezone;
  const schoolLabel = config.school.timezoneLabel;
  const subjects = (await getSettings()).assessmentSubjectsItems;

  // The slots assigned to this teacher (by an admin, or previously self-claimed).
  const { data } = await admin
    .from("assessment_slots")
    .select(
      "id, starts_at, ends_at, is_open, application_id, zoom_start_url, unavailable_reported, applications(id, status, grade_applying, students(full_name, dob), parents(full_name, phone, email))",
    )
    .eq("teacher_id", teacherId)
    .order("starts_at", { ascending: true });
  const slots = (data ?? []) as unknown as SlotRow[];

  // Open, unassigned slots any teacher can claim on a first-come basis.
  const { data: poolData } = await admin
    .from("assessment_slots")
    .select("id, starts_at")
    .is("teacher_id", null)
    .is("application_id", null)
    .eq("is_open", true)
    .gt("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);
  const openPool = (poolData ?? []) as PoolSlotRow[];

  // Group same-time slots so "Monday 8:00 PM, 10 slots" reads as one row
  // with a count, rather than 10 duplicate rows. Claiming posts one specific
  // slot id from the group; if it's taken in the meantime the RPC rejects it
  // and the teacher can just try again from the (now smaller) group.
  const poolGroups = Object.values(
    openPool.reduce<Record<string, { startsAt: string; slotId: string; count: number }>>((acc, s) => {
      const g = (acc[s.starts_at] ??= { startsAt: s.starts_at, slotId: s.id, count: 0 });
      g.count += 1;
      return acc;
    }, {}),
  ).sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  // Further group same weekday+time groups into one collapsible series, so a
  // weekly-recurring batch (e.g. "Monday 8:30 PM" x8 weeks) reads as one row
  // with an expand toggle instead of 8 near-identical rows.
  const seriesMap = new Map<string, PoolSeries>();
  for (const g of poolGroups) {
    const d = new Date(g.startsAt);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: schoolTz }).format(d);
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: schoolTz,
    }).format(d);
    const key = `${weekday}-${time}`;
    let series = seriesMap.get(key);
    if (!series) {
      series = { key, seriesLabel: `${weekday}, ${time}`, occurrences: [], totalCount: 0 };
      seriesMap.set(key, series);
    }
    series.occurrences.push({ slotId: g.slotId, startsAt: g.startsAt, count: g.count });
    series.totalCount += g.count;
  }
  const poolSeries = Array.from(seriesMap.values()).sort((a, b) =>
    a.occurrences[0].startsAt.localeCompare(b.occurrences[0].startsAt),
  );

  const now = Date.now();
  const toRecord = slots.filter(
    (s) => s.applications && s.applications.status === "ASSESSMENT_SCHEDULED",
  );
  const upcoming = slots.filter(
    (s) => s.is_open && !s.application_id && new Date(s.starts_at).getTime() > now,
  );
  // "Catch up" alerts for the live-popup component — anything already
  // booked by the time this page rendered, so a teacher who wasn't on the
  // page for the live Realtime event still gets notified on their next visit.
  const initialAlerts = toRecord.map((s) => ({
    id: s.id,
    text: `${s.applications?.students?.full_name ?? "A parent"} booked your assessment slot on ${formatInZone(s.starts_at, schoolTz)} ${schoolLabel}.`,
  }));

  return (
    <div className="space-y-6">
      <TeacherLiveAlerts teacherId={teacherId} initialAlerts={initialAlerts} />
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">My assessments</h1>
        <p className="text-muted-foreground">
          Your assigned assessment slots. Record results once an applicant has been assessed.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {recorded && <Alert variant="success">Result recorded.</Alert>}
      {claimed && <Alert variant="success">Slot claimed — it&apos;s now on your schedule.</Alert>}
      {reported && (
        <Alert variant="success">Reported — the admin has been notified to reassign it.</Alert>
      )}
      {released && <Alert variant="success">Slot released back to the open pool.</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Open slots — claim one ({openPool.length})</CardTitle>
          <CardDescription>
            Unassigned slots any teacher can take. First to claim gets it, instantly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {poolSeries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open slots in the pool right now.</p>
          ) : (
            <OpenSlotsPool
              series={poolSeries}
              schoolTz={schoolTz}
              schoolLabel={schoolLabel}
              claimAction={claimAssessmentSlot}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assessments to record ({toRecord.length})</CardTitle>
          <CardDescription>Booked assessments assigned to you, awaiting a result.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {toRecord.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assessments awaiting a result.</p>
          ) : (
            toRecord.map((s) => (
              <div key={s.id} className="space-y-3 rounded-md border border-border p-4">
              <form
                action={submitResult}
                className="space-y-3"
              >
                <input type="hidden" name="application_id" value={s.application_id!} />
                <input type="hidden" name="slot_id" value={s.id} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">
                      {s.applications?.students?.full_name ?? "Applicant"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Grade {s.applications?.grade_applying}</span>
                      {s.applications?.students?.dob && (
                        <span>DOB {formatDate(s.applications.students.dob)}</span>
                      )}
                      <span>Slot {formatInZone(s.starts_at, schoolTz)} {schoolLabel}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        Parent:{" "}
                        <span className="font-medium text-foreground">
                          {s.applications?.parents?.full_name ?? "—"}
                        </span>
                      </span>
                      {s.applications?.parents?.phone && (
                        <a
                          href={`tel:${s.applications.parents.phone}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.applications.parents.phone}
                        </a>
                      )}
                      {s.applications?.parents?.email && (
                        <a
                          href={`mailto:${s.applications.parents.email}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.applications.parents.email}
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Badge tone="info">Booked</Badge>
                    {s.unavailable_reported && (
                      <Badge tone="warning">Reported — awaiting reassignment</Badge>
                    )}
                    {s.zoom_start_url && (
                      <a
                        href={s.zoom_start_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ size: "sm" })}
                      >
                        <Video className="size-4" />
                        Start Zoom (host)
                      </a>
                    )}
                  </div>
                </div>

                {/* Per-subject scores, comments and PDF/Excel attachments */}
                <div className="space-y-2">
                  <input type="hidden" name="subject_count" value={subjects.length} />
                  <div className="text-sm font-semibold">Subject scores</div>
                  {subjects.map((subj, i) => (
                    <div key={subj} className="space-y-2 rounded-md border border-border/60 p-3">
                      <input type="hidden" name={`subject_${i}`} value={subj} />
                      <div className="text-sm font-medium">{subj}</div>
                      <div className="grid items-start gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_14rem]">
                        <div className="space-y-1">
                          <Label htmlFor={`score-${s.id}-${i}`} className="text-xs">Score</Label>
                          <div className="flex h-9 w-fit items-center rounded-md border border-input bg-card px-1.5 shadow-soft transition-colors focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-ring">
                            <input
                              id={`score-${s.id}-${i}`}
                              name={`score_${i}`}
                              type="number"
                              min={0}
                              step="1"
                              placeholder="—"
                              className="h-full w-12 bg-transparent text-center text-sm tabular-nums outline-none placeholder:text-muted-foreground/70 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                            <span className="select-none px-0.5 text-muted-foreground">/</span>
                            <input
                              aria-label={`${subj} maximum score`}
                              name={`max_${i}`}
                              type="number"
                              min={1}
                              step="1"
                              defaultValue={100}
                              className="h-full w-12 bg-transparent text-center text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`comment-${s.id}-${i}`} className="text-xs">Comment</Label>
                          <Input
                            id={`comment-${s.id}-${i}`}
                            name={`comment_${i}`}
                            placeholder="Optional comment…"
                            className="h-9 w-full"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`file-${s.id}-${i}`} className="text-xs">Attachment (PDF / Excel)</Label>
                          <Input
                            id={`file-${s.id}-${i}`}
                            name={`file_${i}`}
                            type="file"
                            accept=".pdf,.xls,.xlsx,.csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                            className="h-9 w-full items-center py-0 file:my-0 file:py-1"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                  <div className="space-y-1.5">
                    <Label>Overall result</Label>
                    <Select name="outcome" defaultValue="PASS">
                      <option value="PASS">Pass</option>
                      <option value="FAIL">Fail</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Overall remarks</Label>
                    <Textarea name="remarks" placeholder="Optional remarks…" className="min-h-10" />
                  </div>
                </div>
                <SubmitButton size="sm" pendingText="Saving…">
                  Record result
                </SubmitButton>
              </form>
              {!s.unavailable_reported && (
                <form action={reportUnavailable}>
                  <input type="hidden" name="slot_id" value={s.id} />
                  <SubmitButton size="sm" variant="outline" pendingText="Reporting…">
                    Can&apos;t attend — notify admin
                  </SubmitButton>
                </form>
              )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your upcoming slots ({upcoming.length})</CardTitle>
          <CardDescription>Assigned by admin, awaiting a parent booking.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming slots assigned to you.</p>
          ) : (
            upcoming.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{formatInZone(s.starts_at, schoolTz)} {schoolLabel}</span>
                <div className="flex items-center gap-2">
                  <Badge tone="info">Open</Badge>
                  <form action={reportUnavailable}>
                    <input type="hidden" name="slot_id" value={s.id} />
                    <SubmitButton size="sm" variant="outline" pendingText="…">
                      Can&apos;t attend
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
