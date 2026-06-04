"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loadApplicationByToken } from "@/lib/parent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { detectCategory } from "@/lib/age";
import { ensureOrderForApplication, markPaymentCompleted } from "@/lib/payments";
import {
  handleFormSubmitted,
  handleSlotBooked,
  notifySlotsPublished,
} from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import type { Application } from "@/lib/types";

const MAX_FILE = 5 * 1024 * 1024; // 5 MB (SRS FR-4a)
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

const FormSchema = z.object({
  student_name: z.string().trim().min(2, "Student name is required"),
  dob: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female", "other"]).optional(),
  previous_school: z.string().trim().optional(),
  grade: z.string().trim().min(1, "Grade is required"),
});

function fail(token: string, message: string): never {
  redirect(`/apply/${token}?error=${encodeURIComponent(message)}`);
}

export async function submitAdmissionForm(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  if (app.status !== "LEAD_CREATED") {
    redirect(`/apply/${token}`);
  }

  if (formData.get("consent") !== "on") {
    fail(token, "You must accept the data-processing consent to continue.");
  }

  const parsed = FormSchema.safeParse({
    student_name: formData.get("student_name"),
    dob: formData.get("dob"),
    gender: formData.get("gender") || undefined,
    previous_school: formData.get("previous_school") || undefined,
    grade: formData.get("grade"),
  });
  if (!parsed.success) fail(token, parsed.error.issues[0].message);
  const input = parsed.data;

  // Category detection from age at cutoff (SRS FR-7)
  const detect = detectCategory(input.dob);
  if (!detect.eligible) fail(token, detect.message);

  // Reconcile grade with detected category
  let grade = input.grade;
  if (detect.category === "KG") grade = "KG";
  else if (grade === "KG" || !grade) grade = "G1";

  const admin = createSupabaseAdminClient();

  // Upload documents (optional, validated). Stored privately in Supabase Storage.
  const files = formData.getAll("documents").filter((f): f is File => f instanceof File && f.size > 0);
  const documents: { type: string; path: string; name: string; size: number }[] = [];
  for (const file of files) {
    if (!ALLOWED.has(file.type)) fail(token, `Unsupported file type: ${file.name}. Use PDF, JPG or PNG.`);
    if (file.size > MAX_FILE) fail(token, `${file.name} exceeds the 5 MB limit.`);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${app.id}/${Date.now()}_${safe}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (upErr) fail(token, `Upload failed: ${upErr.message}`);
    documents.push({ type: file.type, path, name: file.name, size: file.size });
  }

  // Create student
  const { data: studentRow, error: sErr } = await admin
    .from("students")
    .insert({
      parent_id: app.parent_id,
      full_name: input.student_name,
      dob: input.dob,
      gender: input.gender ?? null,
      previous_school: input.previous_school ?? null,
    })
    .select("*")
    .single();
  if (sErr) fail(token, sErr.message);

  // Update application -> FORM_SUBMITTED
  const { error: aErr } = await admin
    .from("applications")
    .update({
      student_id: studentRow.id,
      category: detect.category,
      grade_applying: grade,
      documents,
      consent_accepted: true,
      consent_at: new Date().toISOString(),
      status: "FORM_SUBMITTED",
    })
    .eq("id", app.id)
    .eq("status", "LEAD_CREATED");
  if (aErr) fail(token, aErr.message);

  await logAudit({
    action: "application.form_submitted",
    entity: "application",
    entityId: app.id,
    details: { category: detect.category, grade, age: detect.ageYears },
  });

  await handleFormSubmitted(app.id);
  redirect(`/apply/${token}`);
}

export async function bookSlot(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const slotId = String(formData.get("slot_id") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  if (app.category !== "GRADE" || app.status !== "FORM_SUBMITTED") {
    redirect(`/apply/${token}`);
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("book_assessment_slot", {
    p_slot: slotId,
    p_application: app.id,
  });
  if (error) {
    fail(token, "That slot was just taken. Please choose another.");
  }
  const slot = data as { starts_at: string };
  await logAudit({
    action: "assessment.slot_booked",
    entity: "application",
    entityId: app.id,
    details: { slot_id: slotId },
  });
  await handleSlotBooked(app.id, slot);
  redirect(`/apply/${token}`);
}

// Dev/mock payment completion — only when Razorpay keys are not configured.
// In production the webhook (signature-verified) is the source of truth.
export async function mockCompletePayment(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (config.razorpay.enabled) fail(token, "Use the Razorpay checkout to pay.");

  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;

  const { orderId } = await ensureOrderForApplication(app as Application);
  await markPaymentCompleted({
    orderId,
    paymentId: `pay_mock_${Date.now()}`,
    signature: "mock",
  });
  redirect(`/apply/${token}`);
}

// Re-publish slots to waiting grade applicants (used by teacher action too).
export async function republishSlots() {
  await notifySlotsPublished();
}
