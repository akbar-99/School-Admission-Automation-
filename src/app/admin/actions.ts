"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  handlePaymentCompleted,
  handleSlotBooked,
  notifyOpenSlotAvailable,
  notifySlotReassigned,
  notifySlotsPublished,
  notifyTeacherSlotAssigned,
} from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import { zonedTimeToUtcISO, toZonedInputValue } from "@/lib/utils";
import { needsAssessment } from "@/lib/assessment";

// ---------------------------------------------------------------------------
// Weekly recurrence helpers — an admin picks a weekday (Monday, Tuesday…) and
// a time rather than a single calendar date. "Weekday" is 0=Sunday..6=Saturday
// (JS convention), evaluated in school time so DST-less IST-style zones and
// zones with DST both resolve the same wall-clock weekday.
// ---------------------------------------------------------------------------
function zonedYMD(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

function zonedWeekday(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(name);
}

// Add `days` calendar days to a Y/M/D triple (pure calendar arithmetic).
function addDays(ymd: { y: number; m: number; d: number }, days: number) {
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d) + days * 86_400_000;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// Local "YYYY-MM-DDTHH:mm" wall-clock strings (school time) for `weeks`
// weekly occurrences of `weekday` at `time`, starting from the next one at
// or after now.
function weeklyOccurrences(
  weekday: number,
  time: string,
  weeks: number,
  timeZone: string,
): string[] {
  const now = new Date();
  const todayYmd = zonedYMD(now, timeZone);
  const todayWeekday = zonedWeekday(now, timeZone);
  let deltaDays = (weekday - todayWeekday + 7) % 7;
  if (deltaDays === 0 && time <= toZonedInputValue(now, timeZone).slice(11)) {
    deltaDays = 7; // today's occurrence already started
  }
  const first = addDays(todayYmd, deltaDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: weeks }, (_, w) => {
    const { y, m, d } = addDays(first, w * 7);
    return `${y}-${pad(m)}-${pad(d)}T${time}`;
  });
}

// Admin creates one or more assessment slots on a recurring weekday, either
// assigned to a specific teacher (only for a single total slot) or left open
// for any teacher to claim from the pool — e.g. "Monday 8:00 PM, 10 slots,
// repeat 8 weeks" opens 10 slots every Monday for 8 weeks.
const AssessmentSlotSchema = z.object({
  weekday: z.coerce.number().int().min(0).max(6),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  duration: z.coerce.number().int().positive().max(240).default(30),
  quantity: z.coerce.number().int().positive().max(50).default(1),
  weeks: z.coerce.number().int().positive().max(26).default(1),
  teacher_id: z.string().uuid("Select a teacher").optional().or(z.literal("")),
});

