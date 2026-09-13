import { NextResponse } from "next/server";
import { loadApplicationByToken } from "@/lib/parent";
import { ensureStudyMaterialOnlyOrder } from "@/lib/payments";
import { config } from "@/lib/config";
import type { Application } from "@/lib/types";

// Standalone study-material payment, made after enrollment by a parent who
// declined it at the main payment step. Separate route (rather than a flag
// on the main order route) since its preconditions differ — ENROLLED and
// not yet paid, instead of the pre-payment AGREEMENT_SENT/PENDING states.
export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

  try {
    const { orderId, amount } = await ensureStudyMaterialOnlyOrder(bundle.application as Application);
    return NextResponse.json({
      orderId,
      amount,
      currency: "INR",
      keyId: config.razorpay.publicKeyId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Order failed" },
      { status: 400 },
    );
  }
}
