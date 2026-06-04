import { NextResponse } from "next/server";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { markPaymentCompleted } from "@/lib/payments";

// Checkout handler verification (belt-and-suspenders alongside the webhook).
// Confirms the Razorpay signature server-side before crediting the payment.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    orderId?: string;
    paymentId?: string;
    signature?: string;
  };
  if (!body.orderId || !body.paymentId || !body.signature) {
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
  }

  const valid = verifyPaymentSignature({
    orderId: body.orderId,
    paymentId: body.paymentId,
    signature: body.signature,
  });
  if (!valid) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  await markPaymentCompleted({
    orderId: body.orderId,
    paymentId: body.paymentId,
    signature: body.signature,
  });
  return NextResponse.json({ ok: true });
}
