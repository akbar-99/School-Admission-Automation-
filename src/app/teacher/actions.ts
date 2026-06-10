"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handleAssessmentResult } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";

// Slot creation is admin-only — see src/app/admin/actions.ts (createAssessmentSlot).
// Teachers only conduct assessments and record results for their assigned slots.

const ResultSchema = z.object({
  application_id: z.string().uuid(),
  slot_id: z.string().uuid().optional(),
  outcome: z.enum(["PASS", "FAIL"]),
  remarks: z.string().trim().optional(),
});

const ASSESSMENT_MAX_FILE = 5 * 1024 * 1024; // 5 MB
const ASSESSMENT_ALLOWED_EXT = [".pdf", ".xls", ".xlsx", ".csv"];

interface SubjectInput {
  subject: string;
  score: number | null;
  comment: string | null;
  file: { category: string; type: string; path: string; name: string; size: number } | null;
}

// Read the per-subject score / comment / file rows from the form, uploading any
// attached PDF/Excel into the private "documents" bucket.
async function parseSubjects(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  applicationId: string,
  formData: FormData,
): Promise<SubjectInput[]> {
  const subjects: SubjectInput[] = [];
  const count = Number(formData.get("subject_count") ?? 0);
  for (let i = 0; i < count; i++) {
    const subject = String(formData.get(`subject_${i}`) ?? "").trim();
    if (!subject) continue;

    const scoreRaw = formData.get(`score_${i}`);
    const scoreNum =
      scoreRaw != null && String(scoreRaw).trim() !== "" ? Number(scoreRaw) : NaN;
    const score = Number.isFinite(scoreNum) ? scoreNum : null;
    const comment = String(formData.get(`comment_${i}`) ?? "").trim() || null;

    let file: SubjectInput["file"] = null;
    const f = formData.get(`file_${i}`);
    if (f instanceof File && f.size > 0) {
      const lower = f.name.toLowerCase();
      if (!ASSESSMENT_ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
        redirect("/teacher?error=" + encodeURIComponent(`${subject}: only PDF or Excel files are allowed.`));
      }
      if (f.size > ASSESSMENT_MAX_FILE) {
        redirect("/teacher?error=" + encodeURIComponent(`${subject}: file exceeds the 5 MB limit.`));
      }
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const path = `assessments/${applicationId}/${slug}_${Date.now()}_${safe}`;
      const buffer = Buffer.from(await f.arrayBuffer());
      const { error: upErr } = await admin.storage
        .from("documents")
        .upload(path, buffer, { contentType: f.type || "application/octet-stream", upsert: false });
      if (upErr) {
        redirect("/teacher?error=" + encodeURIComponent(`${subject}: upload failed — ${upErr.message}`));
      }
      file = { category: subject, type: f.type || "application/octet-stream", path, name: f.name, size: f.size };
    }

    subjects.push({ subject, score, comment, file });
  }
  return subjects;
}

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

  // The application must be awaiting a result. This also prevents recording a
  // result against an application in any other state.
  const { data: appRow } = await admin
    .from("applications")
    .select("id, status")
    .eq("id", input.application_id)
    .maybeSingle();
  if (!appRow || appRow.status !== "ASSESSMENT_SCHEDULED") {
    redirect("/teacher?error=" + encodeURIComponent("This applicant is not awaiting an assessment result."));
  }

  // A teacher may only record a result for a slot they conducted. Admins may
  // record on anyone's behalf.
  if (profile.role === "teacher") {
    const { data: slot } = await admin
      .from("assessment_slots")
      .select("teacher_id")
      .eq("application_id", input.application_id)
      .maybeSingle();
    if (!slot || slot.teacher_id !== profile.id) {
      redirect("/teacher?error=" + encodeURIComponent("You can only record results for your own assessment slots."));
    }
  }

  const subjects = await parseSubjects(admin, input.application_id, formData);

  const { error: rErr } = await admin.from("assessment_results").insert({
    application_id: input.application_id,
    slot_id: input.slot_id ?? null,
    teacher_id: profile.id,
    outcome: input.outcome,
    remarks: input.remarks ?? null,
    subjects,
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
