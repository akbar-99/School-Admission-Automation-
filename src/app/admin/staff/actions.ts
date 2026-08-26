"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatch } from "@/lib/notifications";
import { config } from "@/lib/config";
import { logAudit } from "@/lib/audit";

const InviteSchema = z.object({
  full_name: z.string().trim().min(2, "Full name is required"),
  email: z.string().trim().email("A valid email is required"),
  role: z.enum(["marketing", "teacher", "class_teacher", "admin"]),
  // WhatsApp-capable phone, in international format (e.g. 9199...). Optional.
  phone: z.string().trim().min(7, "Enter a valid phone number").optional().or(z.literal("")),
  // Optional Zoom host email (assessment teachers). Defaults to the login email.
  zoom_email: z
    .string()
    .trim()
    .email("Enter a valid Zoom email")
    .optional()
    .or(z.literal("")),
});

const ZoomEmailSchema = z.object({
  user_id: z.string().uuid(),
  zoom_email: z
    .string()
    .trim()
    .email("Enter a valid Zoom email")
    .or(z.literal("")),
});

const PhoneSchema = z.object({
  user_id: z.string().uuid(),
  phone: z.string().trim().min(7, "Enter a valid phone number").or(z.literal("")),
});

function back(msg: string, type: "ok" | "error" = "ok"): never {
  redirect(`/admin/staff?${type}=${encodeURIComponent(msg)}`);
}

// Admin-only: create a staff account and email them an invite link to set
// their own password. The invite link is generated server-side and delivered
// through the app's own SMTP (not Supabase's email), so it isn't rate-limited.
export async function inviteStaff(formData: FormData) {
  const { profile } = await requireRole(["admin"]);

  const parsed = InviteSchema.safeParse({
    full_name: formData.get("full_name"),
    email: formData.get("email"),
    role: formData.get("role"),
    phone: formData.get("phone") ?? "",
    zoom_email: formData.get("zoom_email") ?? "",
  });
  if (!parsed.success) back(parsed.error.issues[0].message, "error");
  const { full_name, email, role, phone, zoom_email } = parsed.data!;

  const admin = createSupabaseAdminClient();

  // Create the auth user (invite) and get a one-time confirmation token.
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name, role },
      redirectTo: `${config.appUrl}/auth/set-password`,
    },
  });
  if (error || !data?.user) {
    back(error?.message ?? "Could not create the account (the email may already exist).", "error");
  }

  // Create the staff profile immediately so the account is usable as soon as the
  // password is set (an auth user without this row triggers "No staff profile").
  const { error: pErr } = await admin
    .from("users")
    .upsert(
      { id: data!.user!.id, role, full_name, email, phone: phone || null, zoom_email: zoom_email || null },
      { onConflict: "id" },
    );
  if (pErr) back(pErr.message, "error");

  // Build a link to our own /auth/confirm route (verifyOtp), not Supabase's
  // hosted verify endpoint — keeps the whole flow on our domain.
  const tokenHash = data!.properties?.hashed_token;
  const link = `${config.appUrl}/auth/confirm?token_hash=${tokenHash}&type=invite&next=${encodeURIComponent("/auth/set-password")}`;

  await dispatch([
    {
      event: "STAFF_INVITE",
      channel: "email",
      recipient: email,
      subject: "You're invited to the Broadway Admissions portal",
      body:
        `Hello ${full_name},\n\n` +
        `You've been added to the Broadway Home Schooling admissions portal as "${role}".\n\n` +
        `Set your password to activate your account:\n${link}\n\n` +
        `This link can be used once and will expire. If you weren't expecting this, you can ignore this email.`,
    },
  ]);

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "staff.invited",
    entity: "user",
    entityId: data!.user!.id,
    details: { role, email },
  });

  revalidatePath("/admin/staff");
  back(`Invite sent to ${email}.`);
}

