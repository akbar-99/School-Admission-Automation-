"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  handlePaymentCompleted,
  handleSlotBooked,
  notifySlotsPublished,
  notifyTeacherSlotAssigned,
} from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import { zonedTimeToUtcISO } from "@/lib/utils";

// Admin creates an assessment slot and assigns it to a teacher.
const AssessmentSlotSchema = z.object({
  starts_at: z.string().min(1, "Start time is required"),
  duration: z.coerce.number().int().positive().max(240).default(30),
  teacher_id: z.string().uuid("Select a teacher"),
});

export async function createAssessmentSlot(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = AssessmentSlotSchema.safeParse({
    starts_at: formData.get("starts_at"),
    duration: formData.get("duration") ?? 30,
    teacher_id: formData.get("teacher_id"),
  });
  if (!parsed.success) {
    redirect("/admin/assessments?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const { starts_at, duration, teacher_id } = parsed.data!;

  // The admin enters the time in school time (e.g. IST); store the true UTC instant.
  const start = new Date(zonedTimeToUtcISO(starts_at, config.school.timezone));
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    redirect("/admin/assessments?error=" + encodeURIComponent("Choose a future start time."));
  }
  const end = new Date(start.getTime() + duration * 60_000);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("assessment_slots")
    .insert({
      teacher_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      is_open: true,
    })
    .select("id")
    .single();
  if (error) {
    redirect("/admin/assessments?error=" + encodeURIComponent(error.message));
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "assessment.slot_created",
    entity: "assessment_slot",
    entityId: data.id,
    details: { teacher_id },
  });
  await notifyTeacherSlotAssigned(teacher_id, { starts_at: start.toISOString() });
  await notifySlotsPublished();
  revalidatePath("/admin/assessments");
  redirect("/admin/assessments?ok=" + encodeURIComponent("Slot created and assigned to the teacher."));
}

// Admin directly schedules a specific applicant with a teacher at a set time —
// no parent self-booking. The slot is created already booked to the applicant.
const AssignSchema = z.object({
  application_id: z.string().uuid(),
  teacher_id: z.string().uuid("Select a teacher"),
  starts_at: z.string().min(1, "Confirmed time is required"),
  duration: z.coerce.number().int().positive().max(240).default(30),
});

export async function assignAssessment(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = AssignSchema.safeParse({
    application_id: formData.get("application_id"),
    teacher_id: formData.get("teacher_id"),
    starts_at: formData.get("starts_at"),
    duration: formData.get("duration") ?? 30,
  });
  if (!parsed.success) {
    redirect("/admin/assessments?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const { application_id, teacher_id, starts_at, duration } = parsed.data!;

  // The confirmed time is entered/shown in school time; store the UTC instant.
  const start = new Date(zonedTimeToUtcISO(starts_at, config.school.timezone));
  if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
    redirect("/admin/assessments?error=" + encodeURIComponent("Choose a future time."));
  }
  const end = new Date(start.getTime() + duration * 60_000);

  const admin = createSupabaseAdminClient();
  const { data: app } = await admin
    .from("applications")
    .select("status, category")
    .eq("id", application_id)
    .maybeSingle();
  if (!app || app.category !== "GRADE" || app.status !== "FORM_SUBMITTED") {
    redirect(
      "/admin/assessments?error=" +
        encodeURIComponent("This applicant is no longer awaiting scheduling."),
    );
  }

  // Create the slot already booked to this applicant (unique per application).
  const { error: slotErr } = await admin.from("assessment_slots").insert({
    teacher_id,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    is_open: false,
    application_id,
  });
  if (slotErr) {
    redirect("/admin/assessments?error=" + encodeURIComponent(slotErr.message));
  }

  // FORM_SUBMITTED -> ASSESSMENT_SCHEDULED (valid transition)
  await admin
    .from("applications")
    .update({ status: "ASSESSMENT_SCHEDULED" })
    .eq("id", application_id)
    .eq("status", "FORM_SUBMITTED");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "assessment.assigned",
    entity: "application",
    entityId: application_id,
    details: { teacher_id, starts_at: start.toISOString() },
  });
  // Confirm to parent + assigned teacher + admin.
  await handleSlotBooked(application_id, { starts_at: start.toISOString(), teacher_id });
  revalidatePath("/admin/assessments");
  redirect(
    "/admin/assessments?ok=" + encodeURIComponent("Assessment scheduled and everyone notified."),
  );
}

