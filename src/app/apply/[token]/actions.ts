"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { loadApplicationByToken } from "@/lib/parent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { classCategory, needsAssessment } from "@/lib/assessment";
import { ensureOrderForApplication, markPaymentCompleted } from "@/lib/payments";
import {
  handleFormSubmitted,
  handleSlotBooked,
  notifySlotsPublished,
} from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import type { Application, DocumentRef } from "@/lib/types";

const MAX_FILE = 5 * 1024 * 1024; // 5 MB (SRS FR-4a)
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

const FormSchema = z.object({
  student_name: z.string().trim().min(2, "Student full name is required"),
  dob: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female", "other"], { message: "Gender is required" }),
  grade: z.string().trim().min(1, "Class applying for is required"),
  curriculum: z.string().trim().min(1, "Preferred curriculum is required"),
  country: z.string().trim().min(1, "Country of residence is required"),
  current_address: z.string().trim().min(1, "Current address is required"),
  permanent_address: z.string().trim().min(1, "Permanent address is required"),
  previous_school: z.string().trim().min(1).optional(),
  father_name: z.string().trim().min(1, "Father's full name is required"),
  father_phone: z.string().trim().min(7, "Father's contact number is required"),
  mother_name: z.string().trim().min(1, "Mother's full name is required"),
  mother_phone: z.string().trim().min(7, "Mother's contact number is required"),
  whatsapp: z.string().trim().min(7, "WhatsApp number is required"),
  email: z.string().trim().email("A valid email address is required"),
});

function fail(token: string, message: string): never {
  redirect(`/apply/${token}?error=${encodeURIComponent(message)}`);
}

// Validate + upload a single required document into a typed slot.
async function uploadDocument(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  token: string,
  appId: string,
  category: string,
  label: string,
  value: FormDataEntryValue | null,
): Promise<DocumentRef> {
  if (!(value instanceof File) || value.size === 0) {
    fail(token, `${label} is required.`);
  }
  const file = value;
  if (!ALLOWED.has(file.type)) fail(token, `${label}: unsupported file type. Use PDF, JPG or PNG.`);
  if (file.size > MAX_FILE) fail(token, `${label} exceeds the 5 MB limit.`);
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${appId}/${category}_${Date.now()}_${safe}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await admin.storage
    .from("documents")
    .upload(path, buffer, { contentType: file.type, upsert: false });
  if (upErr) fail(token, `${label} upload failed: ${upErr.message}`);
  return { category, type: file.type, path, name: file.name, size: file.size };
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
    grade: formData.get("grade"),
    curriculum: formData.get("curriculum"),
    country: formData.get("country"),
    current_address: formData.get("current_address"),
    permanent_address: formData.get("permanent_address"),
    previous_school: formData.get("previous_school") || undefined,
    father_name: formData.get("father_name"),
    father_phone: formData.get("father_phone"),
    mother_name: formData.get("mother_name"),
    mother_phone: formData.get("mother_phone"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
  });
  if (!parsed.success) fail(token, parsed.error.issues[0].message);
  const input = parsed.data;

  // Category (KG/GRADE) is a name-based label; whether an assessment is
  // required is a separate rule — only "KG 1" is exempt, so e.g. "KG 2" is
  // labeled "KG" but still requires an assessment. Neither is age-based.
  const grade = input.grade;
  const category = classCategory(grade);
  const assessmentRequired = needsAssessment(grade);

  // Grade applicants may pick an open slot now for instant confirmation; if
  // none is picked (or none are open yet), an admin schedules it afterward.
  const slotId = String(formData.get("slot_id") ?? "");

  const admin = createSupabaseAdminClient();

  // Documents stored in typed slots (private Supabase Storage). Passport is
  // required only for applicants residing outside India; birth certificate
  // is always required.
  const documents: DocumentRef[] = [];

  const passportFile = formData.get("passport");
  const hasPassport = passportFile instanceof File && passportFile.size > 0;
  const passportRequired = input.country.trim().toLowerCase() !== "india";
  if (passportRequired && !hasPassport) {
    fail(token, "Passport copy is required for applicants residing outside India.");
  }
  if (hasPassport) {
    documents.push(await uploadDocument(admin, token, app.id, "passport", "Passport copy", passportFile));
  }

  documents.push(
    await uploadDocument(admin, token, app.id, "birth_certificate", "Birth certificate", formData.get("birth_certificate")),
  );

  // Primary contact going forward = the email + WhatsApp the parent entered.
  await admin
    .from("parents")
    .update({ email: input.email, phone: input.whatsapp })
    .eq("id", app.parent_id);

  // Create student
  const { data: studentRow, error: sErr } = await admin
    .from("students")
    .insert({
      parent_id: app.parent_id,
      full_name: input.student_name,
      dob: input.dob,
      gender: input.gender,
      previous_school: input.previous_school ?? null,
      curriculum: input.curriculum,
      country_of_residence: input.country,
      current_address: input.current_address,
      permanent_address: input.permanent_address,
      father_name: input.father_name,
      father_phone: input.father_phone,
      mother_name: input.mother_name,
      mother_phone: input.mother_phone,
    })
    .select("*")
    .single();
  if (sErr) fail(token, sErr.message);

  // Update application -> FORM_SUBMITTED
  const { error: aErr } = await admin
    .from("applications")
    .update({
      student_id: studentRow.id,
      category,
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
    details: { category, grade },
  });

  // If the parent picked an open slot on the form, book it now (only for
  // classes that require an assessment): the slot is confirmed instantly and
  // the parent, teacher and admin are all notified — no separate "please
  // schedule" step. Falls back to the normal flow if the slot was just taken
  // by someone else.
  if (assessmentRequired && slotId) {
    const { data: slot, error: bookErr } = await admin.rpc("book_assessment_slot", {
      p_slot: slotId,
      p_application: app.id,
    });
    if (!bookErr && slot) {
      await logAudit({
        action: "assessment.slot_booked",
        entity: "application",
        entityId: app.id,
        details: { slot_id: slotId, via: "form" },
      });
      await handleSlotBooked(app.id, slot as { starts_at: string; teacher_id: string });
      redirect(`/apply/${token}`);
    }
    // Slot just taken — notify normally so the parent can pick another below.
    await handleFormSubmitted(app.id);
    fail(token, "That slot was just taken — please pick another available slot below.");
  }

  await handleFormSubmitted(app.id);
  redirect(`/apply/${token}`);
}

