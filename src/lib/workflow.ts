import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatch, multiChannel, type OutboundMessage, type EmailAttachment } from "@/lib/notifications";
import { applyUrl } from "@/lib/parent";
import { config } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { formatINR, formatInZone, formatDate } from "@/lib/utils";
import { generateResultPdf } from "@/lib/result-pdf";
import { ensureZoomForApplication } from "@/lib/zoom";
import { needsAssessment } from "@/lib/assessment";
import { fetchSchoolLogo } from "@/lib/school-logo";
import type { Application, Parent, Student, SubjectResult } from "@/lib/types";

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
  return contacts.flatMap((c) => multiChannel(base, c, ["email", "whatsapp"]));
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
        body: `Hello ${parent.full_name},\n\nCongratulations! Your admission agreement is ready.\nReview the agreement and complete the admission fee of ${formatINR(feePaise)} here:\n${portal}\n\n(You can read the full agreement on that page before paying.)`,
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
        body: `Hello ${parent.full_name},\n\nWe have received your admission application for ${app.grade_applying}. We will be in touch with the next steps.`,
      },
      parent,
    ),
  );

  if (!needsAssessment(app.grade_applying ?? "")) {
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
  const { data: pendingAll } = await admin
    .from("applications")
    .select("id, parent_id, access_token, grade_applying, status")
    .eq("status", "FORM_SUBMITTED");
  const pending = (pendingAll ?? []).filter((a) => needsAssessment(a.grade_applying ?? ""));
  if (pending.length === 0) return;

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

  const when = `${formatInZone(slotInfo.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;

  // Auto-create the Zoom meeting for this assessment (hosted by the teacher).
  // Returns null if Zoom isn't configured or the call fails — emails still send.
  const meeting = await ensureZoomForApplication(app.id);
  const joinLine = meeting
    ? `\n\nJoin the online assessment here at your slot time:\n${meeting.joinUrl}${
        meeting.passcode ? `\nPasscode: ${meeting.passcode}` : ""
      }`
    : "";
  const hostLine = meeting
    ? `\n\nStart the meeting as host (do not share this link):\n${meeting.startUrl}`
    : "";

  const messages: OutboundMessage[] = [
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-4",
        subject: "Assessment slot confirmed",
        body: `Hello ${parent.full_name},\n\nYour assessment is confirmed for ${when}.${joinLine}`,
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
            body: `A parent booked your assessment slot on ${when} (Grade ${app.grade_applying}).${hostLine}`,
          },
          { email: t.email, phone: t.phone },
          ["email", "whatsapp"],
        ),
      );
    }
  }

  await dispatch(messages);
}

// ---------------------------------------------------------------------------
// Backfill a Zoom meeting for a slot that was booked before Zoom was
// configured (or whose earlier create attempt failed) — idempotent via
// ensureZoomForApplication. Notifies the parent (join link) and teacher
// (host link) once it's ready. Returns false if Zoom still isn't
// configured/reachable, so the caller can show an error instead of a
// silent no-op.
// ---------------------------------------------------------------------------
export async function backfillZoomLink(appId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: slot } = await admin
    .from("assessment_slots")
    .select("starts_at, teacher_id")
    .eq("application_id", appId)
    .maybeSingle();
  if (!slot) return false;

  const meeting = await ensureZoomForApplication(appId);
  if (!meeting) return false;

  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).single();
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).single();
  const parent = parentRow as Parent;
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;

  const messages: OutboundMessage[] = [
    ...multiChannel(
      {
        applicationId: app.id,
        event: "ZOOM_LINK_READY",
        subject: "Your assessment Zoom link is ready",
        body: `Hello ${parent.full_name},\n\nHere's the online meeting link for your assessment on ${when}:\n${meeting.joinUrl}${
          meeting.passcode ? `\nPasscode: ${meeting.passcode}` : ""
        }`,
      },
      parent,
    ),
  ];
  if (slot.teacher_id) {
    const { data: t } = await admin
      .from("users")
      .select("email, phone")
      .eq("id", slot.teacher_id)
      .maybeSingle();
    if (t) {
      messages.push(
        ...multiChannel(
          {
            applicationId: app.id,
            event: "ZOOM_LINK_READY",
            subject: "Zoom link ready for your assessment",
            body: `The Zoom meeting for your assessment on ${when} (Grade ${app.grade_applying}) is ready.\n\nStart as host:\n${meeting.startUrl}`,
          },
          { email: t.email, phone: t.phone },
          ["email", "whatsapp"],
        ),
      );
    }
  }
  await dispatch(messages);
  return true;
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
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  await dispatch(
    multiChannel(
      {
        event: "SLOT_ASSIGNED",
        subject: "New assessment slot assigned to you",
        body: `An assessment slot on ${when} has been assigned to you. It will appear on your dashboard.`,
      },
      { email: t.email, phone: t.phone },
      ["email", "whatsapp"],
    ),
  );
}

// ---------------------------------------------------------------------------
// Admin opened a slot to the teacher pool (no teacher pre-assigned) — let
// every teacher know it's available to claim on a first-come basis.
// ---------------------------------------------------------------------------
export async function notifyOpenSlotAvailable(
  slot: { starts_at: string },
  quantity = 1,
  weeks = 1,
) {
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const body =
    weeks > 1
      ? `${quantity} new assessment slots starting ${when} are open in the pool every week for ${weeks} weeks — first come, first served. Claim one on your dashboard.`
      : quantity > 1
        ? `${quantity} new assessment slots on ${when} are open in the pool — first come, first served. Claim one on your dashboard.`
        : `A new assessment slot on ${when} is open for any teacher to claim. First to claim it on your dashboard gets it.`;
  await dispatch(
    fanToStaff(await staffContacts(["teacher"]), {
      event: "SLOT_POOL_OPENED",
      subject: "New open assessment slot available",
      body,
    }),
  );
}

// ---------------------------------------------------------------------------
// A teacher claimed an open slot from the pool — let admins know who has it.
// ---------------------------------------------------------------------------
export async function notifySlotClaimed(teacherId: string, slot: { starts_at: string }) {
  const admin = createSupabaseAdminClient();
  const { data: t } = await admin
    .from("users")
    .select("full_name, email")
    .eq("id", teacherId)
    .maybeSingle();
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      event: "SLOT_CLAIMED",
      subject: "Assessment slot claimed by a teacher",
      body: `${t?.full_name ?? t?.email ?? "A teacher"} claimed the open assessment slot on ${when}.`,
    }),
  );
}

// ---------------------------------------------------------------------------
// A teacher reported they can't attend a booked assessment — admins need to
// reassign it to another teacher.
// ---------------------------------------------------------------------------
export async function notifyTeacherUnavailable(
  teacherId: string,
  slot: { starts_at: string; studentName?: string | null },
) {
  const admin = createSupabaseAdminClient();
  const { data: t } = await admin
    .from("users")
    .select("full_name, email")
    .eq("id", teacherId)
    .maybeSingle();
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const who = slot.studentName ? ` for ${slot.studentName}` : "";
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      event: "SLOT_UNAVAILABLE",
      subject: "Teacher unavailable — assessment needs reassignment",
      body: `${t?.full_name ?? t?.email ?? "A teacher"} reported they can't attend the assessment${who} on ${when}. Please reassign it to another teacher.`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Admin reassigned a booked/claimed slot to a different teacher — tell the
