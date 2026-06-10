import { getSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { formatDate, formatInZone } from "@/lib/utils";
import { submitResult } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

interface SlotRow {
  id: string;
  starts_at: string;
  ends_at: string;
  is_open: boolean;
  application_id: string | null;
  applications: {
    id: string;
    status: string;
    grade_applying: string | null;
    students: { full_name: string; dob: string | null } | null;
    parents: { full_name: string; phone: string; email: string | null } | null;
  } | null;
}

export default async function TeacherPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; recorded?: string }>;
}) {
  const { error, recorded } = await searchParams;
  const session = await getSessionUser();
  const teacherId = session!.profile!.id;
  const admin = createSupabaseAdminClient();
  const schoolTz = config.school.timezone;
  const schoolLabel = config.school.timezoneLabel;
  const subjects = (await getSettings()).assessmentSubjectsItems;

  // Only the slots assigned to this teacher by an admin.
  const { data } = await admin
    .from("assessment_slots")
    .select(
      "id, starts_at, ends_at, is_open, application_id, applications(id, status, grade_applying, students(full_name, dob), parents(full_name, phone, email))",
    )
    .eq("teacher_id", teacherId)
    .order("starts_at", { ascending: true });
  const slots = (data ?? []) as unknown as SlotRow[];

  const now = Date.now();
  const toRecord = slots.filter(
    (s) => s.applications && s.applications.status === "ASSESSMENT_SCHEDULED",
  );
  const upcoming = slots.filter(
    (s) => s.is_open && !s.application_id && new Date(s.starts_at).getTime() > now,
  );
  const history = slots.filter(
    (s) => s.applications && s.applications.status !== "ASSESSMENT_SCHEDULED",
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">My assessments</h1>
        <p className="text-muted-foreground">
          Your assigned assessment slots. Record results once an applicant has been assessed.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {recorded && <Alert variant="success">Result recorded.</Alert>}

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
              <form
                key={s.id}
                action={submitResult}
                className="space-y-3 rounded-md border border-border p-4"
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
                  <Badge tone="info">Booked</Badge>
                </div>

                {/* Per-subject scores, comments and PDF/Excel attachments */}
                <div className="space-y-2">
                  <input type="hidden" name="subject_count" value={subjects.length} />
                  <div className="text-sm font-semibold">Subject scores</div>
                  {subjects.map((subj, i) => (
                    <div key={subj} className="space-y-2 rounded-md border border-border/60 p-3">
                      <input type="hidden" name={`subject_${i}`} value={subj} />
                      <div className="text-sm font-medium">{subj}</div>
                      <div className="grid items-start gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_15rem]">
                        <div className="space-y-1">
                          <Label htmlFor={`score-${s.id}-${i}`} className="text-xs">Score (/100)</Label>
                          <Input
                            id={`score-${s.id}-${i}`}
                            name={`score_${i}`}
                            type="number"
                            min={0}
                            max={100}
                            step="1"
                            placeholder="—"
                            className="h-9 w-full"
                          />
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
                            className="h-9 w-full"
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
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
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
                  <Badge tone="info">Open</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>History ({history.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No past assessments.</p>
            ) : (
              history.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>
                    {s.applications?.students?.full_name ?? "Applicant"} ·{" "}
                    {formatInZone(s.starts_at, schoolTz)} {schoolLabel}
                  </span>
                  <Badge tone="neutral">{s.applications?.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
