"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser, ROLE_HOME } from "@/lib/auth";

// Sets the password for the currently-authenticated invite session, then sends
// the user to their role's home. Requires the session established by
// /auth/confirm (verifyOtp).
export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect("/auth/set-password?error=" + encodeURIComponent("Password must be at least 8 characters."));
  }
  if (password !== confirm) {
    redirect("/auth/set-password?error=" + encodeURIComponent("Passwords do not match."));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?error=" + encodeURIComponent("Your invite session has expired. Ask an admin to resend the invite."));
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/auth/set-password?error=" + encodeURIComponent(error.message));
  }

  const session = await getSessionUser();
  redirect(session?.profile ? (ROLE_HOME[session.profile.role] ?? "/") : "/login");
}