// outgoing teacher, the new teacher, and (if booked) the parent with the
// refreshed Zoom link.
// ---------------------------------------------------------------------------
export async function notifySlotReassigned(input: {
  slotStartsAt: string;
  oldTeacherId: string | null;
  newTeacherId: string;
  applicationId: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const when = `${formatInZone(input.slotStartsAt, config.school.timezone)} ${config.school.timezoneLabel}`;

  const messages: OutboundMessage[] = [];

  if (input.oldTeacherId) {
    const { data: old } = await admin
      .from("users")
      .select("email, phone")
      .eq("id", input.oldTeacherId)
      .maybeSingle();
    if (old) {
      messages.push(
        ...multiChannel(
          {
            event: "SLOT_REASSIGNED",
            subject: "Assessment reassigned away from you",
            body: `Your assessment on ${when} has been reassigned to another teacher. It's been removed from your dashboard.`,
          },
          { email: old.email, phone: old.phone },
          ["email", "whatsapp"],
        ),
      );
    }
  }

  const { data: newT } = await admin
    .from("users")
    .select("email, phone")
    .eq("id", input.newTeacherId)
    .maybeSingle();
  if (newT) {
    messages.push(
      ...multiChannel(
        {
          event: "SLOT_REASSIGNED",
          subject: "Assessment reassigned to you",
          body: `An assessment on ${when} has been reassigned to you. Check your dashboard for details.`,
        },
        { email: newT.email, phone: newT.phone },
        ["email", "whatsapp"],
      ),
    );
  }

  if (input.applicationId) {
    // Regenerate the Zoom meeting under the new teacher before notifying the
    // parent, so the confirmation carries a working link.
    const meeting = await ensureZoomForApplication(input.applicationId);
    const { data: appRow } = await admin
      .from("applications")
      .select("*")
      .eq("id", input.applicationId)
      .single();
    const app = appRow as Application;
    const { data: parentRow } = await admin
      .from("parents")
      .select("*")
      .eq("id", app.parent_id)
      .single();
    const parent = parentRow as Parent;
    const joinLine = meeting
      ? `\n\nJoin the online assessment here at your slot time:\n${meeting.joinUrl}${
          meeting.passcode ? `\nPasscode: ${meeting.passcode}` : ""
        }`
      : "";
    messages.push(
      ...multiChannel(
        {
          applicationId: app.id,
          event: "SLOT_REASSIGNED",
          subject: "Your assessment teacher has changed",
          body: `Hello ${parent.full_name},\n\nYour assessment on ${when} is still confirmed, with a different teacher.${joinLine}`,
        },
        parent,
      ),
    );
  }

  await dispatch(messages);
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

  // Gather the subject-wise scores and attach the uploaded files to the email.
  const { data: rRow } = await admin
    .from("assessment_results")
    .select("subjects")
    .eq("application_id", appId)
    .maybeSingle();
  const subjects = ((rRow?.subjects as SubjectResult[] | undefined) ?? []);
  const subjectLines = subjects
    .map(
      (s) =>
        `- ${s.subject}: ${s.score != null ? `${s.score}/${s.maxScore ?? 100}` : "—"}${s.comment ? ` — ${s.comment}` : ""}`,
    )
    .join("\n");

  const attachments: EmailAttachment[] = [];
  for (const s of subjects) {
    if (!s.file) continue;
    const { data: blob } = await admin.storage.from("documents").download(s.file.path);
    if (blob) {
      attachments.push({
        filename: s.file.name,
        content: Buffer.from(await blob.arrayBuffer()),
        contentType: s.file.type,
      });
    }
  }

  // Professional PDF report card (with the school logo), attached first.
  let pdfAttached = false;
  try {
    const studentRow = app.student_id
      ? (await admin.from("students").select("full_name, dob").eq("id", app.student_id).maybeSingle()).data
      : null;
    const st = studentRow as { full_name?: string; dob?: string } | null;
    const s = await getSettings();
    const logo = await fetchSchoolLogo();
    const pdf = await generateResultPdf({
      schoolName: s.schoolName,
      schoolPhone: s.schoolPhone,
      schoolEmail: s.schoolEmail,
      studentName: st?.full_name ?? parent.full_name,
      dob: st?.dob ? formatDate(st.dob) : null,
      grade: app.grade_applying,
      parentName: parent.full_name,
      admissionRef: app.id,
      outcome,
      remarks,
      subjects: subjects.map((x) => ({ subject: x.subject, score: x.score, maxScore: x.maxScore, comment: x.comment })),
      logo,
      date: formatDate(new Date()),
    });
    const safeName = (st?.full_name ?? "student").replace(/[^a-z0-9]+/gi, "-");
    attachments.unshift({
      filename: `Assessment-Result-${safeName}.pdf`,
      content: pdf,
      contentType: "application/pdf",
    });
    pdfAttached = true;
  } catch (err) {
    console.error("[workflow] result PDF generation failed", err);
  }

  const hasFiles = subjects.some((s) => s.file);
  const portal = applyUrl(app.access_token);
  const parentBody =
    `Hello ${parent.full_name},\n\n` +
    `Your child's assessment result is: ${outcome}.\n` +
    (subjectLines ? `\nSubject scores:\n${subjectLines}\n` : "") +
    (remarks ? `\nRemarks: ${remarks}\n` : "") +
    (pdfAttached
      ? `\nYour detailed assessment report (PDF)${hasFiles ? " and the subject sheets are" : " is"} attached.`
      : "") +
    `\nYou can also view the full results online here:\n${portal}`;

  // N-5 result to parent (with per-subject scores + attached files) + admin
  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-5",
        subject: "Assessment result",
        body: parentBody,
        attachments,
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
