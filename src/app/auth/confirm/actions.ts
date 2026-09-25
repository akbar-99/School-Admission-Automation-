"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// The actual one-time verification — deliberately only reachable via a POST
// from a real button click (see page.tsx), never from the bare GET the
// email link itself points at. An automated link scanner (Gmail/Outlook
// security scanning, corporate anti-phishing tools, a chat app generating a
// link preview if the invite gets forwarded) only ever issues a GET, so it
// can no longer silently consume the one-time token before the real
// recipient clicks anything — that was producing "this link is invalid or
// expired" for a link nobody had actually used yet.
export async function confirmToken(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;
  const next = String(formData.get("next") ?? "/auth/set-password");

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirect(next);
    }
    console.error("[auth] verifyOtp failed", { type, message: error.message, status: error.status });
  } else {
    console.error("[auth] confirmToken missing token_hash or type", { tokenHash, type });
  }

  redirect(
    "/login?error=" +
      encodeURIComponent("This link is invalid or has expired. Ask an admin to resend it."),
  );
}
