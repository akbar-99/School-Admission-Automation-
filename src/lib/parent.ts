import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import type { Application, Parent, Student } from "@/lib/types";

export interface ApplicationBundle {
  application: Application;
  parent: Parent;
  student: Student | null;
}

export function applyUrl(token: string): string {
  return `${config.appUrl}/apply/${token}`;
}

// Load an application from its secure admission-link token (SRS FR-2). Returns
// a reason when the link is invalid or expired so the UI can explain.
export async function loadApplicationByToken(
  token: string,
): Promise<{ bundle: ApplicationBundle | null; reason?: "not_found" | "expired" }> {
  const admin = createSupabaseAdminClient();
  const { data: application } = await admin
    .from("applications")
    .select("*")
    .eq("access_token", token)
    .maybeSingle();

  if (!application) return { bundle: null, reason: "not_found" };

  const app = application as Application;
  if (new Date(app.token_expires_at).getTime() < Date.now()) {
    return { bundle: null, reason: "expired" };
  }

  const [{ data: parent }, studentRes] = await Promise.all([
    admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle(),
    app.student_id
      ? admin.from("students").select("*").eq("id", app.student_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    bundle: {
      application: app,
      parent: parent as Parent,
      student: (studentRes.data as Student | null) ?? null,
    },
  };
}
