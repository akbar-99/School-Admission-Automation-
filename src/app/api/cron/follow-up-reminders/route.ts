import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyFollowUpDue } from "@/lib/workflow";
import { config } from "@/lib/config";
import type { Application } from "@/lib/types";

export const dynamic = "force-dynamic";

// A follow-up date (not a time) only needs day-granularity, unlike
// assessment-reminders' every-few-minutes poll — this is meant to be
// triggered once a day by the same external scheduler, same reasoning as
// assessment-reminders (this project has no cron infra of its own).
// Trigger with: GET /api/cron/follow-up-reminders?secret=<CRON_SECRET>
export async function GET(request: Request) {
  const secret = request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret");
  if (!config.cronSecret || secret !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // "Today" in the school's own timezone, not the server's — a plain `date`
  // column has no timezone of its own, so comparing it against the wrong
  // "today" could fire a day early or late depending on where this happens
  // to be hosted.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: config.school.timezone }).format(new Date());

  const admin = createSupabaseAdminClient();
  // <=, not =, so a day the scheduler missed (downtime, a late deploy) still
  // catches up on the next poll instead of silently never reminding anyone.
  // Claimed via UPDATE...RETURNING, same atomic pattern as
  // assessment-reminders, so an overlapping poll can never double-send.
  const { data: claimed, error } = await admin
    .from("applications")
    .update({ next_follow_up_reminder_sent: true })
    .eq("next_follow_up_reminder_sent", false)
    .not("next_follow_up_at", "is", null)
    .not("created_by", "is", null)
    // "Mark done" leaves next_follow_up_at in place on purpose (the
    // counselor still wants to see what it was) — this is what keeps an
    // already-done follow-up from reminding anyone even though its date
    // has technically arrived.
    .is("next_follow_up_completed_at", null)
    .lte("next_follow_up_at", today)
    .select("*");

  if (error) {
    console.error("[cron/follow-up-reminders] claim query failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  let sent = 0;
  for (const app of (claimed ?? []) as Application[]) {
    try {
      await notifyFollowUpDue(app);
      sent += 1;
    } catch (err) {
      // Already claimed (next_follow_up_reminder_sent is true) — a delivery
      // failure here means a missed reminder for this one lead, not a retry
      // loop. Logged for visibility, not surfaced as a 500 so the rest of
      // the batch isn't affected.
      console.error("[cron/follow-up-reminders] failed to notify for application", app.id, err);
    }
  }

  return NextResponse.json({ ok: true, sent });
}