// Permanently delete one applicant and all their records. Frees their seat if
// they were enrolled. Guarded by typing DELETE.
export async function deleteApplication(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const appId = String(formData.get("application_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "DELETE") {
    redirect(`/admin/applications/${appId}?error=` + encodeURIComponent('Type "DELETE" to confirm.'));
  }

  const admin = createSupabaseAdminClient();
  const { data: app } = await admin
    .from("applications")
    .select("id, parent_id, student_id, section_id")
    .eq("id", appId)
    .maybeSingle();
  if (!app) back("Application not found.", "error");

  // Free the seat if one was allocated.
  if (app!.section_id) {
    const { data: sec } = await admin
      .from("sections")
      .select("filled")
      .eq("id", app!.section_id)
      .maybeSingle();
    if (sec) {
      await admin
        .from("sections")
        .update({ filled: Math.max(0, sec.filled - 1) })
        .eq("id", app!.section_id);
    }
  }

  // Remove slots tied to this application, then the application (cascades
  // payments/notifications/results), the student, and the now-orphan parent.
  await admin.from("assessment_slots").delete().eq("application_id", app!.id);
  await admin.from("applications").delete().eq("id", app!.id);
  if (app!.student_id) await admin.from("students").delete().eq("id", app!.student_id);
  const { count } = await admin
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", app!.parent_id);
  if (!count) await admin.from("parents").delete().eq("id", app!.parent_id);

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "application.deleted",
    entity: "application",
    entityId: appId,
  });
  back("Applicant deleted.");
}

// Factory reset: wipe ALL applicant data (keeps staff, sections, config).
// Guarded by typing RESET.
export async function factoryReset(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const confirm = String(formData.get("confirm") ?? "").trim();
  if (confirm !== "RESET") {
    redirect("/admin/settings?error=" + encodeURIComponent('Type "RESET" to confirm.'));
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("factory_reset_applicants");
  if (error) {
    redirect("/admin/settings?error=" + encodeURIComponent(error.message));
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "system.factory_reset",
    entity: "system",
  });
  redirect("/admin/settings?ok=" + encodeURIComponent("All applicant data has been wiped."));
}

// Admin-editable settings → app_config (applied at runtime, no redeploy).
export async function updateSettings(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const feeRupees = Number(formData.get("fee_rupees"));
  if (!Number.isFinite(feeRupees) || feeRupees < 0) {
    redirect("/admin/settings?error=" + encodeURIComponent("Enter a valid admission fee."));
  }
  const feePaise = Math.round(feeRupees * 100);

  const rows = [
    { key: "admission_fee_paise", value: String(feePaise) },
    { key: "agreement_terms", value: String(formData.get("agreement_terms") ?? "").trim() },
    { key: "school_name", value: String(formData.get("school_name") ?? "").trim() },
    { key: "school_phone", value: String(formData.get("school_phone") ?? "").trim() },
    { key: "school_email", value: String(formData.get("school_email") ?? "").trim() },
    { key: "academic_term_start", value: String(formData.get("academic_term_start") ?? "").trim() },
    { key: "academic_orientation", value: String(formData.get("academic_orientation") ?? "").trim() },
    { key: "study_material", value: String(formData.get("study_material") ?? "").trim() },
  ];

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("app_config").upsert(rows, { onConflict: "key" });
  if (error) {
    redirect("/admin/settings?error=" + encodeURIComponent(error.message));
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "settings.updated",
    entity: "app_config",
  });
  revalidatePath("/admin/settings");
  redirect("/admin/settings?ok=" + encodeURIComponent("Settings saved."));
}

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
