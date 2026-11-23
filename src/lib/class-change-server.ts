import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ApplicationClassChange } from "@/lib/types";

// Readers for application_class_changes (0085). Until that migration has run
// the table doesn't exist; every caller treats "can't read" as "no change in
// progress", so the rest of the admission flow keeps working unchanged.

// PGRST205 (PostgREST: table not in schema cache) / 42P01 (Postgres: no such
// table) — 0085 not applied yet, which is expected, not worth a log line.
function isMissingTable(error: { code?: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01";
}

export async function getOpenClassChange(applicationId: string): Promise<ApplicationClassChange | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("application_class_changes")
    .select("*")
    .eq("application_id", applicationId)
    .eq("status", "awaiting_assessment")
    .maybeSingle();
  if (error) {
    if (!isMissingTable(error)) console.error("[class-change] open change lookup failed", error.message);
    return null;
  }
  return (data as ApplicationClassChange | null) ?? null;
}

export async function listClassChanges(applicationId: string): Promise<ApplicationClassChange[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("application_class_changes")
    .select("*")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) {
    if (!isMissingTable(error)) console.error("[class-change] history lookup failed", error.message);
    return [];
  }
  return (data ?? []) as ApplicationClassChange[];
}

// Whether 0085 has been applied — the admin page only offers "Change class"
// once it has.
export async function classChangeAvailable(): Promise<boolean> {
  const { error } = await createSupabaseAdminClient()
    .from("application_class_changes")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  return !error;
}