// Digitally accept (e-sign) the admission agreement before payment. Records the
// typed signature, timestamp and originating IP for an auditable record.
const AGREEMENT_STAGES = new Set([
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
]);

export async function acceptAgreement(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const signature = String(formData.get("signature") ?? "").trim();
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;

  if (!AGREEMENT_STAGES.has(app.status)) redirect(`/apply/${token}`);
  if (app.agreement_accepted) redirect(`/apply/${token}`);
  if (formData.get("agree") !== "on") {
    fail(token, "Please tick the box to accept the admission agreement.");
  }
  if (signature.length < 2) {
    fail(token, "Please type the parent/guardian name to sign the agreement.");
  }

  // Signature must match the parent/guardian on record (case/space-insensitive).
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const parentName = bundle.parent?.full_name ?? "";
  if (norm(signature) !== norm(parentName)) {
    fail(token, `The signature must match the parent/guardian name on record: ${parentName}.`);
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const admin = createSupabaseAdminClient();
  await admin
    .from("applications")
    .update({
      agreement_accepted: true,
      agreement_accepted_at: new Date().toISOString(),
      agreement_signature: signature,
      agreement_ip: ip,
    })
    .eq("id", app.id);

  await logAudit({
    action: "agreement.accepted",
    entity: "application",
    entityId: app.id,
    details: { signature, ip },
  });

  redirect(`/apply/${token}`);
}

export async function bookSlot(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const slotId = String(formData.get("slot_id") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  if (!needsAssessment(app.grade_applying ?? "") || app.status !== "FORM_SUBMITTED") {
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
  const slot = data as { starts_at: string; teacher_id: string };
  await logAudit({
    action: "assessment.slot_booked",
    entity: "application",
    entityId: app.id,
    details: { slot_id: slotId },
  });
  await handleSlotBooked(app.id, slot);
  redirect(`/apply/${token}`);
}

// Dev/mock payment completion — only outside production, and only when
// Razorpay keys are not configured. In production the webhook
// (signature-verified) is the only way a payment is ever marked completed.
export async function mockCompletePayment(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  if (process.env.NODE_ENV === "production") fail(token, "Use the Razorpay checkout to pay.");
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
