"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notifyLeadCreated, notifyLeadClaimed, removeEnrollmentFromGoogleSheet } from "@/lib/workflow";
import { sendInstagramMessage } from "@/lib/instagram";
import { sendFacebookMessage } from "@/lib/facebook";
import { cancelBroadwayAdmission } from "@/lib/broadway";
import { logAudit } from "@/lib/audit";
import { LEAD_SOURCES, type Application, type Parent } from "@/lib/types";

// The two DM channels this app can chat through — keyed by lead_source, so
// the one conversation page/action serves either without duplicating the UI.
const SOCIAL_MESSAGES_TABLE = {
  instagram: "instagram_messages",
  facebook: "facebook_messages",
} as const;
type SocialLeadSource = keyof typeof SOCIAL_MESSAGES_TABLE;

const LeadSchema = z
  .object({
    parent_name: z.string().trim().min(2, "Parent name is required"),
    phone: z.string().trim().min(7, "A valid phone number is required"),
    email: z.string().trim().email("A valid email is required").or(z.literal("")),
    student_name: z.string().trim().optional(),
    lead_source: z.enum(LEAD_SOURCES, { error: "Select where this lead came from" }),
    lead_source_other: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.lead_source !== "other" || Boolean(v.lead_source_other), {
    message: "Type what the source is",
    path: ["lead_source_other"],
  });

// Last-10-digits comparison so "+91 98765 43210", "098765 43210" and
// "9876543210" are all recognized as the same number.
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

// Escapes Postgres LIKE/ILIKE wildcards so a value is matched literally
// (case-insensitively) instead of as a pattern — needed because emails and
// names routinely contain "_", which ILIKE otherwise treats as "any char".
function escapeLikeExact(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
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

  const APP_COLUMNS =
    "id, status, created_at, lead_student_name, grade_applying, parents(full_name, phone, email)";
  type AppRow = {
    id: string;
    status: string;
    created_at: string;
    lead_student_name: string | null;
    grade_applying: string | null;
    parents: { full_name: string; phone: string | null; email: string | null } | null;
  };

  const matches = new Map<string, DuplicateMatch>();
  const addRows = (rows: AppRow[] | null | undefined, matchedOn: DuplicateMatch["matchedOn"]) => {
    for (const row of rows ?? []) {
      if (matches.has(row.id)) continue;
      const p = row.parents;
      if (!p) continue;
      matches.set(row.id, {
        id: row.id,
        status: row.status,
        createdAt: row.created_at,
        parentName: p.full_name,
        phone: p.phone,
        studentName: row.lead_student_name,
        grade: row.grade_applying,
        matchedOn,
      });
    }
  };

  // Contact match: filter to the (usually 0-1) parents sharing this phone or
  // email, then fetch only their applications — instead of scanning the
  // whole applications table on every lead submission.
  if (phoneKey.length === 10 || emailKey.length > 0) {
    const orParts: string[] = [];
    if (phoneKey.length === 10) orParts.push(`phone.ilike.%${phoneKey}`);
    if (emailKey.length > 0) orParts.push(`email.ilike.${escapeLikeExact(emailKey)}`);
    const { data: parentRows } = await admin.from("parents").select("id").or(orParts.join(","));
    const parentIds = (parentRows ?? []).map((p) => p.id);
    if (parentIds.length > 0) {
      const { data: appsByContact } = await admin
        .from("applications")
        .select(APP_COLUMNS)
        .in("parent_id", parentIds);
      addRows(appsByContact as unknown as AppRow[], "contact");
    }
  }

  // Student-name match: same child, entirely different parent contact (e.g.
  // father and mother enquiring separately) — filtered at the DB by an exact
  // (case-insensitive) name match rather than scanning every application.
  if (nameKey.length > 0) {
    const { data: appsByName } = await admin
      .from("applications")
      .select(APP_COLUMNS)
      .ilike("lead_student_name", escapeLikeExact(nameKey));
    addRows(appsByName as unknown as AppRow[], "student_name");
  }

  return [...matches.values()];
}

export async function createLead(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);

  const parsed = LeadSchema.safeParse({
    parent_name: formData.get("parent_name"),
    phone: formData.get("phone"),
    email: formData.get("email") ?? "",
    student_name: formData.get("student_name") ?? "",
    lead_source: formData.get("lead_source") ?? "",
    lead_source_other: formData.get("lead_source_other") ?? "",
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
      lead_source_other: input.lead_source === "other" ? input.lead_source_other : null,
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

const ClaimLeadSchema = z.object({ application_id: z.string().uuid() });

// Atomically claim an unclaimed inbound lead (Instagram DM, etc.) — first to
// submit wins. Mirrors claimAssessmentSlot (src/app/teacher/actions.ts) and
// its claim_assessment_slot RPC exactly, applied to leads instead of slots.
// Does NOT send the N-1 admission link — an inbound-captured lead has no
// phone/email yet; that only happens once addContactInfo below is used.
export async function claimLead(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const parsed = ClaimLeadSchema.safeParse({ application_id: formData.get("application_id") });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent("Invalid enquiry."));
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("claim_lead", {
    p_application: parsed.data!.application_id,
    p_user: profile.id,
  });
  if (error) {
    redirect("/marketing?error=" + encodeURIComponent("That enquiry was just claimed by someone else."));
  }
  const claimed = data as { id: string; parent_id: string };

  const { data: parentRow } = await admin.from("parents").select("*").eq("id", claimed.parent_id).maybeSingle();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", claimed.id).maybeSingle();
  if (parentRow && appRow) {
    await notifyLeadClaimed(profile.id, appRow as Application, parentRow as Parent);
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "lead.claimed",
    entity: "application",
    entityId: claimed.id,
  });

  revalidatePath("/marketing");
  redirect("/marketing?claimed=1");
}

const AddContactInfoSchema = z.object({
  application_id: z.string().uuid(),
  phone: z.string().trim().min(7, "A valid phone number is required"),
  email: z.string().trim().email("A valid email is required").or(z.literal("")),
});

// Fills in a claimed-but-contactless lead's phone/email (an Instagram DM
// enquiry has neither until a rep gets them mid-conversation), then sends
// the N-1 admission link now that this app can actually reach the family.
export async function addContactInfo(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const parsed = AddContactInfoSchema.safeParse({
    application_id: formData.get("application_id"),
    phone: formData.get("phone"),
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const input = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: app } = await admin
    .from("applications")
    .select("*")
    .eq("id", input.application_id)
    .eq("created_by", profile.id)
    .maybeSingle();
  if (!app) {
    redirect("/marketing?error=" + encodeURIComponent("Enquiry not found."));
  }

  const { data: parent, error: pErr } = await admin
    .from("parents")
    .update({ phone: input.phone, email: input.email || null })
    .eq("id", app!.parent_id)
    .select("*")
    .single();
  if (pErr || !parent) {
    redirect("/marketing?error=" + encodeURIComponent(pErr?.message ?? "Could not save contact info."));
  }

  await notifyLeadCreated(app as Application, parent as Parent);
  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "lead.contact_info_added",
    entity: "application",
    entityId: app!.id,
  });

  revalidatePath("/marketing");
  redirect("/marketing?created=" + app!.access_token);
}

