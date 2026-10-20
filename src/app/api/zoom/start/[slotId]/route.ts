import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getFreshZak } from "@/lib/zoom";

export const dynamic = "force-dynamic";

// A stored zoom_start_url's embedded host-auth token (ZAK) is only valid for
// ~2 hours from when the meeting was first created — almost always long
// expired by the time a teacher actually clicks "Start" at the real
// assessment time (slots are typically created days ahead). This mints a
// fresh ZAK right now and swaps it into the same URL Zoom originally gave
// us, so the link always works regardless of how long ago the slot was
// created. See getFreshZak in src/lib/zoom.ts for the full explanation.
export async function GET(request: Request, { params }: { params: Promise<{ slotId: string }> }) {
  const { slotId } = await params;

  const session = await getSessionUser();
  if (!session?.profile) {
    // A teacher most often reaches this link straight from a WhatsApp/SMS
    // notification, possibly on a browser/device they aren't currently
    // signed into this app on — bouncing them to a dead end here would mean
    // the whole fix still fails in the one place it matters most. Sends
    // them to log in first, then straight back to this exact URL.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", `/api/zoom/start/${slotId}`);
    return NextResponse.redirect(loginUrl);
  }
  const { profile } = session;
  if (!["teacher", "admin", "coo"].includes(profile.role)) {
    return new NextResponse("Not available for your role.", { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const { data: slot } = await admin
    .from("assessment_slots")
    .select("teacher_id, zoom_start_url")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot || !slot.zoom_start_url) {
    return new NextResponse("No Zoom meeting found for this slot.", { status: 404 });
  }
  if (profile.role === "teacher" && slot.teacher_id !== profile.id) {
    return new NextResponse("This assessment isn't assigned to you.", { status: 403 });
  }

  const { data: teacher } = slot.teacher_id
    ? await admin.from("users").select("email, zoom_email").eq("id", slot.teacher_id).maybeSingle()
    : { data: null };
  const hostEmail = teacher?.zoom_email || teacher?.email;
  if (!hostEmail) {
    return new NextResponse("Could not determine the Zoom host for this slot.", { status: 500 });
  }

  const zak = await getFreshZak(hostEmail);
  if (!zak) {
    // Falling back to the stale stored link would just reproduce the exact
    // "hosted by another user" error this route exists to avoid — a clear
    // message is more useful than silently handing back a known-broken URL.
    return new NextResponse(
      "Could not generate a fresh Zoom host link right now — please try again, or contact admin if this keeps happening.",
      { status: 502 },
    );
  }

  const url = new URL(slot.zoom_start_url);
  url.searchParams.set("zak", zak);
  return NextResponse.redirect(url.toString());
}
