import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatch, multiChannel, type OutboundMessage } from "@/lib/notifications";
import { applyUrl } from "@/lib/parent";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { formatINR } from "@/lib/utils";
import type { Application, Parent, Student } from "@/lib/types";

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------
async function staffContacts(
  roles: string[],
): Promise<{ email: string | null; phone: string | null }[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("users")
    .select("email, phone, role")
    .in("role", roles);
  return (data ?? []).map((u) => ({ email: u.email, phone: u.phone }));
}

function fanToStaff(
  contacts: { email: string | null; phone: string | null }[],
  base: Omit<OutboundMessage, "channel" | "recipient">,
): OutboundMessage[] {
  return contacts.flatMap((c) => multiChannel(base, c, ["email"]));
}

function agreementUrl(token: string) {
  return `${config.appUrl}/api/agreement/${token}`;
}

// ---------------------------------------------------------------------------
// N-1 Lead created — admission link to parent
// ---------------------------------------------------------------------------
export async function notifyLeadCreated(app: Application, parent: Parent) {
  const link = applyUrl(app.access_token);
  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "N-1",
        subject: "Complete your school admission",
        body: `Hello ${parent.full_name},\n\nPlease complete the admission form using your secure link:\n${link}\n\nThis link expires on ${new Date(app.token_expires_at).toDateString()}.`,
      },
      parent,
    ),
  );
}

// ---------------------------------------------------------------------------
// N-6 Agreement + Razorpay payment link
// ---------------------------------------------------------------------------
export async function sendAgreement(app: Application, parent: Parent) {
  const portal = applyUrl(app.access_token);
  const { feePaise } = await getSettings();
  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "N-6",
        subject: "Admission agreement & payment",
        body: `Hello ${parent.full_name},\n\nCongratulations! Your admission agreement is ready.\nView the agreement: ${agreementUrl(app.access_token)}\nComplete the admission fee of ${formatINR(feePaise)} here: ${portal}`,
      },
      parent,
    ),
  );
}

// ---------------------------------------------------------------------------
// Form submitted (N-2) — branch KG vs GRADE
// ---------------------------------------------------------------------------
export async function handleFormSubmitted(appId: string) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin
    .from("applications")
    .select("*")
    .eq("id", appId)
    .single();
  const app = appRow as Application;
  const { data: parentRow } = await admin
    .from("parents")
    .select("*")
    .eq("id", app.parent_id)
    .single();
  const parent = parentRow as Parent;

  const messages: OutboundMessage[] = [];

  // Parent confirmation
  messages.push(
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-2",
        subject: "Application received",
        body: `Hello ${parent.full_name},\n\nWe have received your admission application. Category detected: ${app.category}. We will be in touch with the next steps.`,
      },
      parent,
    ),
  );

  if (app.category === "KG") {
    // KG: straight to agreement
    messages.push(
      ...fanToStaff(await staffContacts(["admin"]), {
        applicationId: app.id,
        event: "N-2",
        subject: "New KG application",
        body: `A new KG application was submitted for review.`,
      }),
    );
    await admin
      .from("applications")
      .update({ status: "AGREEMENT_SENT" })
      .eq("id", app.id)
      .eq("status", "FORM_SUBMITTED");
    await dispatch(messages);
    const { data: fresh } = await admin
      .from("applications")
      .select("*")
      .eq("id", app.id)
      .single();
    await sendAgreement(fresh as Application, parent);
  } else {
    // GRADE: notify admin to create & assign an assessment slot
    messages.push(
      ...fanToStaff(await staffContacts(["admin"]), {
        applicationId: app.id,
        event: "N-2",
        subject: "New Grade applicant — schedule assessment",
        body: `A new Grade applicant (${app.grade_applying}) requires an assessment. Please create and assign a slot.`,
      }),
    );
    await dispatch(messages);
  }
}

