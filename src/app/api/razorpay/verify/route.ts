import { NextResponse } from "next/server";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { markPaymentCompleted } from "@/lib/payments";

// Standard Checkout's client-side `handler` callback posts here with the
// three fields the overlay returns on success. The webhook
// (src/app/api/razorpay/webhook/route.ts) remains the authoritative,
// independent-of-the-browser confirmation — this route exists so the parent
// sees the result immediately instead of waiting for the webhook to land.
export async function POST(request: Request) {
  const { orderId, paymentId, signature } = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    paymentId?: string;
    signature?: string;
  };
  if (!orderId || !paymentId || !signature) {
    return NextResponse.json({ error: "Missing payment details" }, { status: 400 });
  }

  const valid = verifyPaymentSignature({ orderId, paymentId, signature });
  if (!valid) {
    // Never mark a payment completed on an unverified signature — same
    // standard as the webhook path.
    return NextResponse.json(
      { error: "Payment verification failed. Please contact the school if you were charged." },
      { status: 400 },
    );
  }

  const result = await markPaymentCompleted({ orderId, paymentId, signature });
  if (!result.ok && result.reason === "db_error") {
    // The webhook will retry this same completion shortly — don't alarm the
    // parent over what's likely a transient error.
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: true });
}