const SendInstagramReplySchema = z.object({
  application_id: z.string().uuid(),
  message: z.string().trim().min(1, "Message can't be empty"),
});

// Sends a real DM reply from inside the app — Instagram or Facebook Page
// Messenger, whichever this lead came from. Both enforce a messaging window
// from the person's last message; a send outside that window fails with a
// clear error surfaced back to the rep as-is rather than silently swallowed.
export async function sendSocialReply(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const parsed = SendInstagramReplySchema.safeParse({
    application_id: formData.get("application_id"),
    message: formData.get("message"),
  });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const input = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: app } = await admin
    .from("applications")
    .select("id, created_by, external_contact_id, lead_source")
    .eq("id", input.application_id)
    .maybeSingle();
  if (!app || (profile.role === "marketing" && app.created_by !== profile.id)) {
    redirect("/marketing?error=" + encodeURIComponent("Enquiry not found."));
  }
  if (!app!.external_contact_id) {
    redirect(`/marketing/leads/${input.application_id}?error=` + encodeURIComponent("Not a social DM enquiry."));
  }
  const messagesTable = SOCIAL_MESSAGES_TABLE[app!.lead_source as SocialLeadSource];
  if (!messagesTable) {
    redirect(`/marketing/leads/${input.application_id}?error=` + encodeURIComponent("Not a social DM enquiry."));
  }

  const result =
    app!.lead_source === "facebook"
      ? await sendFacebookMessage(app!.external_contact_id, input.message)
      : await sendInstagramMessage(app!.external_contact_id, input.message);
  if (!result.ok) {
    redirect(`/marketing/leads/${input.application_id}?error=` + encodeURIComponent(result.error));
  }

  // The echo of this same message can reach the webhook before this insert
  // lands — upsert on the message id so whichever arrives second attributes
  // it to this rep instead of losing the row to the unique index.
  const outbound = {
    application_id: input.application_id,
    direction: "outbound",
    message_text: input.message,
    provider_message_id: result.messageId || null,
    sent_by: profile.id,
  };
  if (outbound.provider_message_id) {
    await admin.from(messagesTable).upsert(outbound, { onConflict: "provider_message_id" });
  } else {
    await admin.from(messagesTable).insert(outbound);
  }
  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: `${app!.lead_source}.reply_sent`,
    entity: "application",
    entityId: input.application_id,
  });

  revalidatePath(`/marketing/leads/${input.application_id}`);
  redirect(`/marketing/leads/${input.application_id}`);
}

