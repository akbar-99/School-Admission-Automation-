import { NextRequest, NextResponse } from "next/server";

// Razorpay's hosted checkout posts here if the parent backs out before
// paying. Nothing to record — no payment attempt exists yet at this point
// (the order row was already created, but it just stays in "created" status
// until a real completed/failed webhook or callback updates it).
function redirectToPortal(request: NextRequest): NextResponse {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const target = new URL(token ? `/apply/${token}` : "/", url.origin);
  if (token) target.searchParams.set("error", "Payment cancelled.");
  return NextResponse.redirect(target, 303);
}

export async function POST(request: NextRequest) {
  return redirectToPortal(request);
}

export async function GET(request: NextRequest) {
  return redirectToPortal(request);
}
