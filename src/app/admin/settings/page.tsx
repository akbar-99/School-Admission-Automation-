import { factoryReset, updateSettings } from "../actions";
import { getSettings } from "@/lib/settings";
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
  const s = await getSettings();

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
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="school_contact">School contact</Label>
                <Input
                  id="school_contact"
                  name="school_contact"
                  defaultValue={s.schoolContact}
                  placeholder="Admissions Office · email · phone"
                />
                <p className="text-xs text-muted-foreground">
                  Shown on the onboarding pack and the agreement.
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
