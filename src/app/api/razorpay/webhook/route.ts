import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { markPaymentCompleted, markPaymentFailed } from "@/lib/payments";

// Razorpay webhook — the authoritative source of payment status (SRS FR-20).
// Payment is credited ONLY here (and in /verify), never from the browser.
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: { payment?: { entity?: { order_id?: string; id?: string; error_description?: string } } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const entity = event.payload?.payment?.entity;
  const orderId = entity?.order_id;

  if (event.event === "payment.captured" && orderId) {
    await markPaymentCompleted({ orderId, paymentId: entity?.id, signature });
  } else if (event.event === "payment.failed" && orderId) {
    await markPaymentFailed(orderId, entity?.error_description);
  }

  return NextResponse.json({ ok: true });
}
