"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { syncBroadwayClasses, syncBroadwayStudents } from "@/lib/broadway";
import { retryBroadwaySync, pushAllSectionsToBroadway } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

function back(msg?: string, type: "error" | "ok" = "ok"): never {
  redirect("/admin/broadway" + (msg ? `?${type}=${encodeURIComponent(msg)}` : ""));
}

// Admin-only: pull the latest classes (seats, this/next year numbers) from
// Broadway, then every student (powers the name/admission-number search —
// Broadway has no cross-class search of its own, only this paged endpoint).
export async function syncBroadwayNow() {
  const { profile } = await requireRole(["admin", "coo"]);
  const count = await syncBroadwayClasses();
  if (count === null) back("Broadway class sync failed — check BROADWAY_API_URL/BROADWAY_API_KEY and the connection.", "error");

  const studentCount = await syncBroadwayStudents();

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "broadway.synced",
    entity: "system",
    details: { classes: count, students: studentCount },
  });

  revalidatePath("/admin/broadway");
  revalidatePath("/admin/sections");
  back(
    studentCount === null
      ? `Synced ${count} classes from Broadway. Student search cache failed to sync — try again.`
      : `Synced ${count} classes and ${studentCount} students from Broadway.`,
  );
}

// Admin-only: retry a stuck sync (no_mapping or send_failed) — resending the
// same application id is always safe on Broadway's side.
export async function retryBroadwayAdmission(formData: FormData) {
  const { profile } = await requireRole(["admin", "coo"]);
  const applicationId = String(formData.get("application_id") ?? "");
  if (!applicationId) back("Invalid retry request.", "error");

  await retryBroadwaySync(applicationId);

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "broadway.retry",
    entity: "application",
    entityId: applicationId,
  });

  revalidatePath("/admin/broadway");
  back("Retry attempted — check the status below.");
}

// Admin-only: first-connection tool (or a one-off re-sync) — sends every
// local section with a Broadway class name set, in one batch call.
export async function sendAllSectionsToBroadway() {
  const { profile } = await requireRole(["admin", "coo"]);
  const result = await pushAllSectionsToBroadway();
  if (result === null) back("Sending sections to Broadway failed — check the connection and try again.", "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "broadway.bulk_section_push",
    entity: "system",
    details: result,
  });

  revalidatePath("/admin/broadway");
  revalidatePath("/admin/sections");
  back(
    result.sent === 0
      ? "No sections have a Broadway class name set yet — add one under Admin → Sections first."
      : `Sent ${result.sent} section(s): ${result.synced} synced, ${result.failed} failed.`,
  );
}