export async function createAssessmentSlot(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = AssessmentSlotSchema.safeParse({
    weekday: formData.get("weekday"),
    time: formData.get("time"),
    duration: formData.get("duration") ?? 30,
    quantity: formData.get("quantity") ?? 1,
    weeks: formData.get("weeks") ?? 1,
    teacher_id: formData.get("teacher_id") || undefined,
  });
  if (!parsed.success) {
    redirect("/admin/assessments?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const { weekday, time, duration, quantity, weeks, teacher_id } = parsed.data!;
  const total = quantity * weeks;

  if (teacher_id && total > 1) {
    redirect(
      "/admin/assessments?error=" +
        encodeURIComponent(
          "To open multiple slots at once, leave 'Assign teacher' as Open so teachers can each claim one.",
        ),
    );
  }
  if (total > 200) {
    redirect(
      "/admin/assessments?error=" +
        encodeURIComponent("That's too many slots at once (max 200). Create in smaller batches."),
    );
  }

  const schoolTz = config.school.timezone;
  const occurrences = weeklyOccurrences(weekday, time, weeks, schoolTz).map((local) => {
    const start = new Date(zonedTimeToUtcISO(local, schoolTz));
    return { start, end: new Date(start.getTime() + duration * 60_000) };
  });

  const admin = createSupabaseAdminClient();
  const rows = occurrences.flatMap(({ start, end }) =>
    Array.from({ length: quantity }, () => ({
      teacher_id: teacher_id || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      is_open: true,
    })),
  );
  const { data, error } = await admin.from("assessment_slots").insert(rows).select("id");
  if (error || !data) {
    redirect("/admin/assessments?error=" + encodeURIComponent(error?.message ?? "Could not create slots."));
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "assessment.slot_created",
    entity: "assessment_slot",
    entityId: data[0].id,
    details: {
      teacher_id: teacher_id || null,
      weekday,
      time,
      quantity,
      weeks,
      total,
      slot_ids: data.map((d) => d.id),
    },
  });
  const firstStart = occurrences[0].start.toISOString();
  if (teacher_id) {
    await notifyTeacherSlotAssigned(teacher_id, { starts_at: firstStart });
  } else {
    await notifyOpenSlotAvailable({ starts_at: firstStart }, quantity, weeks);
  }
  await notifySlotsPublished();
  revalidatePath("/admin/assessments");
  redirect(
    "/admin/assessments?ok=" +
      encodeURIComponent(
        teacher_id
          ? "Slot created and assigned to the teacher."
          : weeks > 1
            ? `${total} slots created (${quantity} every week for ${weeks} weeks) and opened to the teacher pool.`
            : quantity > 1
              ? `${quantity} slots created and opened to the teacher pool — first to claim each one gets it.`
              : "Slot created and opened to the teacher pool — first to claim it gets it.",
      ),
  );
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
    .select("status, grade_applying")
    .eq("id", application_id)
    .maybeSingle();
  if (!app || !needsAssessment(app.grade_applying ?? "") || app.status !== "FORM_SUBMITTED") {
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

// Move a slot (claimed-but-unbooked, or already booked) to a different
// teacher — e.g. the assigned teacher reported they can't attend. For a
// booked slot the Zoom meeting is regenerated under the new teacher and the
// parent is notified with the refreshed link.
const ReassignSchema = z.object({
  slot_id: z.string().uuid(),
  teacher_id: z.string().uuid("Select a teacher"),
});

export async function reassignSlotTeacher(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = ReassignSchema.safeParse({
    slot_id: formData.get("slot_id"),
    teacher_id: formData.get("teacher_id"),
  });
  if (!parsed.success) {
    redirect("/admin/assessments?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const { slot_id, teacher_id: newTeacherId } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: slot } = await admin
    .from("assessment_slots")
    .select("id, teacher_id, starts_at, application_id")
    .eq("id", slot_id)
    .maybeSingle();
  if (!slot) {
    redirect("/admin/assessments?error=" + encodeURIComponent("Slot not found."));
  }
  if (slot!.teacher_id === newTeacherId) {
    redirect("/admin/assessments?error=" + encodeURIComponent("Already assigned to that teacher."));
  }

  await admin
    .from("assessment_slots")
    .update({
      teacher_id: newTeacherId,
      claimed_by_teacher: false, // admin-assigned, not self-claimed
      unavailable_reported: false,
      unavailable_reported_at: null,
      // Force the Zoom meeting to regenerate under the new host.
      ...(slot!.application_id
        ? {
            zoom_meeting_id: null,
            zoom_join_url: null,
            zoom_start_url: null,
            zoom_passcode: null,
            zoom_created_at: null,
          }
        : {}),
    })
    .eq("id", slot_id);

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "assessment.slot_reassigned",
    entity: "assessment_slot",
    entityId: slot_id,
    details: { from_teacher_id: slot!.teacher_id, to_teacher_id: newTeacherId },
  });

  await notifySlotReassigned({
    slotStartsAt: slot!.starts_at,
    oldTeacherId: slot!.teacher_id,
    newTeacherId,
    applicationId: slot!.application_id,
  });

  revalidatePath("/admin/assessments");
  revalidatePath("/teacher");
  redirect("/admin/assessments?ok=" + encodeURIComponent("Slot reassigned and everyone notified."));
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
    { key: "assessment_subjects", value: String(formData.get("assessment_subjects") ?? "").trim() },
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

function sectionsBack(msg?: string, type: "error" | "ok" = "ok"): never {
  redirect("/admin/sections?" + (msg ? `${type}=${encodeURIComponent(msg)}` : ""));
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
  if (!parsed.success) sectionsBack("Invalid capacity change", "error");
  const { section_id, delta } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: section } = await admin
    .from("sections")
    .select("capacity, filled")
    .eq("id", section_id)
    .single();
  if (!section) sectionsBack("Section not found", "error");

  const next = section!.capacity + delta;
  if (next < section!.filled) sectionsBack("Capacity cannot be below current enrolment", "error");

  await admin.from("sections").update({ capacity: next }).eq("id", section_id);
  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.adjust_capacity",
    entity: "section",
    entityId: section_id,
    details: { delta, capacity: next },
  });
  revalidatePath("/admin/sections");
  sectionsBack("Capacity updated.");
}

// Edit an existing section's grade, name and capacity.
const UpdateSectionSchema = z.object({
  section_id: z.string().uuid(),
  grade: z.string().trim().min(1),
  name: z.string().trim().min(1).max(4),
  capacity: z.coerce.number().int().positive().max(200),
});

export async function updateSection(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = UpdateSectionSchema.safeParse({
    section_id: formData.get("section_id"),
    grade: formData.get("grade"),
    name: formData.get("name"),
    capacity: formData.get("capacity"),
  });
  if (!parsed.success) sectionsBack(parsed.error.issues[0].message, "error");
  const { section_id, grade, name, capacity } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: section } = await admin
    .from("sections")
    .select("filled")
    .eq("id", section_id)
    .single();
  if (!section) sectionsBack("Section not found", "error");
  if (capacity < section!.filled) {
    sectionsBack("Capacity cannot be below current enrolment.", "error");
  }

  const { error } = await admin
    .from("sections")
    .update({ grade: grade.toUpperCase(), name: name.toUpperCase(), capacity })
    .eq("id", section_id);
  if (error) sectionsBack(error.message, "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.update_section",
    entity: "section",
    entityId: section_id,
    details: { grade, name, capacity },
  });
  revalidatePath("/admin/sections");
  sectionsBack("Section updated.");
}