// Admin-only: set or clear a teacher's Zoom account email. This is the host
// account under which their assessment meetings are created. Leave blank to
// fall back to the teacher's login email.
export async function setZoomEmail(formData: FormData) {
  const { profile } = await requireRole(["admin"]);

  const parsed = ZoomEmailSchema.safeParse({
    user_id: formData.get("user_id"),
    zoom_email: (formData.get("zoom_email") ?? "").toString().trim(),
  });
  if (!parsed.success) back(parsed.error.issues[0].message, "error");
  const { user_id, zoom_email } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("users")
    .update({ zoom_email: zoom_email || null })
    .eq("id", user_id);
  if (error) back(error.message, "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "staff.zoom_email_set",
    entity: "user",
    entityId: user_id,
    details: { zoom_email: zoom_email || null },
  });

  revalidatePath("/admin/staff");
  back(zoom_email ? "Zoom email updated." : "Zoom email cleared.");
}

// Admin-only: set or clear a staff member's WhatsApp-capable phone number.
export async function setStaffPhone(formData: FormData) {
  const { profile } = await requireRole(["admin"]);

  const parsed = PhoneSchema.safeParse({
    user_id: formData.get("user_id"),
    phone: (formData.get("phone") ?? "").toString().trim(),
  });
  if (!parsed.success) back(parsed.error.issues[0].message, "error");
  const { user_id, phone } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("users")
    .update({ phone: phone || null })
    .eq("id", user_id);
  if (error) back(error.message, "error");

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "staff.phone_set",
    entity: "user",
    entityId: user_id,
    details: { phone: phone || null },
  });

  revalidatePath("/admin/staff");
  back(phone ? "Phone number updated." : "Phone number cleared.");
}

const StaffIdSchema = z.object({ user_id: z.string().uuid() });

// Admin-only: revoke a staff member's access. Bans the auth account rather
// than deleting it — users.id cascades from auth.users, and assessment_slots
// / assessment_results reference users.id, so a hard delete would wipe their
// assessment history (booked/completed slots, recorded results). Any of
// their still-open, unclaimed slots go back to the pool.
export async function removeStaff(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = StaffIdSchema.safeParse({ user_id: formData.get("user_id") });
  if (!parsed.success) back("Invalid staff member.", "error");
  const { user_id } = parsed.data!;

  if (user_id === profile.id) back("You can't remove your own account.", "error");

  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("users")
    .select("role, email, full_name, disabled")
    .eq("id", user_id)
    .maybeSingle();
  if (!target) back("Staff member not found.", "error");
  if (target.disabled) back("Already removed.", "error");

  if (target.role === "admin") {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("disabled", false);
    if ((count ?? 0) <= 1) back("Can't remove the last active admin.", "error");
  }

  const { error: banErr } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: "876000h", // effectively permanent; reactivate lifts it
  });
  if (banErr) back(banErr.message, "error");

  await admin.from("users").update({ disabled: true }).eq("id", user_id);

  // Release any not-yet-booked slots back to the open pool; leave booked/
  // completed slots untouched as a historical record.
  await admin
    .from("assessment_slots")
    .update({ teacher_id: null, claimed_by_teacher: false })
    .eq("teacher_id", user_id)
    .is("application_id", null);

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "staff.removed",
    entity: "user",
    entityId: user_id,
    details: { email: target.email, role: target.role },
  });

  revalidatePath("/admin/staff");
  revalidatePath("/admin/assessments");
  back(`${target.full_name ?? target.email} removed — they can no longer sign in.`);
}

// Admin-only: restore a previously removed staff member's access.
export async function reactivateStaff(formData: FormData) {
  const { profile } = await requireRole(["admin"]);
  const parsed = StaffIdSchema.safeParse({ user_id: formData.get("user_id") });
  if (!parsed.success) back("Invalid staff member.", "error");
  const { user_id } = parsed.data!;

  const admin = createSupabaseAdminClient();
  const { error: unbanErr } = await admin.auth.admin.updateUserById(user_id, {
    ban_duration: "none",
  });
  if (unbanErr) back(unbanErr.message, "error");

  await admin.from("users").update({ disabled: false }).eq("id", user_id);

  await logAudit({
    actorId: profile.id,
    actorRole: profile.role,
    action: "staff.reactivated",
    entity: "user",
    entityId: user_id,
  });

  revalidatePath("/admin/staff");
  back("Staff member reactivated.");
}
