import Link from "next/link";
import { confirmToken } from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/submit-button";
import { LogoFull } from "@/components/logo";

// Deliberately a page requiring a real click (not the old route.ts, which
// verified the one-time token straight off a bare GET) — see actions.ts for
// why: an automated link scanner following the email link would otherwise
// silently burn the token before the recipient ever saw it.
const COPY: Record<string, { title: string; description: string; button: string }> = {
  invite: {
    title: "Activate your account",
    description: "You've been invited to the Broadway Admissions portal.",
    button: "Continue",
  },
  recovery: {
    title: "Reset your password",
    description: "Continue to set a new password for your account.",
    button: "Continue",
  },
};
const DEFAULT_COPY = { title: "Confirm", description: "Continue to proceed.", button: "Continue" };

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash: tokenHash, type, next } = await searchParams;
  const copy = (type && COPY[type]) || DEFAULT_COPY;

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 flex justify-center">
          <LogoFull height={84} priority />
        </Link>
        <Card className="shadow-luxe">
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {!tokenHash || !type ? (
              <Alert variant="error">
                This link is invalid. Please check the link or ask an admin to resend it.
              </Alert>
            ) : (
              <form action={confirmToken}>
                <input type="hidden" name="token_hash" value={tokenHash} />
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="next" value={next ?? ""} />
                <SubmitButton className="w-full" pendingText="Confirming…">
                  {copy.button}
                </SubmitButton>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
