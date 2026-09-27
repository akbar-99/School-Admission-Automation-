"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyPaymentRefunded } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import type { Application, Parent, Payment } from "@/lib/types";

const MarkPaymentRefundedSchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(3, "Give a short reason for the refund"),
});

// Razorpay refunds are triggered by staff (from Razorpay's own dashboard or
// support line), not something the payment webhook ever reports back — this
// just records that fact and tells the marketing rep who owns the lead,
// since they'd otherwise have no way to find out their student refunded.
export async function markPaymentRefunded(formData: FormData) {
  const { profile } = await requireRole(["admin", "coo"]);
  const parsed = MarkPaymentRefundedSchema.safeParse({
    payment_id: formData.get("payment_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect("/admin/payments?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const input = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: payment, error } = await admin
    .from("payments")
    .update({
      status: "refunded",
      refunded_at: new Date().toISOString(),
      refund_reason: input.reason,
      refunded_by: profile.id,
    })
    .eq("id", input.payment_id)
    .eq("status", "completed")
    .select("*")
    .maybeSingle();
  if (error || !payment) {
    redirect("/admin/payments?error=" + encodeURIComponent("Only a completed payment can be marked as refunded."));
  }

  const { data: app } = await admin
    .from("applications")
    .select("*")
    .eq("id", payment!.application_id)
    .maybeSingle();
  const { data: parent } = app
    ? await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle()
    : { data: null };
  if (app && parent) {
    await notifyPaymentRefunded(app as Application, parent as Parent, payment as Payment);
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "payment.refunded",
    entity: "payment",
    entityId: payment!.id,
    details: { reason: input.reason },
  });

  revalidatePath("/admin/payments");
  redirect("/admin/payments?refunded=1");
}