const MarkWithdrawnSchema = z.object({
  application_id: z.string().uuid(),
  reason: z.string().trim().min(3, "Give a short reason"),
});

// A family that paid and enrolled can still back out later — this records
// that without touching `status`, so the funnel keeps reflecting the real
// history (they DID complete payment/admission) instead of retroactively
// erasing it. pre_admission vs post_admission is derived from broadway_status
// right now, not asked of the rep, so it can't be misclassified.
export async function markWithdrawn(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const parsed = MarkWithdrawnSchema.safeParse({
    application_id: formData.get("application_id"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent(parsed.error.issues[0].message));
  }
  const input = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { data: app } = await admin
    .from("applications")
    .select("id, created_by, broadway_status, broadway_student_id, section_id, admission_number, grade_applying")
    .eq("id", input.application_id)
    .maybeSingle();
  if (!app || (profile.role === "marketing" && app.created_by !== profile.id)) {
    redirect("/marketing?error=" + encodeURIComponent("Enquiry not found."));
  }

  const withdrawalType = app!.broadway_status === "synced" ? "post_admission" : "pre_admission";
  const { error } = await admin
    .from("applications")
    .update({
      withdrawn_at: new Date().toISOString(),
      withdrawal_type: withdrawalType,
      withdrawal_reason: input.reason,
      withdrawn_by: profile.id,
    })
    .eq("id", app!.id);
  if (error) {
    redirect("/marketing?error=" + encodeURIComponent("Could not mark as withdrawn."));
  }

  // They no longer occupy the seat, aren't on the real class roster, and
  // shouldn't stay active in Broadway — section_id itself is deliberately
  // left in place as a historical record (see the roster query in
  // src/app/admin/sections/page.tsx, which excludes withdrawn applications
  // rather than relying on section_id being cleared). All three are
  // best-effort: the withdrawal itself is already recorded above regardless
  // of whether these side effects succeed.
  if (app!.section_id) {
    const { data: sec } = await admin.from("sections").select("filled").eq("id", app!.section_id).maybeSingle();
    if (sec) {
      await admin.from("sections").update({ filled: Math.max(0, sec.filled - 1) }).eq("id", app!.section_id);
    }
  }
  await removeEnrollmentFromGoogleSheet(app!.id, app!.admission_number, app!.section_id, app!.grade_applying);
  if (app!.broadway_student_id) {
    const result = await cancelBroadwayAdmission(app!.id, input.reason);
    if (!result.ok) {
      // A 409 (already joined) is expected, not a failure — only the
      // school can withdraw a joined student, directly in Broadway under
      // Student records. Logged distinctly so Admin → Broadway can
      // surface it as "needs manual withdrawal" rather than "sync failed".
      await logAudit({
        action: result.alreadyJoined ? "broadway.withdraw_needed" : "broadway.cancel_failed",
        entity: "application",
        entityId: app!.id,
        details: result.alreadyJoined ? { context: "withdrawal" } : { error: result.error, context: "withdrawal" },
      });
    } else {
      await admin.from("applications").update({ broadway_status: "cancelled" }).eq("id", app!.id);
    }
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "lead.withdrawn",
    entity: "application",
    entityId: app!.id,
    details: { withdrawal_type: withdrawalType, reason: input.reason },
  });

  revalidatePath("/marketing");
  revalidatePath("/admin/sections");
  redirect("/marketing?withdrawn=1");
}

