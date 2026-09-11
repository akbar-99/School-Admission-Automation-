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
  notifyDuplicateDetailsBlocked,
  notifySlotReleased,
  sendAgreement,
} from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { config } from "@/lib/config";
import type { Application, DocumentRef } from "@/lib/types";

const MAX_FILE = 5 * 1024 * 1024; // 5 MB (SRS FR-4a)
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

// Stage 1 — the minimal form (LEAD_CREATED -> FORM_SUBMITTED): just enough
// to identify the applicant and their class, so an assessment can be
// scheduled (or, for KG 1, the remaining-details form unlocked) without
// asking for the full paperwork up front.
const MinimalFormSchema = z.object({
  student_name: z.string().trim().min(2, "Student's name is required"),
  grade: z.string().trim().min(1, "Class applying for is required"),
  age: z.coerce.number().int().min(1, "Age is required").max(25, "Enter a valid age"),
  email: z.string().trim().email("A valid email address is required"),
  whatsapp: z.string().trim().min(7, "WhatsApp number is required"),
});

// Stage 2 — the remaining-details form (DETAILS_PENDING -> AGREEMENT_SENT):
// everything else. Grade/student name/email/WhatsApp were already captured
// in stage 1 and aren't re-asked here.
const RemainingDetailsSchema = z.object({
  dob: z.string().min(1, "Date of birth is required"),
  gender: z.enum(["male", "female", "other"], { message: "Gender is required" }),
  curriculum: z.string().trim().min(1, "Preferred curriculum is required"),
  country: z.string().trim().min(1, "Country of residence is required"),
  current_address: z.string().trim().min(1, "Current address is required"),
  permanent_address: z.string().trim().min(1, "Permanent address is required"),
  previous_school: z.string().trim().min(1).optional(),
  father_name: z.string().trim().min(1, "Father's name is required"),
  father_phone: z.string().trim().min(7, "Father's contact number is required"),
  mother_name: z.string().trim().min(1, "Mother's name is required"),
  mother_phone: z.string().trim().min(7, "Mother's contact number is required"),
  preferred_class_timing: z.string().trim().max(200).optional(),
  pen_number: z.string().trim().max(50).optional(),
});

function fail(token: string, message: string): never {
  redirect(`/apply/${token}?error=${encodeURIComponent(message)}`);
}

