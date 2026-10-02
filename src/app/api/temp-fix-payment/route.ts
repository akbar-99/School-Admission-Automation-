import { NextResponse } from "next/server";
import { markPaymentCompleted } from "@/lib/payments";
import { config } from "@/lib/config";

// TEMPORARY — one-off repair for the application(s) caught stuck in
// PAYMENT_FAILED despite a genuinely completed Razorpay payment (the
// pre-0058 multi-attempt-per-order race). Delete this route once used.
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!config.cronSecret || secret !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: "Missing orderId" }, { status: 400 });
  }
  const result = await markPaymentCompleted({ orderId });
  return NextResponse.json(result);
}
