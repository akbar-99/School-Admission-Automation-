"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { syncErpCapacity } from "@/lib/erp";
import { retryErpSync, resendErpAdmission } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

function back(msg?: string, type: "error" | "ok" = "ok"): never {
  redirect("/admin/erp" + (msg ? `?${type}=${encodeURIComponent(msg)}` : ""));
}

// Admin-only: pull the latest capacity/enrollment numbers from the ERP. Not
// required for allocation anymore (this app's own sections decide the
// division) — kept as a reference so admins can see real ERP capacity
// alongside this app's own numbers when setting up Admin → Sections' ERP
// class name field.
export async function syncErpNow() {
  const { profile } = await requireRole(["admin"]);
  const count = await syncErpCapacity();
  if (count === null) back("ERP capacity sync failed — check ERP_ADMISSIONS_SECRET and the ERP endpoint.", "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "erp.capacity_synced",
    entity: "system",
    details: { classes: count },
  });

  revalidatePath("/admin/erp");
  back(`Synced ${count} classes from the ERP.`);
}

const RetrySchema = z.object({
  application_id: z.string().uuid(),
  erp_status: z.enum(["no_mapping", "send_failed"]),
});

// Admin-only: retry a stuck ERP sync. no_mapping re-checks the section's ERP
// class name (set it under Admin → Sections first); send_failed only
// re-sends the already-resolved class.
export async function retryErpAdmission(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = RetrySchema.safeParse({
    application_id: formData.get("application_id"),
    erp_status: formData.get("erp_status"),
  });
  if (!parsed.success) back("Invalid retry request.", "error");
  const { application_id, erp_status } = parsed.data!;

  if (erp_status === "send_failed") {
    await resendErpAdmission(application_id);
  } else {
    await retryErpSync(application_id);
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "erp.retry",
    entity: "application",
    entityId: application_id,
    details: { from_status: erp_status },
  });

  revalidatePath("/admin/erp");
  back("Retry attempted — check the status below.");
}