function normalizeAddress(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
// Escapes Postgres LIKE/ILIKE wildcards so a value matches literally
// (case-insensitively) instead of as a pattern.
function escapeLikeExact(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// Catches a duplicate that slipped past the marketing-side lead check (e.g.
// two different-sounding names, or a lead created without going through
// marketing) by cross-checking address at the point real address data first
// exists. Deliberately requires address PLUS a name or DOB match — address
// alone is not enough, since siblings legitimately share a home address
// under different names. Filters at the DB by address match first (usually
// 0-1 rows) instead of scanning every application on every form submission.
async function findAddressDuplicate(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  excludeAppId: string,
  input: { currentAddress: string; permanentAddress: string; studentName: string; dob: string },
): Promise<{ parentName: string; studentName: string; status: string } | null> {
  const addrValues = [
    ...new Set(
      [normalizeAddress(input.currentAddress), normalizeAddress(input.permanentAddress)].filter((a) => a.length > 0),
    ),
  ];
  if (addrValues.length === 0) return null;
  const nameKey = normalizeName(input.studentName);

  const COLUMNS = "id, full_name, dob, current_address, permanent_address, parents(full_name), applications(id, status)";
  type StudentRow = {
    id: string;
    full_name: string;
    dob: string;
    current_address: string;
    permanent_address: string;
    parents: { full_name: string } | null;
    applications: { id: string; status: string }[] | null;
  };
  // .ilike() (unlike .or()) passes the value as a plain parameter, so an
  // address containing a comma or parenthesis can't break query parsing —
  // that's why this is 4 targeted queries instead of one .or() string.
  const results = await Promise.all(
    addrValues.flatMap((a) => [
      admin.from("students").select(COLUMNS).ilike("current_address", escapeLikeExact(a)),
      admin.from("students").select(COLUMNS).ilike("permanent_address", escapeLikeExact(a)),
    ]),
  );
  const byId = new Map<string, StudentRow>();
  for (const { data } of results) {
    for (const row of (data ?? []) as unknown as StudentRow[]) {
      byId.set(row.id, row);
    }
  }

  for (const st of byId.values()) {
    const p = st.parents;
    // The query already filtered to address matches — an application on the
    // matched student, other than the one being submitted, is what's left to check.
    const app = (st.applications ?? []).find((a) => a.id !== excludeAppId);
    if (!p || !app) continue;
    const nameMatches = nameKey.length > 0 && normalizeName(st.full_name) === nameKey;
    const dobMatches = Boolean(input.dob) && st.dob === input.dob;
    if (nameMatches || dobMatches) {
      return { parentName: p.full_name, studentName: st.full_name, status: app.status };
    }
  }
  return null;
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

// Stage 1: LEAD_CREATED -> FORM_SUBMITTED. Just the minimal fields — no
// documents, no parent details, no DOB. handleFormSubmitted takes it from
// here: schedules an assessment for grades that need one, or (KG 1) unlocks
// the remaining-details form immediately.
export async function submitMinimalForm(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  if (app.status !== "LEAD_CREATED") {
    redirect(`/apply/${token}`);
  }

  const parsed = MinimalFormSchema.safeParse({
    student_name: formData.get("student_name"),
    grade: formData.get("grade"),
    age: formData.get("age"),
    email: formData.get("email"),
    whatsapp: formData.get("whatsapp"),
  });
  if (!parsed.success) fail(token, parsed.error.issues[0].message);
  const input = parsed.data;

  // Category (KG/GRADE) is a name-based label; whether an assessment is
  // required is a separate rule — only "KG 1" is exempt, so e.g. "KG 2" is
  // labeled "KG" but still requires an assessment. Neither is age-based.
  const grade = input.grade;
  const category = classCategory(grade);

  const admin = createSupabaseAdminClient();

  // Primary contact going forward = the email + WhatsApp the parent entered.
  await admin
    .from("parents")
    .update({ email: input.email, phone: input.whatsapp })
    .eq("id", app.parent_id);

  const { error: aErr } = await admin
    .from("applications")
    .update({
      lead_student_name: input.student_name,
      reported_age: input.age,
      category,
      grade_applying: grade,
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

  await handleFormSubmitted(app.id);
  redirect(`/apply/${token}`);
}

// Lets the parent correct their own stage-1 details (name, age, email,
// WhatsApp — and class, only before an assessment is in motion) at any later
// step, instead of leaving a typo locked in for the rest of the flow. Name/
// age/email/WhatsApp are safe to change any time since nothing downstream
// depends on their exact value except which contact the parent is reached
// at. Class is different: it's what decides whether an assessment happens
// at all, so once the applicant has moved past FORM_SUBMITTED (a slot may
// already be booked or completed, or the remaining-details form already
// unlocked on the strength of the original class), it's locked to avoid an
// inconsistent state — e.g. switching into KG 1 after already sitting a
// Grade assessment.
const UpdateMinimalDetailsSchema = z.object({
  student_name: z.string().trim().min(2, "Student's name is required"),
  grade: z.string().trim().min(1).optional(),
  age: z.coerce.number().int().min(1, "Age is required").max(25, "Enter a valid age"),
  email: z.string().trim().email("A valid email address is required"),
  whatsapp: z.string().trim().min(7, "WhatsApp number is required"),
});

export async function updateMinimalDetails(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  if (app.status === "LEAD_CREATED") redirect(`/apply/${token}`);

  const gradeEditable = app.status === "FORM_SUBMITTED";
  const parsed = UpdateMinimalDetailsSchema.safeParse({
    student_name: formData.get("student_name"),
    grade: gradeEditable ? formData.get("grade") || undefined : undefined,
    age: formData.get("age"),
    email: formData.get("email"),
    whatsapp: formData.get("whatsapp"),
  });
  if (!parsed.success) fail(token, parsed.error.issues[0].message);
  const input = parsed.data;

  const admin = createSupabaseAdminClient();
  await admin
    .from("parents")
    .update({ email: input.email, phone: input.whatsapp })
    .eq("id", app.parent_id);

  const updates: Record<string, unknown> = {
    lead_student_name: input.student_name,
    reported_age: input.age,
  };
  const gradeChanged = gradeEditable && input.grade && input.grade !== app.grade_applying;
  if (gradeChanged) {
    updates.grade_applying = input.grade;
    updates.category = classCategory(input.grade!);
  }

  const { error } = await admin.from("applications").update(updates).eq("id", app.id);
  if (error) fail(token, error.message);

  await logAudit({
    action: "application.minimal_details_updated",
    entity: "application",
    entityId: app.id,
    details: updates,
  });

  // The class changed while still awaiting assessment scheduling — re-run
  // the same KG/Grade branch handleFormSubmitted already does, so switching
  // into (or out of) KG 1 correctly re-routes to DETAILS_PENDING or to
  // "awaiting assessment" rather than leaving it stuck on the old path.
  if (gradeChanged) {
    await handleFormSubmitted(app.id);
  }

  redirect(`/apply/${token}`);
}

// Stage 2: DETAILS_PENDING -> AGREEMENT_SENT. Everything the minimal form
// didn't ask for — DOB, gender, curriculum, addresses, documents, parent
// details — then sends the agreement, same as the old single-step flow used
// to do right after creating the student record.
export async function submitRemainingDetails(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  const parent = bundle.parent;
  if (app.status !== "DETAILS_PENDING") {
    redirect(`/apply/${token}`);
  }

  if (formData.get("consent") !== "on") {
    fail(token, "You must accept the data-processing consent to continue.");
  }

  const parsed = RemainingDetailsSchema.safeParse({
    dob: formData.get("dob"),
    gender: formData.get("gender") || undefined,
    curriculum: formData.get("curriculum"),
    country: formData.get("country"),
    current_address: formData.get("current_address"),
    permanent_address: formData.get("permanent_address"),
    previous_school: formData.get("previous_school") || undefined,
    father_name: formData.get("father_name"),
    father_phone: formData.get("father_phone"),
    mother_name: formData.get("mother_name"),
    mother_phone: formData.get("mother_phone"),
    preferred_class_timing: formData.get("preferred_class_timing") || undefined,
    pen_number: formData.get("pen_number") || undefined,
  });
  if (!parsed.success) fail(token, parsed.error.issues[0].message);
  const input = parsed.data;

  const admin = createSupabaseAdminClient();

  const dup = await findAddressDuplicate(admin, app.id, {
    currentAddress: input.current_address,
    permanentAddress: input.permanent_address,
    studentName: app.lead_student_name ?? "",
    dob: input.dob,
  });
  if (dup) {
    await logAudit({
      action: "application.details_blocked_duplicate",
      entity: "application",
      entityId: app.id,
      details: dup,
    });
    await notifyDuplicateDetailsBlocked(app, dup);
    fail(
      token,
      `It looks like ${dup.studentName} already has an admission application in progress at this address. Please contact the school admissions office to continue with the existing application instead of submitting a new one.`,
    );
  }

  // Documents stored in typed slots (private Supabase Storage). Passport/
  // Aadhaar, birth certificate and photo are all always required.
  const documents: DocumentRef[] = [];

  documents.push(
    await uploadDocument(admin, token, app.id, "passport", "Passport/Aadhaar", formData.get("passport")),
  );
  documents.push(
    await uploadDocument(admin, token, app.id, "birth_certificate", "Birth certificate", formData.get("birth_certificate")),
  );
  documents.push(
    await uploadDocument(admin, token, app.id, "photo", "Photo", formData.get("photo")),
  );

  // Create student — the name was already captured on the minimal form.
  const { data: studentRow, error: sErr } = await admin
    .from("students")
    .insert({
      parent_id: app.parent_id,
      full_name: app.lead_student_name ?? "",
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
      pen_number: input.pen_number || null,
    })
    .select("*")
    .single();
  if (sErr) fail(token, sErr.message);

  const { error: aErr } = await admin
    .from("applications")
    .update({
      student_id: studentRow.id,
      documents,
      consent_accepted: true,
      consent_at: new Date().toISOString(),
      preferred_class_timing: input.preferred_class_timing || null,
      status: "AGREEMENT_SENT",
    })
    .eq("id", app.id)
    .eq("status", "DETAILS_PENDING");
  if (aErr) fail(token, aErr.message);

  await logAudit({
    action: "application.details_submitted",
    entity: "application",
    entityId: app.id,
    details: { student_id: studentRow.id, preferred_class_timing: input.preferred_class_timing || null },
  });

  const { data: fresh } = await admin.from("applications").select("*").eq("id", app.id).single();
  await sendAgreement(fresh as Application, parent);

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

// Releases the parent's currently-booked slot and sends the application
// back to FORM_SUBMITTED so the slot picker shows again. A real button
// click (not a bare link) since this is consequential — it frees the slot
// for someone else to book.
export async function releaseSlot(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const { bundle } = await loadApplicationByToken(token);
  if (!bundle) fail(token, "This admission link is invalid or expired.");
  const app = bundle.application;
  if (app.status !== "ASSESSMENT_SCHEDULED") {
    redirect(`/apply/${token}`);
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("release_assessment_slot", { p_application: app.id });
  if (error) {
    fail(token, "Could not release your slot — please try again.");
  }
  const result = data as { status: string; slot_id?: string; teacher_id?: string | null; starts_at?: string };
  if (result.status === "TOO_LATE") {
    fail(token, "This slot has already started — please contact the school to reschedule.");
  }
  if (result.status !== "RELEASED") {
    redirect(`/apply/${token}`);
  }

  await logAudit({
    action: "assessment.slot_released",
    entity: "application",
    entityId: app.id,
    details: { slot_id: result.slot_id },
  });
  await notifySlotReleased(app.id, { starts_at: result.starts_at!, teacher_id: result.teacher_id });
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
