"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { syncErpCapacity, syncErpStudents, transferErpStudents } from "@/lib/erp";
import { retryErpSync, resendErpAdmission } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function back(msg?: string, type: "error" | "ok" = "ok"): never {
  redirect("/admin/erp" + (msg ? `?${type}=${encodeURIComponent(msg)}` : ""));
}

// Admin-only: pull the latest capacity/enrollment numbers from the ERP, then
// every class's student roster (powers the name/ID search — the ERP has no
// cross-class search of its own). Not required for allocation anymore
// (this app's own sections decide the division) — kept as a reference so
// admins can see real ERP capacity alongside this app's own numbers when
// setting up Admin → Sections' ERP class name field.
export async function syncErpNow() {
  const { profile } = await requireRole(["admin"]);
  const count = await syncErpCapacity();
  if (count === null) back("ERP capacity sync failed — check ERP_ADMISSIONS_SECRET and the ERP endpoint.", "error");

  const studentCount = await syncErpStudents();

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "erp.capacity_synced",
    entity: "system",
    details: { classes: count, students: studentCount },
  });

  revalidatePath("/admin/erp");
  back(
    studentCount === null
      ? `Synced ${count} classes from the ERP. Student search cache failed to sync — try again.`
      : `Synced ${count} classes and ${studentCount} students from the ERP.`,
  );
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

const StudentRefSchema = z.object({
  internal_id: z.string().min(1),
  admission_id: z.string().uuid().nullable(),
});

const TransferSchema = z.object({
  students: z.array(z.string()).min(1),
  class_name: z.string().trim().min(1),
  from_class_name: z.string().trim().min(1),
});

// Admin-only: move one or more students (selected from a class's roster) to
// a different ERP class — covers both a single transfer and bulk promotion.
// Each checkbox's value is a JSON blob of {internal_id, admission_id} built
// from the roster the page already fetched from the ERP (see
// admissions-class-students), so every student in the roster is eligible —
// not just ones this app created itself — now that the ERP exposes each
// student's real internal id there, not only the human-readable number.
export async function bulkTransferErpStudents(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const fromClassName = String(formData.get("from_class_name") ?? "");
  const classPage = fromClassName
    ? `/admin/erp/classes/${encodeURIComponent(fromClassName)}`
    : "/admin/erp";
  // A nested function declaration, not a const arrow — TS's unreachable-code
  // narrowing after a never-returning call only kicks in for the former in
  // this setup (verified in isolation), so a const here would silently
  // break every `if (!x.ok) backToClass(...)` narrowing below.
  function backToClass(msg?: string, type: "error" | "ok" = "ok"): never {
    redirect(classPage + (msg ? `?${type}=${encodeURIComponent(msg)}` : ""));
  }

  const parsed = TransferSchema.safeParse({
    students: formData.getAll("students"),
    class_name: formData.get("class_name"),
    from_class_name: fromClassName,
  });
  if (!parsed.success) backToClass("Select at least one student and a target class.", "error");
  const { students: rawStudents, class_name } = parsed.data!;

  const refs = rawStudents
    .map((s) => {
      try {
        return StudentRefSchema.parse(JSON.parse(s));
      } catch {
        return null;
      }
    })
    .filter((r): r is z.infer<typeof StudentRefSchema> => r !== null);
  if (refs.length === 0) backToClass("Invalid selection — please try again.", "error");

  const result = await transferErpStudents(
    refs.map((r) => r.internal_id),
    class_name,
  );
  if (!result.ok) {
    backToClass(`ERP transfer failed: ${result.error}`, "error");
  }

  // Keep this app's own erp_class_name in sync for whichever applications
  // actually moved (only meaningful for refs that have a local application
  // in the first place) — the ones the ERP reported as missing didn't move.
  const missing = new Set(result.missingStudentIds);
  const transferredAppIds = refs
    .filter((r) => r.admission_id && !missing.has(r.internal_id))
    .map((r) => r.admission_id!);
  if (transferredAppIds.length > 0) {
    const admin = createSupabaseAdminClient();
    await admin.from("applications").update({ erp_class_name: class_name }).in("id", transferredAppIds);
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "erp.students_transferred",
    entity: "system",
    details: {
      from_class_name: fromClassName,
      to_class_name: class_name,
      requested: refs.length,
      transferred: result.transferredCount,
      missing: result.missingStudentIds.length,
    },
  });

  revalidatePath(classPage);
  revalidatePath(`/admin/erp/classes/${encodeURIComponent(class_name)}`);
  revalidatePath("/admin/erp");

  const msg =
    result.missingStudentIds.length > 0
      ? `Transferred ${result.transferredCount} student(s) to ${class_name}. ${result.missingStudentIds.length} could not be found in the ERP.`
      : `Transferred ${result.transferredCount} student(s) to ${class_name}.`;
  backToClass(msg, result.missingStudentIds.length > 0 ? "error" : "ok");
}
