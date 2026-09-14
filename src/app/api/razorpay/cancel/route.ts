import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";

// Razorpay's hosted checkout posts here if the parent backs out before
// paying. Nothing to record — no payment attempt exists yet at this point
// (the order row was already created, but it just stays in "created" status
// until a real completed/failed webhook or callback updates it).
function redirectToPortal(request: NextRequest): NextResponse {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  // See callback/route.ts: use the app's trusted canonical origin, not the
  // proxy-seen request Host, which can be the container's internal address
  // behind a self-hosted reverse proxy.
  const target = new URL(token ? `/apply/${token}` : "/", config.appUrl);
  if (token) target.searchParams.set("error", "Payment cancelled.");
  return NextResponse.redirect(target, 303);
}

export async function POST(request: NextRequest) {
  return redirectToPortal(request);
}

export async function GET(request: NextRequest) {
  return redirectToPortal(request);
}
