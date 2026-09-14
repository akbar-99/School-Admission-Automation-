import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRazorpayOrder } from "@/lib/razorpay";
import { handlePaymentCompleted, handleStudyMaterialPaymentCompleted } from "@/lib/workflow";
import { getSettings, getStudyMaterialFeeForGrade } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import type { Application, Payment } from "@/lib/types";

const PAYABLE = new Set([
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
]);

// Create (or reuse) a Razorpay order for an application's main payment step
// and move it to PAYMENT_PENDING. (SRS FR-17 — server-side order creation.)
// Admission is always included; study material is the parent's choice and
// only added to the order (and its own snapshot column) if selected.
export async function ensureOrderForApplication(
  app: Application,
  opts?: { includeStudyMaterial?: boolean },
): Promise<{ payment: Payment; orderId: string; amount: number }> {
  if (!PAYABLE.has(app.status)) {
    throw new Error(`Application not payable in status ${app.status}`);
  }
  const includeStudyMaterial = opts?.includeStudyMaterial ?? false;
  const admin = createSupabaseAdminClient();

  const { feePaise } = await getSettings();
  const studyMaterialAmount = includeStudyMaterial
    ? await getStudyMaterialFeeForGrade(app.grade_applying)
    : 0;
  const admissionAmount = feePaise;
  const totalAmount = admissionAmount + studyMaterialAmount;

  // Reuse an open order only if its selection still matches what's being
  // requested now — Razorpay orders are immutable once created, so a parent
  // who changes their study-material choice needs a fresh order, not a
  // silently-wrong amount from an earlier attempt.
  const { data: existing } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", app.id)
    .eq("includes_admission", true)
    .in("status", ["created", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let payment = existing as Payment | null;
  const reusable =
    payment && payment.razorpay_order_id && payment.includes_study_material === includeStudyMaterial;

  if (!reusable) {
    const receipt = `adm_${app.id.slice(0, 8)}_${Date.now()}`;
    const order = await createRazorpayOrder({
      amount: totalAmount,
      receipt,
      notes: { application_id: app.id, includes_study_material: String(includeStudyMaterial) },
    });
    const { data: inserted } = await admin
      .from("payments")
      .insert({
        application_id: app.id,
        razorpay_order_id: order.id,
        amount: totalAmount,
        currency: "INR",
        status: "created",
        receipt,
        includes_admission: true,
        includes_study_material: includeStudyMaterial,
        admission_amount: admissionAmount,
        study_material_amount: studyMaterialAmount,
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

  return { payment: payment!, orderId: payment!.razorpay_order_id!, amount: payment!.amount };
}

// Standalone study-material payment, made after enrollment by a parent who
// declined it at the main payment step. Doesn't touch application status
// (already ENROLLED) — markPaymentCompleted branches on includes_admission
// to route here instead of the full enrollment flow.
export async function ensureStudyMaterialOnlyOrder(
  app: Application,
): Promise<{ payment: Payment; orderId: string; amount: number }> {
  if (app.status !== "ENROLLED") {
    throw new Error("Study material payment is only available after enrollment");
  }
  if (app.study_material_paid) {
    throw new Error("Study material fee has already been paid");
  }
  const admin = createSupabaseAdminClient();
  const studyMaterialAmount = await getStudyMaterialFeeForGrade(app.grade_applying);
  if (studyMaterialAmount <= 0) {
    throw new Error("No study material fee is configured for this grade");
  }

  const { data: existing } = await admin
    .from("payments")
    .select("*")
    .eq("application_id", app.id)
    .eq("includes_admission", false)
    .eq("includes_study_material", true)
    .in("status", ["created", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let payment = existing as Payment | null;
  if (!payment || !payment.razorpay_order_id) {
    const receipt = `sm_${app.id.slice(0, 8)}_${Date.now()}`;
    const order = await createRazorpayOrder({
      amount: studyMaterialAmount,
      receipt,
      notes: { application_id: app.id, study_material_only: "true" },
    });
    const { data: inserted } = await admin
      .from("payments")
      .insert({
        application_id: app.id,
        razorpay_order_id: order.id,
        amount: studyMaterialAmount,
        currency: "INR",
        status: "created",
        receipt,
        includes_admission: false,
        includes_study_material: true,
        admission_amount: 0,
        study_material_amount: studyMaterialAmount,
      })
      .select("*")
      .single();
    payment = inserted as Payment;
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

    // A study-material-only payment happens after enrollment (the parent
    // declined it at the main payment step and is paying separately later)
    // — the application is already ENROLLED, so there's no status transition
    // here, just the study_material_paid flag. The main payment sets that
    // same flag too when the parent included study material in it (it isn't
    // exclusively the "paid later" branch's job).
    const { error: appErr } = payment.includes_admission
      ? await admin
          .from("applications")
          .update({
            status: "PAYMENT_COMPLETED",
            ...(payment.includes_study_material ? { study_material_paid: true } : {}),
          })
          .eq("id", payment.application_id)
          .eq("status", "PAYMENT_PENDING")
      : await admin
          .from("applications")
          .update({ study_material_paid: true })
          .eq("id", payment.application_id);
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

  if (payment.includes_admission) {
    await handlePaymentCompleted(payment.application_id);
  } else {
    await handleStudyMaterialPaymentCompleted(payment.application_id);
  }
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
