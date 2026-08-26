import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { formatInZone, formatInZoneWithDay, toZonedInputValue } from "@/lib/utils";
import { needsAssessment } from "@/lib/assessment";
import { createAssessmentSlot, reassignSlotTeacher, generateZoomLink } from "../actions";
import { AssignAssessmentRow } from "@/components/admin/assign-assessment-row";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { AppStatus } from "@/lib/types";

interface TeacherRow {
  id: string;
  full_name: string | null;
  email: string | null;
}
interface RequestRow {
  id: string;
  grade_applying: string | null;
  preferred_assessment_date: string | null;
  preferred_assessment_date_alt: string | null;
  preferred_assessment_tz: string | null;
  students: { full_name: string } | null;
  parents: { full_name: string; phone: string } | null;
}
interface SlotRow {
  id: string;
  starts_at: string;
  is_open: boolean;
  application_id: string | null;
  teacher_id: string | null;
  claimed_by_teacher: boolean;
  unavailable_reported: boolean;
  zoom_join_url: string | null;
  users: { full_name: string | null; email: string | null } | null;
  applications: {
    status: string;
    grade_applying: string | null;
    students: { full_name: string } | null;
    parents: { full_name: string; phone: string } | null;
  } | null;
}
interface UnavailableRow {
  id: string;
  starts_at: string;
  teacher_id: string | null;
  application_id: string | null;
  users: { full_name: string | null; email: string | null } | null;
  applications: { students: { full_name: string } | null } | null;
}
interface TeacherStats {
  totalSlots: number;
  claimed: number;
  upcoming: number;
  attended: number;
  pass: number;
  fail: number;
}

