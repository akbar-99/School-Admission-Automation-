"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionUser, ROLE_HOME } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=" + encodeURIComponent("Email and password are required."));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Never log the password — email + outcome only.
    await logAudit({
      action: "auth.login_failed",
      entity: "auth",
      details: { email, outcome: error.message },
    });
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  const session = await getSessionUser();
  if (!session?.profile) {
    await logAudit({
      actorId: session?.authId ?? null,
      action: "auth.login_failed",
      entity: "auth",
      details: { email, outcome: "no staff profile linked" },
    });
    redirect("/login?error=" + encodeURIComponent("No staff profile is linked to this account."));
  }

  await logAudit({
    actorId: session.profile.id,
    actorRole: session.profile.role,
    action: "auth.login_success",
    entity: "auth",
    details: { email },
  });
  redirect(ROLE_HOME[session.profile.role] ?? "/");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
