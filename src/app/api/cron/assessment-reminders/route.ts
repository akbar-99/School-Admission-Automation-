import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyAssessmentReminder } from "@/lib/workflow";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const REMINDER_LEAD_MINUTES = 10;

interface DueSlot {
  id: string;
  application_id: string;
  teacher_id: string | null;
  starts_at: string;
  zoom_join_url: string | null;
  zoom_passcode: string | null;
  zoom_start_url: string | null;
}

// Polled by an external scheduler (this project has no cron infra of its
// own) every few minutes. Finds booked slots starting within the next 10
// minutes that haven't been reminded yet, claims them atomically in one
// UPDATE...RETURNING (so an overlapping invocation can never double-send —
// each row can only be claimed by whichever call's WHERE reminder_sent=false
// actually matches it first), and sends the reminder for each one claimed.
// Trigger with: GET /api/cron/assessment-reminders?secret=<CRON_SECRET>
export async function GET(request: Request) {
  const secret =
    request.headers.get("x-cron-secret") ?? new URL(request.url).searchParams.get("secret");
  if (!config.cronSecret || secret !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const cutoff = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);

  const { data: claimed, error } = await admin
    .from("assessment_slots")
    .update({ reminder_sent: true })
    .not("application_id", "is", null)
    .eq("reminder_sent", false)
    .gt("starts_at", now.toISOString())
    .lte("starts_at", cutoff.toISOString())
    .select("id, application_id, teacher_id, starts_at, zoom_join_url, zoom_passcode, zoom_start_url");

  if (error) {
    console.error("[cron/assessment-reminders] claim query failed", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  let sent = 0;
  for (const slot of (claimed ?? []) as DueSlot[]) {
    try {
      await notifyAssessmentReminder(slot);
      sent += 1;
    } catch (err) {
      // The slot is already marked reminder_sent — a delivery failure here
      // means a missed reminder for this one slot, not a retry loop. Logged
      // for visibility; not surfaced as a 500 so the rest of the batch and
      // future polls aren't affected.
      console.error("[cron/assessment-reminders] failed to notify for slot", slot.id, err);
    }
  }

  return NextResponse.json({ ok: true, checked: claimed?.length ?? 0, reminded: sent });
}