export default async function AdminAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; teacher?: string }>;
}) {
  const { ok, error, teacher: teacherFilter } = await searchParams;
  const admin = createSupabaseAdminClient();
  const schoolTz = config.school.timezone;
  const schoolLabel = config.school.timezoneLabel;

  let slotQuery = admin
    .from("assessment_slots")
    .select(
      "id, starts_at, is_open, application_id, teacher_id, claimed_by_teacher, unavailable_reported, zoom_join_url, users(full_name, email), applications(status, grade_applying, students(full_name), parents(full_name, phone))",
    )
    .order("starts_at", { ascending: true });
  if (teacherFilter === "unclaimed") {
    slotQuery = slotQuery.is("teacher_id", null);
  } else if (teacherFilter) {
    slotQuery = slotQuery.eq("teacher_id", teacherFilter);
  }

  const [
    { data: teacherData },
    { data: requestData },
    { data: slotData },
    { data: allSlotsData },
    { data: resultsData },
    { data: unavailableData },
  ] = await Promise.all([
    admin
      .from("users")
      .select("id, full_name, email")
      .eq("role", "teacher")
      .eq("disabled", false)
      .order("full_name"),
    admin
      .from("applications")
      .select(
        "id, grade_applying, preferred_assessment_date, preferred_assessment_date_alt, preferred_assessment_tz, students(full_name), parents(full_name, phone)",
      )
      .eq("status", "FORM_SUBMITTED")
      .order("preferred_assessment_date", { ascending: true }),
    slotQuery,
    // Unfiltered, for the per-teacher activity summary below (independent of the table filter).
    admin
      .from("assessment_slots")
      .select("teacher_id, claimed_by_teacher, application_id, starts_at, applications(status)"),
    admin.from("assessment_results").select("teacher_id, outcome"),
    // Also unfiltered — a "can't attend" report needs to stay visible regardless
    // of whatever teacher filter is currently applied to the table below.
    admin
      .from("assessment_slots")
      .select(
        "id, starts_at, teacher_id, application_id, users(full_name, email), applications(students(full_name))",
      )
      .eq("unavailable_reported", true)
      .order("starts_at", { ascending: true }),
  ]);
  const teachers = (teacherData ?? []) as TeacherRow[];
  const requests = ((requestData ?? []) as unknown as RequestRow[]).filter((r) =>
    needsAssessment(r.grade_applying ?? ""),
  );
  const slots = (slotData ?? []) as unknown as SlotRow[];
  const scheduled = slots.filter((s) => s.application_id);
  const unavailableSlots = (unavailableData ?? []) as unknown as UnavailableRow[];

  // Booked vs remaining (open + in-pool) vs expired, for whatever the teacher
  // filter above currently shows.
  const slotCounts = slots.reduce(
    (acc, s) => {
      const booked = !!s.application_id;
      const past = new Date(s.starts_at).getTime() < Date.now();
      if (booked) acc.booked += 1;
      else if (past) acc.expired += 1;
      else if (s.teacher_id) acc.open += 1;
      else acc.pool += 1;
      return acc;
    },
    { booked: 0, open: 0, pool: 0, expired: 0 },
  );
  // Of slots that started open (no teacher pre-assigned at creation): how many
  // a teacher has since claimed vs how many are still sitting unclaimed.
  const claimedCount = slots.filter((s) => s.claimed_by_teacher).length;
  const unclaimedCount = slots.filter((s) => s.teacher_id === null).length;

  const slotSummary = {
    ...slotCounts,
    total: slots.length,
    remaining: slotCounts.open + slotCounts.pool,
    claimed: claimedCount,
    unclaimed: unclaimedCount,
  };

  // Same claimed-vs-unclaimed split as above, broken down by day (school
  // time) — respects the same teacher filter as everything else on screen,
  // so it never shows other teachers' numbers under a filtered view.
  const dayBuckets = new Map<string, { label: string; claimed: number; unclaimed: number }>();
  for (const s of slots) {
    if (s.teacher_id !== null && !s.claimed_by_teacher) continue; // not pool-origin
    const dateKey = toZonedInputValue(s.starts_at, schoolTz).slice(0, 10);
    let bucket = dayBuckets.get(dateKey);
    if (!bucket) {
      const label = new Intl.DateTimeFormat("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: schoolTz,
      }).format(new Date(s.starts_at));
      bucket = { label, claimed: 0, unclaimed: 0 };
      dayBuckets.set(dateKey, bucket);
    }
    if (s.claimed_by_teacher) bucket.claimed += 1;
    else bucket.unclaimed += 1;
  }
  const dayRows = Array.from(dayBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, bucket]) => ({ dateKey, ...bucket }));

  // Per-teacher activity: total slots, self-claimed count, upcoming booked
  // assessments, and how many they've conducted (results recorded) + outcomes.
  const statsByTeacher = new Map<string, TeacherStats>();
  const stats = (id: string) => {
    let s = statsByTeacher.get(id);
    if (!s) {
      s = { totalSlots: 0, claimed: 0, upcoming: 0, attended: 0, pass: 0, fail: 0 };
      statsByTeacher.set(id, s);
    }
    return s;
  };
  const now = Date.now();
  for (const row of (allSlotsData ?? []) as unknown as {
    teacher_id: string | null;
    claimed_by_teacher: boolean;
    application_id: string | null;
    starts_at: string;
    applications: { status: string } | null;
  }[]) {
    if (!row.teacher_id) continue;
    const st = stats(row.teacher_id);
    st.totalSlots += 1;
    if (row.claimed_by_teacher) st.claimed += 1;
    if (
      row.application_id &&
      row.applications?.status === "ASSESSMENT_SCHEDULED" &&
      new Date(row.starts_at).getTime() > now
    ) {
      st.upcoming += 1;
    }
  }
  for (const r of (resultsData ?? []) as unknown as { teacher_id: string | null; outcome: string }[]) {
    if (!r.teacher_id) continue;
    const st = stats(r.teacher_id);
    st.attended += 1;
    if (r.outcome === "PASS") st.pass += 1;
    else if (r.outcome === "FAIL") st.fail += 1;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Assessments</h1>
        <p className="text-muted-foreground">
          Create assessment slots, assign a teacher, and track requests.
        </p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      {unavailableSlots.length > 0 && (
        <Card className="border-warning/40">
          <CardHeader>
            <CardTitle>Needs reassignment ({unavailableSlots.length})</CardTitle>
            <CardDescription>
              Teachers reported they can&apos;t attend these — pick a replacement teacher for each.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {unavailableSlots.map((s) => (
              <form
                key={s.id}
                action={reassignSlotTeacher}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm"
              >
                <input type="hidden" name="slot_id" value={s.id} />
                <div>
                  <span className="font-medium">
                    {formatInZoneWithDay(s.starts_at, schoolTz)} {schoolLabel}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · was {s.users?.full_name ?? s.users?.email ?? "unassigned"}
                    {s.applications?.students?.full_name && ` · ${s.applications.students.full_name}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Select name="teacher_id" required defaultValue="" className="h-9 w-48">
                    <option value="" disabled>
                      New teacher…
                    </option>
                    {teachers
                      .filter((t) => t.id !== s.teacher_id)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.full_name ?? t.email}
                        </option>
                      ))}
                  </Select>
                  <SubmitButton size="sm" pendingText="Reassigning…">
                    Reassign
                  </SubmitButton>
                </div>
              </form>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create slots</CardTitle>
          <CardDescription>
            Pick a weekday, time and how many slots to open — e.g. Monday 8:00 PM, 10 slots — and
            any teacher can claim one from their dashboard, first-come first-served. Repeat it
            weekly, or assign a single slot to a specific teacher instead. The weekday resolves to
            its next upcoming date; waiting parents are notified either way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 && (
            <Alert variant="warning" className="mb-4">
              No teachers yet. Invite a teacher from the Staff page — until then, open slots have
              no one to claim them.
            </Alert>
          )}
          <form action={createAssessmentSlot} className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="weekday">Day</Label>
              <Select id="weekday" name="weekday" defaultValue="1" className="w-36">
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                <option value="0">Sunday</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time">Time ({schoolLabel})</Label>
              <Input id="time" name="time" type="time" required className="w-32" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="duration">Duration (min)</Label>
              <Input
                id="duration"
                name="duration"
                type="number"
                min={10}
                max={240}
                defaultValue={30}
                className="w-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quantity">Slots per week</Label>
              <Input
                id="quantity"
                name="quantity"
                type="number"
                min={1}
                max={50}
                defaultValue={1}
                className="w-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="weeks">Repeat for (weeks)</Label>
              <Input
                id="weeks"
                name="weeks"
                type="number"
                min={1}
                max={26}
                defaultValue={1}
                className="w-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="teacher_id">Assign teacher</Label>
              <Select id="teacher_id" name="teacher_id" defaultValue="" className="min-w-56">
                <option value="">Open — any teacher can claim it</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name ?? t.email}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">
                Only when slots per week and repeat weeks are both 1. Otherwise leave as
                &quot;Open&quot;.
              </p>
            </div>
            <SubmitButton pendingText="Creating…">Create slot(s)</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assessment requests ({requests.length})</CardTitle>
          <CardDescription>
            Grade applicants awaiting an assessment. <strong>Schedule directly</strong> below to confirm
            a time with a teacher (parent just gets a confirmation), or create open slots above for
            parents to book themselves.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending requests.</p>
          ) : (
            requests.map((r) => {
              const tz = r.preferred_assessment_tz;
              return (
                <AssignAssessmentRow
                  key={r.id}
                  applicationId={r.id}
                  studentName={r.students?.full_name ?? "Applicant"}
                  grade={r.grade_applying}
                  phone={r.parents?.phone ?? null}
                  preferred={
                    r.preferred_assessment_date
                      ? {
                          label: `${formatInZone(r.preferred_assessment_date, schoolTz)} ${schoolLabel}`,
                          value: toZonedInputValue(r.preferred_assessment_date, schoolTz),
                        }
                      : null
                  }
                  preferredAlt={
                    r.preferred_assessment_date_alt
                      ? {
                          label: `${formatInZone(r.preferred_assessment_date_alt, schoolTz)} ${schoolLabel}`,
                          value: toZonedInputValue(r.preferred_assessment_date_alt, schoolTz),
                        }
                      : null
                  }
                  parentLabel={
                    r.preferred_assessment_date && tz && tz !== schoolTz
                      ? `${formatInZone(r.preferred_assessment_date, tz)} (${tz})`
                      : null
                  }
                  teachers={teachers.map((t) => ({ id: t.id, label: t.full_name ?? t.email ?? t.id }))}
                />
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled assessments ({scheduled.length})</CardTitle>
          <CardDescription>Booked assessments — student, teacher, and confirmed time.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {scheduled.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled assessments yet.</p>
          ) : (
            scheduled.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">
                    {s.applications?.students?.full_name ?? "Applicant"}
                  </span>
                  <span className="text-muted-foreground">
                    {" "}· Grade {s.applications?.grade_applying ?? "—"} · {s.users?.full_name ?? "Unassigned"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatInZone(s.starts_at, schoolTz)} {schoolLabel}
                  </span>
                  <StatusBadge status={(s.applications?.status ?? "ASSESSMENT_SCHEDULED") as AppStatus} />
                  {!s.zoom_join_url && s.applications?.status !== "ASSESSMENT_COMPLETED" && (
                    <form action={generateZoomLink}>
                      <input type="hidden" name="application_id" value={s.application_id!} />
                      <SubmitButton size="sm" variant="outline" pendingText="Creating…">
                        Generate Zoom link
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teacher activity ({teachers.length})</CardTitle>
          <CardDescription>
            How many assessments each teacher has attended and their pass/fail record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teachers yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Teacher</TH>
                  <TH>Total slots</TH>
                  <TH>Self-claimed</TH>
                  <TH>Upcoming</TH>
                  <TH>Attended</TH>
                  <TH>Pass</TH>
                  <TH>Fail</TH>
                </TR>
              </THead>
              <TBody>
                {teachers.map((t) => {
                  const st = statsByTeacher.get(t.id) ?? {
                    totalSlots: 0,
                    claimed: 0,
                    upcoming: 0,
                    attended: 0,
                    pass: 0,
                    fail: 0,
                  };
                  return (
                    <TR key={t.id}>
                      <TD>
                        <div className="font-medium">{t.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{t.email}</div>
                      </TD>
                      <TD>{st.totalSlots}</TD>
                      <TD>{st.claimed}</TD>
                      <TD>{st.upcoming}</TD>
                      <TD className="font-medium">{st.attended}</TD>
                      <TD>
                        <Badge tone="success">{st.pass}</Badge>
                      </TD>
                      <TD>
                        <Badge tone="danger">{st.fail}</Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All slots ({slots.length})</CardTitle>
          <CardDescription>
            Every slot, which teacher has it and how they got it, and the booked applicant if any.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/assessments"
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="teacher_filter">Filter by teacher</Label>
              <Select
                id="teacher_filter"
                name="teacher"
                defaultValue={teacherFilter ?? ""}
                className="min-w-56"
              >
                <option value="">All teachers</option>
                <option value="unclaimed">Unclaimed (pool)</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.full_name ?? t.email}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
          </form>

          <div className="mb-4 space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">{slotSummary.total} slots (this filter):</span>
              <Badge tone="success">{slotSummary.booked} booked</Badge>
              <Badge tone="info">{slotSummary.remaining} remaining</Badge>
              <span className="text-xs text-muted-foreground">
                ({slotSummary.open} open · {slotSummary.pool} in pool · {slotSummary.expired} expired)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Open (pool) slots:</span>
              <Badge tone="success">{slotSummary.claimed} claimed by teachers</Badge>
              <Badge tone="warning">{slotSummary.unclaimed} still unclaimed</Badge>
            </div>
          </div>

          {dayRows.length > 0 && (
            <div className="mb-4 overflow-x-auto rounded-md border border-border">
              <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                Day-wise, for this filter
              </p>
              <Table>
                <THead>
                  <TR>
                    <TH>Day</TH>
                    <TH>Claimed</TH>
                    <TH>Unclaimed</TH>
                  </TR>
                </THead>
                <TBody>
                  {dayRows.map((d) => (
                    <TR key={d.dateKey}>
                      <TD className="whitespace-nowrap">{d.label}</TD>
                      <TD>
                        <Badge tone="success">{d.claimed}</Badge>
                      </TD>
                      <TD>
                        <Badge tone="warning">{d.unclaimed}</Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}

          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No slots match this filter.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date &amp; time</TH>
                  <TH>Teacher</TH>
                  <TH>Assigned via</TH>
                  <TH>Status</TH>
                  <TH>Applicant</TH>
                  <TH>Reassign</TH>
                </TR>
              </THead>
              <TBody>
                {slots.map((s) => {
                  const booked = !!s.application_id;
                  const unclaimed = !s.teacher_id && !booked;
                  const past = new Date(s.starts_at).getTime() < Date.now();
                  const tone = booked ? "success" : past ? "neutral" : unclaimed ? "warning" : "info";
                  const label = booked ? "Booked" : past ? "Expired" : unclaimed ? "In teacher pool" : "Open";
                  const assignedVia = unclaimed ? "—" : s.claimed_by_teacher ? "Self-claimed" : "Admin-assigned";
                  return (
                    <TR key={s.id}>
                      <TD className="whitespace-nowrap">
                        {formatInZoneWithDay(s.starts_at, schoolTz)} {schoolLabel}
                      </TD>
                      <TD>
                        {unclaimed ? (
                          <span className="text-muted-foreground">Unclaimed</span>
                        ) : (
                          <div>
                            <div className="font-medium">{s.users?.full_name ?? "—"}</div>
                            {s.users?.email && (
                              <div className="text-xs text-muted-foreground">{s.users.email}</div>
                            )}
                            {s.unavailable_reported && (
                              <Badge tone="warning" className="mt-1">
                                Can&apos;t attend
                              </Badge>
                            )}
                          </div>
                        )}
                      </TD>
                      <TD className="text-muted-foreground">{assignedVia}</TD>
                      <TD>
                        <Badge tone={tone}>{label}</Badge>
                      </TD>
                      <TD>
                        {booked && s.applications?.students?.full_name ? (
                          <div>
                            <div className="font-medium">{s.applications.students.full_name}</div>
                            <div className="text-xs text-muted-foreground">
                              Grade {s.applications.grade_applying ?? "—"}
                              {s.applications.parents?.phone && ` · ${s.applications.parents.phone}`}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                      <TD>
                        {s.teacher_id && !past ? (
                          <form action={reassignSlotTeacher} className="flex items-center gap-1.5">
                            <input type="hidden" name="slot_id" value={s.id} />
                            <Select name="teacher_id" required defaultValue="" className="h-9 w-36">
                              <option value="" disabled>
                                New teacher…
                              </option>
                              {teachers
                                .filter((t) => t.id !== s.teacher_id)
                                .map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.full_name ?? t.email}
                                  </option>
                                ))}
                            </Select>
                            <SubmitButton size="sm" variant="outline" pendingText="…">
                              Move
                            </SubmitButton>
                          </form>
                        ) : (
                          <span className="text-muted-foreground">—</span>
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
