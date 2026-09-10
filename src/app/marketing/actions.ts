"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyLeadCreated } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import { LEAD_SOURCES, type Application, type Parent } from "@/lib/types";

const LeadSchema = z.object({
  parent_name: z.string().trim().min(2, "Parent name is required"),
  phone: z.string().trim().min(7, "A valid phone number is required"),
  email: z.string().trim().email("A valid email is required").or(z.literal("")),
  student_name: z.string().trim().optional(),
  lead_source: z.enum(LEAD_SOURCES, { error: "Select where this lead came from" }),
});

// Last-10-digits comparison so "+91 98765 43210", "098765 43210" and
// "9876543210" are all recognized as the same number.
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

interface DuplicateMatch {
  id: string;
  status: string;
  createdAt: string;
  parentName: string;
  phone: string | null;
  studentName: string | null;
  grade: string | null;
  matchedOn: "contact" | "student_name";
}

// Catches both the "same staff re-entered the same enquiry" case (matched by
// phone/email) and the "father called marketing with his number, mother
// called separately later for the same child with hers" case (matched by
// student name alone, even though the contact details are entirely
// different). Never used to silently block — callers surface these as a
// warning the staff member can override, since two different children can
// legitimately share a common name.
async function findDuplicateLeads(input: {
  phone: string;
  email: string;
  studentName: string;
}): Promise<DuplicateMatch[]> {
  const admin = createSupabaseAdminClient();
  const phoneKey = normalizePhone(input.phone);
  const emailKey = input.email.trim().toLowerCase();
  const nameKey = input.studentName.trim().toLowerCase().replace(/\s+/g, " ");

  const matches = new Map<string, DuplicateMatch>();

  const { data: appsByContact } = await admin
    .from("applications")
    .select("id, status, created_at, lead_student_name, grade_applying, parents(full_name, phone, email)");
  for (const row of appsByContact ?? []) {
    const p = row.parents as unknown as { full_name: string; phone: string | null; email: string | null } | null;
    if (!p) continue;
    const contactMatch =
      (phoneKey.length === 10 && p.phone && normalizePhone(p.phone) === phoneKey) ||
      (emailKey.length > 0 && p.email && p.email.trim().toLowerCase() === emailKey);
    const nameMatch =
      nameKey.length > 0 &&
      (row.lead_student_name ?? "").trim().toLowerCase().replace(/\s+/g, " ") === nameKey;
    if (!contactMatch && !nameMatch) continue;
    matches.set(row.id, {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      parentName: p.full_name,
      phone: p.phone,
      studentName: row.lead_student_name,
      grade: row.grade_applying,
      matchedOn: contactMatch ? "contact" : "student_name",
    });
  }

  return [...matches.values()];
}

export async function createLead(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin"]);

  const parsed = LeadSchema.safeParse({
    parent_name: formData.get("parent_name"),
    phone: formData.get("phone"),
    email: formData.get("email") ?? "",
    student_name: formData.get("student_name") ?? "",
    lead_source: formData.get("lead_source") ?? "",
  });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const input = parsed.data;

  const confirmedDuplicate = formData.get("confirm_duplicate") === "on";
  if (!confirmedDuplicate) {
    const dupes = await findDuplicateLeads({
      phone: input.phone,
      email: input.email,
      studentName: input.student_name ?? "",
    });
    if (dupes.length > 0) {
      const payload = encodeURIComponent(JSON.stringify({ input, matches: dupes }));
      redirect("/marketing?duplicate=" + payload);
    }
  }

  const admin = createSupabaseAdminClient();

  const { data: parentRow, error: pErr } = await admin
    .from("parents")
    .insert({
      full_name: input.parent_name,
      phone: input.phone,
      email: input.email || null,
    })
    .select("*")
    .single();
  if (pErr) {
    redirect("/marketing?error=" + encodeURIComponent(pErr.message));
  }
  const parent = parentRow as Parent;

  const { data: appRow, error: aErr } = await admin
    .from("applications")
    .insert({
      parent_id: parent.id,
      status: "LEAD_CREATED",
      lead_student_name: input.student_name || null,
      lead_source: input.lead_source,
      created_by: profile.id,
    })
    .select("*")
    .single();
  if (aErr) {
    redirect("/marketing?error=" + encodeURIComponent(aErr.message));
  }
  const app = appRow as Application;

  await notifyLeadCreated(app, parent);
  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "lead.created",
    entity: "application",
    entityId: app.id,
    details: { parent_id: parent.id },
  });

  revalidatePath("/marketing");
  redirect("/marketing?created=" + app.access_token);
}
