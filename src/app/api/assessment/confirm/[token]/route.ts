import { NextResponse } from "next/server";
import { loadApplicationByToken, applyUrl } from "@/lib/parent";
import { confirmAssessmentSlot } from "@/lib/workflow";

// One-click "I'll attend" link sent in the 2-hour reminder email/WhatsApp
// message. A plain GET, same access model as every other token link in this
// app (the access_token itself is the bearer credential) — non-destructive
// and idempotent, so it's safe as a direct link click rather than needing a
// confirmation page.
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) return new Response("This link is invalid or expired.", { status: 404 });

  const { application: app } = bundle;
  if (app.status === "ASSESSMENT_SCHEDULED") {
    await confirmAssessmentSlot(app.id);
    return NextResponse.redirect(`${applyUrl(token)}?ok=${encodeURIComponent("Thanks for confirming — see you then!")}`);
  }

  return NextResponse.redirect(applyUrl(token));
}
