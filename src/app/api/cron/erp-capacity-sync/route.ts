import { NextResponse } from "next/server";
import { syncErpCapacity } from "@/lib/erp";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Polled by the same external scheduler as /api/cron/assessment-reminders,
// at a much slower interval (this only needs to catch drift from ERP-side
// changes — capacity edits, manual enrollments made directly in the ERP —
// not every admission, which claims its seat live via claim_erp_seat).
// Reuses the same CRON_SECRET as the reminder route; both are equally-
// trusted "an external pinger hits this" endpoints.
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
  return NextResponse.json({ ok: true, classes: count });
}
