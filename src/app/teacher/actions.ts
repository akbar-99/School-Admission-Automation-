"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handleAssessmentResult, notifySlotsPublished } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

const SlotSchema = z.object({
  starts_at: z.string().min(1, "Start time is required"),
  duration: z.coerce.number().int().positive().max(240).default(30),
});

export async function openSlot(formData: FormData) {
  const { profile } = await requireRole(["teacher", "admin"]);
  const parsed = SlotSchema.safeParse({
    starts_at: formData.get("starts_at"),
    duration: formData.get("duration") ?? 30,
  });
  if (!parsed.success) {
    redirect("/teacher?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const start = new Date(parsed.data.starts_at);
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    redirect("/teacher?error=" + encodeURIComponent("Choose a future start time."));
  }
  const end = new Date(start.getTime() + parsed.data.duration * 60_000);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("assessment_slots")
    .insert({
      teacher_id: profile.id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      is_open: true,
    })
    .select("id")
    .single();
  if (error) {
    redirect("/teacher?error=" + encodeURIComponent(error.message));
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "assessment.slot_opened",
    entity: "assessment_slot",
    entityId: data.id,
  });
  // N-3: notify grade applicants awaiting a slot
  await notifySlotsPublished();
  revalidatePath("/teacher");
  redirect("/teacher?opened=1");
}

const ResultSchema = z.object({
  application_id: z.string().uuid(),
  slot_id: z.string().uuid().optional(),
  outcome: z.enum(["PASS", "FAIL"]),
  remarks: z.string().trim().optional(),
});

export async function submitResult(formData: FormData) {
  const { profile } = await requireRole(["teacher", "admin"]);
  const parsed = ResultSchema.safeParse({
    application_id: formData.get("application_id"),
    slot_id: formData.get("slot_id") || undefined,
    outcome: formData.get("outcome"),
    remarks: formData.get("remarks") || undefined,
  });
  if (!parsed.success) {
    redirect("/teacher?error=" + encodeURIComponent("Invalid result submission."));
  }
  const input = parsed.data;
  const admin = createSupabaseAdminClient();

  const { error: rErr } = await admin.from("assessment_results").insert({
    application_id: input.application_id,
    slot_id: input.slot_id ?? null,
    teacher_id: profile.id,
    outcome: input.outcome,
    remarks: input.remarks ?? null,
  });
  if (rErr) {
    redirect("/teacher?error=" + encodeURIComponent(rErr.message));
  }

  // ASSESSMENT_SCHEDULED -> ASSESSMENT_COMPLETED
  await admin
    .from("applications")
    .update({ status: "ASSESSMENT_COMPLETED" })
    .eq("id", input.application_id)
    .eq("status", "ASSESSMENT_SCHEDULED");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "assessment.result_recorded",
    entity: "application",
    entityId: input.application_id,
    details: { outcome: input.outcome },
  });

  // Pass -> agreement (N-6); Fail -> rejected (N-10)
  await handleAssessmentResult(input.application_id, input.outcome, input.remarks ?? null);
  revalidatePath("/teacher");
  redirect("/teacher?recorded=1");
}
