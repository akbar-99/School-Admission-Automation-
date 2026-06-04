import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRazorpayOrder } from "@/lib/razorpay";
import { handlePaymentCompleted } from "@/lib/workflow";
import { config } from "@/lib/config";
import { logAudit } from "@/lib/audit";
import type { Application, Payment } from "@/lib/types";

const PAYABLE = new Set([
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
]);

// Create (or reuse) a Razorpay order for an application and move it to
// PAYMENT_PENDING. (SRS FR-17 — server-side order creation.)
export async function ensureOrderForApplication(
  app: Application,
): Promise<{ payment: Payment; orderId: string; amount: number }> {
  if (!PAYABLE.has(app.status)) {
    throw new Error(`Application not payable in status ${app.status}`);
  }
  const admin = createSupabaseAdminClient();

  // Reuse an open order if one exists.
  const { data: existing } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", app.id)
    .in("status", ["created", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let payment = existing as Payment | null;

  if (!payment || !payment.razorpay_order_id) {
    const receipt = `adm_${app.id.slice(0, 8)}_${Date.now()}`;
    const order = await createRazorpayOrder({
      amount: config.admission.feePaise,
      receipt,
      notes: { application_id: app.id },
    });
    const { data: inserted } = await admin
      .from("payments")
      .insert({
        application_id: app.id,
        razorpay_order_id: order.id,
        amount: config.admission.feePaise,
        currency: "INR",
        status: "created",
        receipt,
      })
      .select("*")
      .single();
    payment = inserted as Payment;
  }

  // AGREEMENT_SENT -> PAYMENT_PENDING (valid transition)
  if (app.status === "AGREEMENT_SENT") {
    await admin
      .from("applications")
      .update({ status: "PAYMENT_PENDING" })
      .eq("id", app.id)
      .eq("status", "AGREEMENT_SENT");
  }

  return { payment, orderId: payment.razorpay_order_id!, amount: payment.amount };
}

// Mark a payment completed (only ever called after server-side verification or
// a signature-verified webhook — SRS FR-20) and trigger enrollment.
export async function markPaymentCompleted(params: {
  orderId: string;
  paymentId?: string | null;
  signature?: string | null;
}): Promise<{ ok: boolean; applicationId?: string }> {
  const admin = createSupabaseAdminClient();
  const { data: payRow } = await admin
    .from("payments")
    .select("*")
    .eq("razorpay_order_id", params.orderId)
    .maybeSingle();
  const payment = payRow as Payment | null;
  if (!payment) return { ok: false };

  // Idempotent: if already completed, just ensure enrollment ran.
  if (payment.status !== "completed") {
    await admin
      .from("payments")
      .update({
        status: "completed",
        razorpay_payment_id: params.paymentId ?? payment.razorpay_payment_id,
        razorpay_signature: params.signature ?? payment.razorpay_signature,
      })
      .eq("id", payment.id);

    await admin
      .from("applications")
      .update({ status: "PAYMENT_COMPLETED" })
      .eq("id", payment.application_id)
      .eq("status", "PAYMENT_PENDING");
  }

  await logAudit({
    action: "payment.completed",
    entity: "payment",
    entityId: payment.id,
    details: { order_id: params.orderId, payment_id: params.paymentId },
  });

  await handlePaymentCompleted(payment.application_id);
  return { ok: true, applicationId: payment.application_id };
}

export async function markPaymentFailed(orderId: string, reason?: string) {
  const admin = createSupabaseAdminClient();
  const { data: payRow } = await admin
    .from("payments")
    .select("*")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();
  const payment = payRow as Payment | null;
  if (!payment) return;
  await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
  await admin
    .from("applications")
    .update({ status: "PAYMENT_FAILED" })
    .eq("id", payment.application_id)
    .eq("status", "PAYMENT_PENDING");
  await logAudit({
    action: "payment.failed",
    entity: "payment",
    entityId: payment.id,
    details: { reason },
  });
}
