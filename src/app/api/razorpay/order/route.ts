import { NextResponse } from "next/server";
import { loadApplicationByToken } from "@/lib/parent";
import { ensureOrderForApplication } from "@/lib/payments";
import { config } from "@/lib/config";
import type { Application } from "@/lib/types";

// Server-side Razorpay order creation (SRS FR-17). The browser never creates
// or confirms payment.
export async function POST(request: Request) {
  const { token } = (await request.json().catch(() => ({}))) as { token?: string };
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) return NextResponse.json({ error: "Invalid or expired link" }, { status: 404 });

  try {
    const { orderId, amount } = await ensureOrderForApplication(bundle.application as Application);
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
