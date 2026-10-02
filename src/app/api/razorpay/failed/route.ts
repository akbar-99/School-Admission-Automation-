import { NextResponse } from "next/server";
import { markPaymentFailed } from "@/lib/payments";

// Standard Checkout's client-side `payment.failed` event posts here so the
// order row reflects the failed attempt right away, rather than waiting on
// the webhook's independent payment.failed event.
export async function POST(request: Request) {
  const { orderId, reason } = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    reason?: string;
  };
  if (!orderId) {
    return NextResponse.json({ error: "Missing order id" }, { status: 400 });
  }
  await markPaymentFailed(orderId, reason);
  return NextResponse.json({ ok: true });
}
