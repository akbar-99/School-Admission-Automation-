import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setPassword } from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";
import { LogoFull } from "@/components/logo";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <LogoFull height={84} priority />
        </Link>
        <Card className="shadow-luxe">
          <CardHeader>
            <CardTitle>Set your password</CardTitle>
            <CardDescription>
              Choose a password to activate your staff account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!user ? (
              <Alert variant="error">
                This invite link is invalid or has expired. Please ask an admin to resend your
                invite.
              </Alert>
            ) : (
              <>
                {error && (
                  <Alert variant="error" className="mb-4">
                    {error}
                  </Alert>
                )}
                <form action={setPassword} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="password">New password</Label>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm">Confirm password</Label>
                    <Input
                      id="confirm"
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                    />
                  </div>
                  <SubmitButton className="w-full" pendingText="Saving…">
                    Set password &amp; sign in
                  </SubmitButton>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