// ---------------------------------------------------------------------------
// N-3 Slots published — notify grade applicants awaiting a slot
// ---------------------------------------------------------------------------
export async function notifySlotsPublished() {
  const admin = createSupabaseAdminClient();
  const { data: pending } = await admin
    .from("applications")
    .select("id, parent_id, access_token, category, status")
    .eq("category", "GRADE")
    .eq("status", "FORM_SUBMITTED");
  if (!pending || pending.length === 0) return;

  const messages: OutboundMessage[] = [];
  for (const a of pending) {
    const { data: parentRow } = await admin
      .from("parents")
      .select("*")
      .eq("id", a.parent_id)
      .single();
    const parent = parentRow as Parent;
    messages.push(
      ...multiChannel(
        {
          applicationId: a.id,
          event: "N-3",
          subject: "Assessment slots available",
          body: `Hello ${parent.full_name},\n\nAssessment slots are now available. Please pick a slot: ${applyUrl(a.access_token)}`,
        },
        parent,
      ),
    );
  }
  await dispatch(messages);
}

// ---------------------------------------------------------------------------
// N-4 Slot booked — parent, the assigned teacher, admin
// ---------------------------------------------------------------------------
export async function handleSlotBooked(
  appId: string,
  slotInfo: { starts_at: string; teacher_id?: string | null },
) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).single();
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).single();
  const parent = parentRow as Parent;

  const when = new Date(slotInfo.starts_at).toLocaleString("en-IN");
  const messages: OutboundMessage[] = [
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-4",
        subject: "Assessment slot confirmed",
        body: `Hello ${parent.full_name},\n\nYour assessment is confirmed for ${when}.`,
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "N-4",
      subject: "Assessment slot booked",
      body: `An assessment slot was booked for ${when} (Grade ${app.grade_applying}).`,
    }),
  ];

  // Notify the assigned teacher specifically.
  if (slotInfo.teacher_id) {
    const { data: t } = await admin
      .from("users")
      .select("email, phone")
      .eq("id", slotInfo.teacher_id)
      .maybeSingle();
    if (t) {
      messages.push(
        ...multiChannel(
          {
            applicationId: app.id,
            event: "N-4",
            subject: "Assessment booked for your slot",
            body: `A parent booked your assessment slot on ${when} (Grade ${app.grade_applying}).`,
          },
          { email: t.email, phone: t.phone },
          ["email"],
        ),
      );
    }
  }

  await dispatch(messages);
}

// ---------------------------------------------------------------------------
// Admin assigned a new slot to a teacher — let the teacher know.
// ---------------------------------------------------------------------------
export async function notifyTeacherSlotAssigned(
  teacherId: string,
  slot: { starts_at: string },
) {
  const admin = createSupabaseAdminClient();
  const { data: t } = await admin
    .from("users")
    .select("email, phone")
    .eq("id", teacherId)
    .maybeSingle();
  if (!t) return;
  const when = new Date(slot.starts_at).toLocaleString("en-IN");
  await dispatch(
    multiChannel(
      {
        event: "SLOT_ASSIGNED",
        subject: "New assessment slot assigned to you",
        body: `An assessment slot on ${when} has been assigned to you. It will appear on your dashboard.`,
      },
      { email: t.email, phone: t.phone },
      ["email"],
    ),
  );
}

