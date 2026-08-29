import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRazorpayOrder } from "@/lib/razorpay";
import { handlePaymentCompleted } from "@/lib/workflow";
import { getSettings } from "@/lib/settings";
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
    const { feePaise } = await getSettings();
    const receipt = `adm_${app.id.slice(0, 8)}_${Date.now()}`;
    const order = await createRazorpayOrder({
      amount: feePaise,
      receipt,
      notes: { application_id: app.id },
    });
    const { data: inserted } = await admin
      .from("payments")
      .insert({
        application_id: app.id,
        razorpay_order_id: order.id,
        amount: feePaise,
        currency: "INR",
        status: "created",
        receipt,
      })
      .select("*")
      .single();
    payment = inserted as Payment;
  }

  // Move into PAYMENT_PENDING for a fresh attempt. Valid from AGREEMENT_SENT
  // (first attempt) and from PAYMENT_FAILED / ABANDONED (retries, SRS FR-20a).
  // Without this, the later webhook's `.eq("status","PAYMENT_PENDING")` update
  // would no-op and enrollment would fail after a paid retry.
  if (app.status !== "PAYMENT_PENDING") {
    const { error: statusErr } = await admin
      .from("applications")
      .update({ status: "PAYMENT_PENDING" })
      .eq("id", app.id)
      .eq("status", app.status);
    if (statusErr) {
      throw new Error(`Could not move application to PAYMENT_PENDING: ${statusErr.message}`);
    }
  }

  return { payment, orderId: payment.razorpay_order_id!, amount: payment.amount };
}

export type MarkPaymentResult =
  | { ok: true; applicationId: string }
  // "not_found": no matching payment row — retrying won't change that, so
  // callers should treat this as accepted, not retried.
  // "db_error": the state-transition write itself failed — callers on the
  // Razorpay webhook path should return non-2xx so Razorpay retries.
  | { ok: false; applicationId?: string; reason: "not_found" | "db_error" };

// Mark a payment completed (only ever called after server-side verification or
// a signature-verified webhook — SRS FR-20) and trigger enrollment.
export async function markPaymentCompleted(params: {
  orderId: string;
  paymentId?: string | null;
  signature?: string | null;
}): Promise<MarkPaymentResult> {
  const admin = createSupabaseAdminClient();
  const { data: payRow } = await admin
    .from("payments")
    .select("*")
    .eq("razorpay_order_id", params.orderId)
    .maybeSingle();
  const payment = payRow as Payment | null;
  if (!payment) return { ok: false, reason: "not_found" };

  // Idempotent: if already completed, just ensure enrollment ran.
  if (payment.status !== "completed") {
    const { error: payErr } = await admin
      .from("payments")
      .update({
        status: "completed",
        razorpay_payment_id: params.paymentId ?? payment.razorpay_payment_id,
        razorpay_signature: params.signature ?? payment.razorpay_signature,
      })
      .eq("id", payment.id);
    if (payErr) {
      await logAudit({
        action: "payment.completed_db_error",
        entity: "payment",
        entityId: payment.id,
        details: { order_id: params.orderId, payment_id: params.paymentId, error: payErr.message },
      });
      return { ok: false, applicationId: payment.application_id, reason: "db_error" };
    }

    const { error: appErr } = await admin
      .from("applications")
      .update({ status: "PAYMENT_COMPLETED" })
      .eq("id", payment.application_id)
      .eq("status", "PAYMENT_PENDING");
    if (appErr) {
      await logAudit({
        action: "payment.completed_db_error",
        entity: "application",
        entityId: payment.application_id,
        details: { order_id: params.orderId, payment_id: params.paymentId, error: appErr.message },
      });
      return { ok: false, applicationId: payment.application_id, reason: "db_error" };
    }
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

export async function markPaymentFailed(
  orderId: string,
  reason?: string,
): Promise<MarkPaymentResult> {
  const admin = createSupabaseAdminClient();
  const { data: payRow } = await admin
    .from("payments")
    .select("*")
    .eq("razorpay_order_id", orderId)
    .maybeSingle();
  const payment = payRow as Payment | null;
  if (!payment) return { ok: false, reason: "not_found" };

  const { error: payErr } = await admin
    .from("payments")
    .update({ status: "failed" })
    .eq("id", payment.id);
  if (payErr) {
    await logAudit({
      action: "payment.failed_db_error",
      entity: "payment",
      entityId: payment.id,
      details: { order_id: orderId, error: payErr.message },
    });
    return { ok: false, applicationId: payment.application_id, reason: "db_error" };
  }

  const { error: appErr } = await admin
    .from("applications")
    .update({ status: "PAYMENT_FAILED" })
    .eq("id", payment.application_id)
    .eq("status", "PAYMENT_PENDING");
  if (appErr) {
    await logAudit({
      action: "payment.failed_db_error",
      entity: "application",
      entityId: payment.application_id,
      details: { order_id: orderId, error: appErr.message },
    });
    return { ok: false, applicationId: payment.application_id, reason: "db_error" };
  }

  await logAudit({
    action: "payment.failed",
    entity: "payment",
    entityId: payment.id,
    details: { reason },
  });
  return { ok: true, applicationId: payment.application_id };
}
