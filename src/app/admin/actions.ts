"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handlePaymentCompleted } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

function back(msg?: string, type: "error" | "ok" = "ok") {
  redirect("/admin?" + (msg ? `${type}=${encodeURIComponent(msg)}` : ""));
}

// Manually resolve a NEEDS_ADMIN application by re-running enrollment (after
// capacity has been freed / added). SRS FR-22.
export async function resolveSeat(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const appId = String(formData.get("application_id") ?? "");
  if (!appId) back("Missing application", "error");

  const result = await handlePaymentCompleted(appId, { sendReceipt: false });
  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.resolve_seat",
    entity: "application",
    entityId: appId,
    details: result,
  });
  if (result.status === "ENROLLED") back("Student enrolled and assigned a section.");
  if (result.status === "NEEDS_ADMIN") back("Still no seat available — add capacity first.", "error");
  back("Processed.");
}

const CapacitySchema = z.object({
  section_id: z.string().uuid(),
  delta: z.coerce.number().int(),
});

export async function adjustCapacity(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = CapacitySchema.safeParse({
    section_id: formData.get("section_id"),
    delta: formData.get("delta"),
  });
  if (!parsed.success) back("Invalid capacity change", "error");
  const { section_id, delta } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: section } = await admin
    .from("sections")
    .select("capacity, filled")
    .eq("id", section_id)
    .single();
  if (!section) back("Section not found", "error");

  const next = section!.capacity + delta;
  if (next < section!.filled) back("Capacity cannot be below current enrolment", "error");

  await admin.from("sections").update({ capacity: next }).eq("id", section_id);
  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.adjust_capacity",
    entity: "section",
    entityId: section_id,
    details: { delta, capacity: next },
  });
  back("Capacity updated.");
}

const SectionSchema = z.object({
  grade: z.string().trim().min(1),
  name: z.string().trim().min(1).max(4),
  capacity: z.coerce.number().int().positive().max(200).default(30),
});

export async function createSection(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = SectionSchema.safeParse({
    grade: formData.get("grade"),
    name: formData.get("name"),
    capacity: formData.get("capacity") ?? 30,
  });
  if (!parsed.success) back("Invalid section", "error");
  const { grade, name, capacity } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sections")
    .insert({ grade: grade.toUpperCase(), name: name.toUpperCase(), capacity });
  if (error) back(error.message, "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.create_section",
    entity: "section",
    details: { grade, name, capacity },
  });
  revalidatePath("/admin");
  back("Section created.");
}
