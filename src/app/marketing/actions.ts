"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyLeadCreated } from "@/lib/workflow";
import { logAudit } from "@/lib/audit";
import type { Application, Parent } from "@/lib/types";

const LeadSchema = z.object({
  parent_name: z.string().trim().min(2, "Parent name is required"),
  phone: z.string().trim().min(7, "A valid phone number is required"),
  email: z.string().trim().email("A valid email is required").or(z.literal("")),
  student_name: z.string().trim().optional(),
});

export async function createLead(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin"]);

  const parsed = LeadSchema.safeParse({
    parent_name: formData.get("parent_name"),
    phone: formData.get("phone"),
    email: formData.get("email") ?? "",
    student_name: formData.get("student_name") ?? "",
  });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const input = parsed.data;
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
