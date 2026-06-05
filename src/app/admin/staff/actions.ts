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
  });
  if (!parsed.success) back(parsed.error.issues[0].message, "error");
  const { full_name, email, role } = parsed.data!;

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
    .upsert({ id: data!.user!.id, role, full_name, email }, { onConflict: "id" });
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
