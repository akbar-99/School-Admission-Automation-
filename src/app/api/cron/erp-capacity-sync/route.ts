import { NextResponse } from "next/server";
import { syncBroadwayClasses, syncBroadwayStudents } from "@/lib/broadway";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Route path kept as-is (erp-capacity-sync) even though this now syncs from
// Broadway, not the old ERP — it's polled by an external scheduler
// configured with this exact URL, and renaming it would silently break that
// scheduling outside this codebase. Polled at a much slower interval than
// /api/cron/assessment-reminders (this only needs to catch drift from
// Broadway-side changes — seat edits, students added directly in Broadway —
// not every admission, which is pushed live at enrollment). Reuses the same
// CRON_SECRET as the reminder route; both are equally-trusted "an external
// pinger hits this" endpoints.
//
// Also refreshes the broadway_students search cache (piggybacking on this
// same external cron rather than needing a second scheduled job) —
// otherwise a student added in the app or directly in Broadway would only
// show up in Admin → Broadway search after someone manually clicks "Sync
// now". A student sync failure doesn't fail the whole request; class
// capacity is the more important half and already succeeded by that point.
// Trigger with: GET /api/cron/erp-capacity-sync?secret=<CRON_SECRET>
export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret");
  if (!config.cronSecret || secret !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await syncBroadwayClasses();
  if (count === null) {
    return NextResponse.json({ error: "Broadway class fetch failed" }, { status: 502 });
  }

  const studentCount = await syncBroadwayStudents();

  return NextResponse.json({ ok: true, classes: count, students: studentCount });
}
