import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { formatDateTime, formatInZone } from "@/lib/utils";
import { createAssessmentSlot, assignAssessment } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
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
  users: { full_name: string | null } | null;
  applications: {
    status: string;
    grade_applying: string | null;
    students: { full_name: string } | null;
  } | null;
}

export default async function AdminAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const admin = createSupabaseAdminClient();
  const schoolTz = config.school.timezone;
  const schoolLabel = config.school.timezoneLabel;

  const [{ data: teacherData }, { data: requestData }, { data: slotData }] = await Promise.all([
    admin.from("users").select("id, full_name, email").eq("role", "teacher").order("full_name"),
    admin
      .from("applications")
      .select(
        "id, grade_applying, preferred_assessment_date, preferred_assessment_date_alt, preferred_assessment_tz, students(full_name), parents(full_name, phone)",
      )
      .eq("category", "GRADE")
      .eq("status", "FORM_SUBMITTED")
      .order("preferred_assessment_date", { ascending: true }),
    admin
      .from("assessment_slots")
      .select(
        "id, starts_at, is_open, application_id, users(full_name), applications(status, grade_applying, students(full_name))",
      )
      .order("starts_at", { ascending: true }),
  ]);
  const teachers = (teacherData ?? []) as TeacherRow[];
  const requests = (requestData ?? []) as unknown as RequestRow[];
  const slots = (slotData ?? []) as unknown as SlotRow[];
  const scheduled = slots.filter((s) => s.application_id);

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

      <Card>
        <CardHeader>
          <CardTitle>Create &amp; assign a slot</CardTitle>
          <CardDescription>
            The assigned teacher sees it on their dashboard; waiting parents are notified slots are open.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {teachers.length === 0 ? (
            <Alert variant="warning">
              No teachers yet. Invite a teacher from the Staff page first.
            </Alert>
          ) : (
            <form action={createAssessmentSlot} className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="starts_at">Start time</Label>
                <Input id="starts_at" name="starts_at" type="datetime-local" required />
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
                <Label htmlFor="teacher_id">Assign teacher</Label>
                <Select id="teacher_id" name="teacher_id" required defaultValue="" className="min-w-44">
                  <option value="" disabled>
                    Select…
                  </option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name ?? t.email}
                    </option>
                  ))}
                </Select>
              </div>
              <SubmitButton pendingText="Creating…">Create slot</SubmitButton>
            </form>
          )}
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
            requests.map((r) => (
              <div key={r.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div>
                    <span className="font-medium">{r.students?.full_name ?? "Applicant"}</span>
                    <span className="text-muted-foreground"> · Grade {r.grade_applying}</span>
                    {r.parents?.phone && (
                      <a href={`tel:${r.parents.phone}`} className="ml-2 text-primary hover:underline">
                        {r.parents.phone}
                      </a>
                    )}
                  </div>
                  <div className="text-right text-xs">
                    {r.preferred_assessment_date ? (
                      <>
                        <div className="font-medium text-foreground">
                          Requested: {formatInZone(r.preferred_assessment_date, schoolTz)} {schoolLabel}
                        </div>
                        {r.preferred_assessment_tz && r.preferred_assessment_tz !== schoolTz && (
                          <div className="text-muted-foreground">
                            Parent: {formatInZone(r.preferred_assessment_date, r.preferred_assessment_tz)} (
                            {r.preferred_assessment_tz})
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">No preferred time</span>
                    )}
                  </div>
                </div>
                {teachers.length > 0 && (
                  <form
                    action={assignAssessment}
                    className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2"
                  >
                    <input type="hidden" name="application_id" value={r.id} />
                    <div className="space-y-1">
                      <Label htmlFor={`time-${r.id}`} className="text-xs">
                        Confirmed time
                      </Label>
                      <Input id={`time-${r.id}`} name="starts_at" type="datetime-local" required className="h-9" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`dur-${r.id}`} className="text-xs">
                        Min
                      </Label>
                      <Input
                        id={`dur-${r.id}`}
                        name="duration"
                        type="number"
                        min={10}
                        max={240}
                        defaultValue={30}
                        className="h-9 w-20"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`teach-${r.id}`} className="text-xs">
                        Teacher
                      </Label>
                      <Select
                        id={`teach-${r.id}`}
                        name="teacher_id"
                        required
                        defaultValue=""
                        className="h-9 min-w-36"
                      >
                        <option value="" disabled>
                          Select…
                        </option>
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.full_name ?? t.email}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <SubmitButton size="sm" pendingText="Scheduling…">
                      Schedule directly
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
                  <span className="text-xs text-muted-foreground">{formatDateTime(s.starts_at)}</span>
                  <StatusBadge status={(s.applications?.status ?? "ASSESSMENT_SCHEDULED") as AppStatus} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All slots ({slots.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No slots yet.</p>
          ) : (
            slots.map((s) => {
              const booked = !!s.application_id;
              const past = new Date(s.starts_at).getTime() < Date.now();
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{formatDateTime(s.starts_at)}</span>
                    <span className="text-muted-foreground"> · {s.users?.full_name ?? "Unassigned"}</span>
                    {booked && s.applications?.students?.full_name && (
                      <span className="text-muted-foreground"> · {s.applications.students.full_name}</span>
                    )}
                  </div>
                  <Badge tone={booked ? "success" : past ? "neutral" : "info"}>
                    {booked ? "Booked" : past ? "Expired" : "Open"}
                  </Badge>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
