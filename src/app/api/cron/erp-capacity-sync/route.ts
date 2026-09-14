import { NextResponse } from "next/server";
import { syncErpCapacity, syncErpStudents } from "@/lib/erp";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Polled by the same external scheduler as /api/cron/assessment-reminders,
// at a much slower interval (this only needs to catch drift from ERP-side
// changes — capacity edits, manual enrollments made directly in the ERP —
// not every admission, which claims its seat live via claim_erp_seat).
// Reuses the same CRON_SECRET as the reminder route; both are equally-
// trusted "an external pinger hits this" endpoints.
//
// Also refreshes the erp_students search cache (piggybacking on this same
// external cron rather than needing a second scheduled job) — otherwise a
// student added in the app or directly in the ERP would only show up in
// Admin → ERP search after someone manually clicks "Sync now". A student
// sync failure doesn't fail the whole request; capacity is the more
// important half and already succeeded by that point.
// Trigger with: GET /api/cron/erp-capacity-sync?secret=<CRON_SECRET>
export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret");
  if (!config.cronSecret || secret !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await syncErpCapacity();
  if (count === null) {
    return NextResponse.json({ error: "ERP capacity fetch failed" }, { status: 502 });
  }

  const studentCount = await syncErpStudents();

  return NextResponse.json({ ok: true, classes: count, students: studentCount });
}
