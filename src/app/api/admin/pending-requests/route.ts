import { getSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { needsAssessment } from "@/lib/assessment";

export const dynamic = "force-dynamic";

// Count of applicants awaiting an assessment slot (the "Assessment
// requests" list). Polled by the admin dashboard to alert on new requests.
export async function GET() {
  const session = await getSessionUser();
  if (session?.profile?.role !== "admin") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("applications")
    .select("grade_applying")
    .eq("status", "FORM_SUBMITTED");
  const count = (data ?? []).filter((r) => needsAssessment(r.grade_applying ?? "")).length;
  return Response.json({ count });
}
