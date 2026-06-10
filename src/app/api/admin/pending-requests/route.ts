import { getSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Count of Grade applicants awaiting an assessment slot (the "Assessment
// requests" list). Polled by the admin dashboard to alert on new requests.
export async function GET() {
  const session = await getSessionUser();
  if (session?.profile?.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  const { count } = await admin
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("category", "GRADE")
    .eq("status", "FORM_SUBMITTED");
  return Response.json({ count: count ?? 0 });
}