const RestoreWithdrawnSchema = z.object({
  application_id: z.string().uuid(),
});

// Undoes a mistaken markWithdrawn — kept to admin/coo since it's a
// correction, not a normal day-to-day action for the rep who filed it.
export async function restoreWithdrawn(formData: FormData) {
  const { profile } = await requireRole(["admin", "coo"]);
  const parsed = RestoreWithdrawnSchema.safeParse({ application_id: formData.get("application_id") });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent("Invalid enquiry."));
  }

  const admin = createSupabaseAdminClient();
  const { data: app } = await admin
    .from("applications")
    .select("id, section_id")
    .eq("id", parsed.data!.application_id)
    .maybeSingle();
  if (!app) {
    redirect("/marketing?error=" + encodeURIComponent("Enquiry not found."));
  }

  const { error } = await admin
    .from("applications")
    .update({ withdrawn_at: null, withdrawal_type: null, withdrawal_reason: null, withdrawn_by: null })
    .eq("id", app!.id);
  if (error) {
    redirect("/marketing?error=" + encodeURIComponent("Could not restore this enquiry."));
  }

  // Give the seat back — the Google Sheets row and any Broadway
  // cancellation from markWithdrawn are NOT automatically redone here
  // (re-adding those safely needs the full resync flow, not a blind
  // reverse); use the existing Broadway retry action afterward if this
  // application had already gotten that far.
  if (app!.section_id) {
    const { data: sec } = await admin.from("sections").select("filled").eq("id", app!.section_id).maybeSingle();
    if (sec) await admin.from("sections").update({ filled: sec.filled + 1 }).eq("id", app!.section_id);
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "lead.withdrawal_restored",
    entity: "application",
    entityId: app!.id,
  });

  revalidatePath("/marketing");
  revalidatePath("/admin/sections");
  redirect("/marketing?restored=1");
}

const DismissLeadSchema = z.object({ application_id: z.string().uuid() });

// Takes an unclaimed enquiry out of the pool without deleting it — for one
// that was already answered in the Instagram app, or needs no follow-up.
// Only ever applies to a still-unclaimed lead; a new message from the
// parent puts it back (see handleInboundInstagramMessage).
export async function dismissLead(formData: FormData) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  const parsed = DismissLeadSchema.safeParse({ application_id: formData.get("application_id") });
  if (!parsed.success) {
    redirect("/marketing?error=" + encodeURIComponent("Invalid enquiry."));
  }

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("applications")
    .update({ dismissed_at: new Date().toISOString(), dismissed_by: profile.id })
    .eq("id", parsed.data!.application_id)
    .is("created_by", null)
    .is("dismissed_at", null)
    .select("id")
    .maybeSingle();
  if (!data) {
    redirect("/marketing?error=" + encodeURIComponent("That enquiry was just claimed or dismissed by someone else."));
  }

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "lead.dismissed",
    entity: "application",
    entityId: data!.id,
  });

  revalidatePath("/marketing");
  redirect("/marketing?dismissed=1");
}
