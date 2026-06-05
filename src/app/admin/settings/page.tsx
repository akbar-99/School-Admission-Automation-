import { factoryReset } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { ok, error } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Administrative tools.</p>
      </div>

      {ok && <Alert variant="success">{ok}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

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
