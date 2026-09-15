import { factoryReset, updateSettings, updateStudyMaterialFees, updateAdmissionSequence } from "../actions";
import { getSettings, getStudyMaterialFees, getNextAdmissionNumber } from "@/lib/settings";
import { getClassOptions } from "@/lib/classes";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;
  const [s, grades, studyMaterialFees, nextAdmissionNumber] = await Promise.all([
    getSettings(),
    getClassOptions(),
    getStudyMaterialFees(),
    getNextAdmissionNumber(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Edit fees, agreement wording, and school details.</p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>General settings</CardTitle>
          <CardDescription>Saved changes apply immediately — no redeploy needed.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateSettings} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fee_rupees">Admission fee (₹)</Label>
                <Input
                  id="fee_rupees"
                  name="fee_rupees"
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={s.feePaise / 100}
                  required
                />
                <p className="text-xs text-muted-foreground">Applies to new payment orders.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="school_name">School name</Label>
                <Input id="school_name" name="school_name" defaultValue={s.schoolName} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="academic_term_start">Term 1 start</Label>
                <Input
                  id="academic_term_start"
                  name="academic_term_start"
                  defaultValue={s.academicTermStart}
                  placeholder="e.g. 2026-06-15"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="academic_orientation">Orientation day</Label>
                <Input
                  id="academic_orientation"
                  name="academic_orientation"
                  defaultValue={s.academicOrientation}
                  placeholder="e.g. 2026-06-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="school_phone">School phone</Label>
                <Input
                  id="school_phone"
                  name="school_phone"
                  type="tel"
                  defaultValue={s.schoolPhone}
                  placeholder="+91 90000 00000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="school_email">School email</Label>
                <Input
                  id="school_email"
                  name="school_email"
                  type="email"
                  defaultValue={s.schoolEmail}
                  placeholder="admissions@school.example"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="assessment_subjects">Assessment subjects</Label>
                <Textarea
                  id="assessment_subjects"
                  name="assessment_subjects"
                  defaultValue={s.assessmentSubjects}
                  className="min-h-24"
                />
                <p className="text-xs text-muted-foreground">
                  One subject per line. These are scored (score + comment + file) by the teacher
                  during a Grade assessment.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assessment_reminder_2h_minutes">
                  Assessment confirmation reminder — lead time (minutes)
                </Label>
                <Input
                  id="assessment_reminder_2h_minutes"
                  name="assessment_reminder_2h_minutes"
                  type="number"
                  min={15}
                  max={1440}
                  step={1}
                  defaultValue={s.assessmentReminder2hMinutes}
                />
                <p className="text-xs text-muted-foreground">
                  How long before an assessment the parent gets the &quot;please confirm / need to
                  reschedule&quot; message. Depends on an external scheduler polling
                  /api/cron/assessment-reminders every few minutes — this only sets how far ahead
                  it fires, not how precisely.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="study_material">Onboarding — study material list</Label>
                <Textarea
                  id="study_material"
                  name="study_material"
                  defaultValue={s.studyMaterial}
                  className="min-h-24"
                />
                <p className="text-xs text-muted-foreground">
                  One item per line. Shown in the onboarding pack after enrollment.
                </p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="agreement_terms">Agreement terms</Label>
                <Textarea
                  id="agreement_terms"
                  name="agreement_terms"
                  defaultValue={s.agreementTerms}
                  className="min-h-28"
                />
                <p className="text-xs text-muted-foreground">
                  Shown on the admission agreement. Student/parent details and the fee line stay automatic.
                </p>
              </div>
            </div>
            <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Study material fee by grade</CardTitle>
          <CardDescription>
            Shown to parents as a second, optional payment card alongside the admission fee — set
            to 0 to hide it for a grade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateStudyMaterialFees} className="grid gap-4 sm:grid-cols-3">
            {grades.map((grade) => (
              <div key={grade} className="space-y-1.5">
                <Label htmlFor={`fee-${grade}`}>{grade}</Label>
                <Input
                  id={`fee-${grade}`}
                  name={`fee_grade__${grade}`}
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={(studyMaterialFees[grade] ?? 0) / 100}
                />
              </div>
            ))}
            <div className="flex items-end sm:col-span-3">
              <SubmitButton pendingText="Saving…">Save study material fees</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Admission number sequence</CardTitle>
          <CardDescription>
            Broadway&apos;s own school-wide admission numbers — a single running sequence, not
            tied to class, grade, or year. Only change this to continue from your existing
            records; it can&apos;t be set at or below a number already issued.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAdmissionSequence} className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="next_admission_number">Next admission number to be issued</Label>
              <Input
                id="next_admission_number"
                name="next_admission_number"
                type="number"
                min={1}
                step="1"
                defaultValue={nextAdmissionNumber}
                className="w-40"
                required
              />
            </div>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone — Factory reset</CardTitle>
          <CardDescription>
            Permanently deletes <strong>all</strong> leads, applications, students, parents, payments,
            assessments, and notifications, and resets all seat counts and admission numbers. Staff
            logins, class sections, and configuration are kept. <strong>This cannot be undone.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={factoryReset} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="confirm">
                Type <strong>RESET</strong> to confirm
              </Label>
              <Input
                id="confirm"
                name="confirm"
                placeholder="RESET"
                autoComplete="off"
                className="w-40"
              />
            </div>
            <SubmitButton variant="destructive" pendingText="Resetting…">
              Factory reset
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
