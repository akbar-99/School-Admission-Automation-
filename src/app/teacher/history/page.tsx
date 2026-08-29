import { getSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { formatDate, formatInZone } from "@/lib/utils";
import { AssessmentOutcomeChart } from "@/components/teacher/assessment-outcome-chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SubjectResult } from "@/lib/types";

interface ResultRow {
  id: string;
  outcome: "PASS" | "FAIL";
  remarks: string | null;
  subjects: SubjectResult[] | null;
  created_at: string;
  assessment_slots: { starts_at: string } | null;
  applications: {
    grade_applying: string | null;
    students: { full_name: string; dob: string | null } | null;
    parents: { full_name: string; phone: string; email: string | null } | null;
  } | null;
}

export default async function TeacherHistoryPage() {
  const session = await getSessionUser();
  const teacherId = session!.profile!.id;
  const admin = createSupabaseAdminClient();
  const schoolTz = config.school.timezone;
  const schoolLabel = config.school.timezoneLabel;

  // The authoritative record of every assessment this teacher has conducted
  // — not inferred from the applicant's current downstream status, which can
  // move for reasons unrelated to the assessment result.
  const { data } = await admin
    .from("assessment_results")
    .select(
      "id, outcome, remarks, subjects, created_at, assessment_slots(starts_at), applications(grade_applying, students(full_name, dob), parents(full_name, phone, email))",
    )
    .eq("teacher_id", teacherId)
    .order("created_at", { ascending: false });
  const results = (data ?? []) as unknown as ResultRow[];

  const passCount = results.filter((r) => r.outcome === "PASS").length;
  const failCount = results.filter((r) => r.outcome === "FAIL").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Assessment history</h1>
        <p className="text-muted-foreground">
          Every assessment you&apos;ve conducted, with the full student record and your pass/fail rate.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your pass/fail record</CardTitle>
        </CardHeader>
        <CardContent>
          <AssessmentOutcomeChart pass={passCount} fail={failCount} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conducted assessments ({results.length})</CardTitle>
          <CardDescription>Most recent first.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past assessments.</p>
          ) : (
            results.map((r) => (
              <div key={r.id} className="space-y-3 rounded-md border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold">
                      {r.applications?.students?.full_name ?? "Applicant"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>Grade {r.applications?.grade_applying ?? "—"}</span>
                      {r.applications?.students?.dob && (
                        <span>DOB {formatDate(r.applications.students.dob)}</span>
                      )}
                      {r.assessment_slots?.starts_at && (
                        <span>
                          Assessed {formatInZone(r.assessment_slots.starts_at, schoolTz)} {schoolLabel}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        Parent:{" "}
                        <span className="font-medium text-foreground">
                          {r.applications?.parents?.full_name ?? "—"}
                        </span>
                      </span>
                      {r.applications?.parents?.phone && (
                        <a
                          href={`tel:${r.applications.parents.phone}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.applications.parents.phone}
                        </a>
                      )}
                      {r.applications?.parents?.email && (
                        <a
                          href={`mailto:${r.applications.parents.email}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.applications.parents.email}
                        </a>
                      )}
                    </div>
                  </div>
                  <Badge tone={r.outcome === "PASS" ? "success" : "danger"}>{r.outcome}</Badge>
                </div>

                {r.subjects && r.subjects.length > 0 && (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border/60 pt-3 text-sm">
                    {r.subjects.map((sub) => (
                      <span key={sub.subject}>
                        <span className="text-muted-foreground">{sub.subject}:</span>{" "}
                        <span className="font-medium tabular-nums">
                          {sub.score != null ? `${sub.score}/${sub.maxScore ?? 100}` : "—"}
                        </span>
                      </span>
                    ))}
                  </div>
                )}

                {r.remarks && (
                  <p className="border-t border-border/60 pt-3 text-sm text-muted-foreground">
                    {r.remarks}
                  </p>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