// Delete a section. Blocked while any student is enrolled in it.
export async function deleteSection(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const section_id = String(formData.get("section_id") ?? "");
  if (!section_id) sectionsBack("Missing section.", "error");

  const admin = createSupabaseAdminClient();
  const { data: section } = await admin
    .from("sections")
    .select("filled, grade, name")
    .eq("id", section_id)
    .single();
  if (!section) sectionsBack("Section not found", "error");
  if (section!.filled > 0) {
    sectionsBack("Cannot delete a section with enrolled students. Empty it first.", "error");
  }
  const { count } = await admin
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("section_id", section_id);
  if ((count ?? 0) > 0) {
    sectionsBack("Cannot delete: applications are still assigned to this section.", "error");
  }

  const { error } = await admin.from("sections").delete().eq("id", section_id);
  if (error) sectionsBack(error.message, "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.delete_section",
    entity: "section",
    entityId: section_id,
    details: { grade: section!.grade, name: section!.name },
  });
  revalidatePath("/admin/sections");
  sectionsBack("Section deleted.");
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
  if (!parsed.success) sectionsBack("Invalid section", "error");
  const { grade, name, capacity } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("sections")
    .insert({ grade: grade.toUpperCase(), name: name.toUpperCase(), capacity });
  if (error) sectionsBack(error.message, "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "admin.create_section",
    entity: "section",
    details: { grade, name, capacity },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/sections");
  sectionsBack("Section created.");
}