// ---------------------------------------------------------------------------
// N-5 Assessment result; N-10 on fail. Pass -> agreement (N-6).
// ---------------------------------------------------------------------------
export async function handleAssessmentResult(
  appId: string,
  outcome: "PASS" | "FAIL",
  remarks: string | null,
) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).single();
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).single();
  const parent = parentRow as Parent;

  // N-5 result to parent + admin
  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-5",
        subject: "Assessment result",
        body: `Hello ${parent.full_name},\n\nYour child's assessment result is: ${outcome}.${remarks ? `\nRemarks: ${remarks}` : ""}`,
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "N-5",
      subject: "Assessment result recorded",
      body: `Result for Grade ${app.grade_applying} applicant: ${outcome}.`,
    }),
  ]);

  if (outcome === "PASS") {
    await admin
      .from("applications")
      .update({ status: "AGREEMENT_SENT" })
      .eq("id", app.id)
      .eq("status", "ASSESSMENT_COMPLETED");
    const { data: fresh } = await admin.from("applications").select("*").eq("id", app.id).single();
    await sendAgreement(fresh as Application, parent);
  } else {
    // FAIL -> REJECTED, courteous note (N-10), workflow ends (SRS FR-15a)
    await admin
      .from("applications")
      .update({ status: "REJECTED" })
      .eq("id", app.id)
      .eq("status", "ASSESSMENT_COMPLETED");
    await dispatch(
      multiChannel(
        {
          applicationId: app.id,
          event: "N-10",
          subject: "Admission update",
          body: `Hello ${parent.full_name},\n\nThank you for your interest. Unfortunately we are unable to offer admission at this time. We wish your child the very best.`,
        },
        parent,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Payment completed -> enrollment (N-7, N-8) or NEEDS_ADMIN (N-9)
// ---------------------------------------------------------------------------
export async function handlePaymentCompleted(
  appId: string,
  opts: { sendReceipt?: boolean } = {},
) {
  const sendReceipt = opts.sendReceipt ?? true;
  const admin = createSupabaseAdminClient();
  const { feePaise } = await getSettings();

  const { data: result, error } = await admin.rpc("enroll_application", {
    p_application: appId,
    p_year: config.admission.year,
  });
  if (error) {
    console.error("[workflow] enroll_application failed", error);
    return { status: "ERROR" as const };
  }
  const res = result as {
    status: string;
    admission_number?: string;
    section?: string;
    already?: boolean;
  };

  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).single();
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).single();
  const parent = parentRow as Parent;

  if (res.status === "NEEDS_ADMIN") {
    // `already` => this app was already in NEEDS_ADMIN; don't re-alert admins on
    // a repeat call (the /verify + /webhook double-fire, or repeated resolves).
    if (!res.already) {
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "N-9",
          subject: "Action needed: all sections full",
          body: `All sections for ${app.grade_applying ?? app.category} are full. Manual seat allocation required for admission.`,
        }),
      );
      await logAudit({ action: "enrollment.needs_admin", entity: "application", entityId: app.id, details: res });
    }
    return { status: "NEEDS_ADMIN" as const };
  }

  // Idempotency guard: /verify (checkout) and /webhook both call this for the
  // same payment. enroll_application returns `already` once the admission number
  // is set, so only the first caller sends the receipt (N-7) and welcome (N-8).
  if (res.already) {
    return { ...res, status: "ENROLLED" as const };
  }

  // N-7 payment receipt + admin; N-8 welcome + onboarding + class teacher
  const receiptMessages = sendReceipt
    ? [
        ...multiChannel(
          {
            applicationId: app.id,
            event: "N-7",
            subject: "Payment received",
            body: `Hello ${parent.full_name},\n\nWe have received your admission fee of ${formatINR(feePaise)}. A receipt is available in your portal: ${applyUrl(app.access_token)}`,
          },
          parent,
        ),
        ...fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "N-7",
          subject: "Payment received",
          body: `Admission fee received for application ${app.id}.`,
        }),
      ]
    : [];
  await dispatch([
    ...receiptMessages,
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-8",
        subject: "Welcome — admission confirmed",
        body: `Hello ${parent.full_name},\n\nWelcome! Admission is confirmed.\nAdmission number: ${res.admission_number}\nClass & section: ${res.section}\n\nOnboarding details (study material list, academic calendar and contacts) are available in your portal: ${applyUrl(app.access_token)}`,
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["class_teacher", "admin"]), {
      applicationId: app.id,
      event: "N-8",
      subject: "New student assigned",
      body: `A new student has been enrolled and assigned to ${res.section} (admission no. ${res.admission_number}).`,
    }),
  ]);

  await logAudit({ action: "enrollment.completed", entity: "application", entityId: app.id, details: res });
  return { ...res, status: "ENROLLED" as const };
}
