import { type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Handles email-link tokens (invite, recovery, etc.) server-side via verifyOtp,
// which — unlike the PKCE code flow — works for links opened in a browser that
// never started the auth flow (e.g. an admin-sent invite). On success it
// establishes the session cookie and forwards to `next` (the set-password page).
// Uses next/navigation redirect() so the cookies set by verifyOtp are flushed.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") || "/auth/set-password";

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
  }

  redirect(
    "/login?error=" +
      encodeURIComponent("This link is invalid or has expired. Ask an admin to resend it."),
  );
}
