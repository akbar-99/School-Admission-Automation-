import "server-only";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser, UserRole } from "@/lib/types";

export interface SessionUser {
  authId: string;
  email: string | null;
  profile: AppUser | null;
}

// Resolve the signed-in staff user and their role profile. Returns null when
// there is no valid session.
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Read the role profile with the service-role client (avoids RLS edge cases);
  // the auth.uid() was already validated by getUser() above.
  const admin = createSupabaseAdminClient();
  const { data: profile, error } = await admin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // A failed service-role query (e.g. a wrong/missing SUPABASE_SERVICE_ROLE_KEY)
  // looks identical to "no profile" downstream — surface it in the logs.
  if (error) {
    console.error(
      "[auth] staff profile lookup failed — check SUPABASE_SERVICE_ROLE_KEY:",
      error.message,
    );
  }

  return {
    authId: user.id,
    email: user.email ?? null,
    profile: (profile as AppUser | null) ?? null,
  };
}

export const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  marketing: "/marketing",
  teacher: "/teacher",
  class_teacher: "/admin",
  parent: "/",
};

// Require an authenticated staff user with one of the given roles. Redirects to
// /login when unauthenticated and to the user's own home when role mismatches.
export async function requireRole(roles: UserRole[]): Promise<{
  user: SessionUser;
  profile: AppUser;
}> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.profile) redirect("/login?error=no-profile");
  if (!roles.includes(user.profile.role)) {
    redirect(ROLE_HOME[user.profile.role] ?? "/login");
  }
  return { user, profile: user.profile };
}
