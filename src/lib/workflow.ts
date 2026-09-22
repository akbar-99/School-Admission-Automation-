import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dispatch, multiChannel, type OutboundMessage, type EmailAttachment } from "@/lib/notifications";
import { applyUrl } from "@/lib/parent";
import { config } from "@/lib/config";
import { getSettings, getStudyMaterialFeeForGrade } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { formatINR, formatInZone, formatDate } from "@/lib/utils";
import { generateResultPdf } from "@/lib/result-pdf";
import { ensureZoomForApplication } from "@/lib/zoom";
import { sendErpAdmission, syncClassToErp } from "@/lib/erp";
import { appendEnrollmentRow, removeEnrollmentRow, sanitizeTabName } from "@/lib/google-sheets";
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

// Every staff-facing WhatsApp send reuses the one generic approved template
// (staff_alert_v4): {{1}} a short reference, {{2}} the detail — the
// subject/body pair every call site already provides fits this directly, so
// no per-event template is needed for internal alerts. v2 said "Open the
// admin portal", wrong for teacher-only events like a slot assignment; v3's
// reword ("Check your dashboard for details") got auto-reclassified from
// Utility to Marketing by Meta's classifier. v4 keeps v2's exact proven-Utility
// structure and swaps only the broken CTA to something role-neutral. Freeform
// text only delivers within a 24h
// window the recipient opened themselves — outside that window the WhatsApp
// Cloud API can still accept the request (logged here as "sent") and then
// silently fail to deliver it async, with no webhook configured to report
// that back — so every staff/teacher WhatsApp send, fanned out or to one
// specific person, must go through this.
function toStaffMember(
  contact: { email: string | null; phone: string | null },
  base: Omit<OutboundMessage, "channel" | "recipient">,
): OutboundMessage[] {
  // WhatsApp template parameters reject newline/tab characters outright —
  // several staff bodies are multi-line (Zoom join/host links, etc.), so
  // collapse to one line for the template param only; email still gets the
  // original, unmodified body. Also strip a trailing period: the template's
  // own fixed text already ends {{2}} with one ("Status: {{2}}."), so a body
  // that already ends in "." produced a stray double period.
  const detail = base.body.replace(/\s*\n+\s*/g, " ").trim().replace(/\.+$/, "");
  return multiChannel(
    { ...base, whatsappTemplate: { name: "staff_alert_v4", params: [base.subject ?? base.event, detail] } },
    contact,
    ["email", "whatsapp"],
  );
}

function fanToStaff(
  contacts: { email: string | null; phone: string | null }[],
  base: Omit<OutboundMessage, "channel" | "recipient">,
): OutboundMessage[] {
  return contacts.flatMap((c) => toStaffMember(c, base));
}

// ---------------------------------------------------------------------------
// N-1 Lead created — admission link to parent
// ---------------------------------------------------------------------------
export async function notifyLeadCreated(app: Application, parent: Parent) {
  const link = applyUrl(app.access_token);
  const expiry = new Date(app.token_expires_at).toDateString();
  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "N-1",
        subject: "Complete your school admission",
        body: `Hello ${parent.full_name},\n\nPlease complete the admission form using your secure link:\n${link}\n\nThis link expires on ${expiry}.`,
        whatsappTemplate: { name: "admission_link_v2", params: [parent.full_name, link, expiry] },
      },
      parent,
    ),
  );
}

// ---------------------------------------------------------------------------
// Stage-2 submission blocked as a likely duplicate (same address as another
// application, plus a matching student name or DOB) — flag it to admin so
// they can decide whether to merge/reject the extra one, since the parent
// has no way to resolve this themselves.
// ---------------------------------------------------------------------------
export async function notifyDuplicateDetailsBlocked(
  app: Application,
  dup: { parentName: string; studentName: string; status: string },
) {
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "DUPLICATE_DETAILS_BLOCKED",
      subject: "Blocked a likely duplicate admission details submission",
      body: `An admission details submission for "${dup.studentName}" was blocked because it shares an address with an existing application under ${dup.parentName} (status: ${dup.status}). Please review both and decide whether to merge or reject one.`,
    }),
  );
}

// ---------------------------------------------------------------------------
// N-6 Agreement + Razorpay payment link
// ---------------------------------------------------------------------------
export async function sendAgreement(app: Application, parent: Parent) {
  const portal = applyUrl(app.access_token);
  const [{ feePaise }, studyMaterialFeePaise] = await Promise.all([
    getSettings(),
    getStudyMaterialFeeForGrade(app.grade_applying),
  ]);
  const studyMaterialLine =
    studyMaterialFeePaise > 0
      ? `\nStudy material (optional, can also be paid later): ${formatINR(studyMaterialFeePaise)}`
      : "";
  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "N-6",
        subject: "Admission agreement & payment",
        body: `Hello ${parent.full_name},\n\nCongratulations! Your admission agreement is ready.\nReview the agreement and complete your payment here:\n${portal}\n\nAdmission fee: ${formatINR(feePaise)}${studyMaterialLine}\n\n(You can read the full agreement on that page before paying.)`,
        whatsappTemplate: {
          name: "agreement_ready",
          params: [parent.full_name, app.grade_applying ?? app.category ?? "your child", formatINR(feePaise), portal],
        },
      },
      parent,
    ),
  );
}

// ---------------------------------------------------------------------------
// Remaining-details form unlocked — either right away (KG 1, which never has
// an assessment) or once a Grade applicant's assessment result is a PASS.
// Shared by handleFormSubmitted and handleAssessmentResult so the two
// trigger points send identical wording.
// ---------------------------------------------------------------------------
async function notifyDetailsPending(app: Application, parent: Parent) {
  const portal = applyUrl(app.access_token);
  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "N-2b",
        subject: "Complete your admission details",
        body: `Hello ${parent.full_name},\n\nPlease complete the remaining admission details (documents, addresses and parent information) to continue:\n${portal}`,
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
    // KG 1: never has an assessment, so the remaining-details form unlocks
    // immediately rather than waiting on anything.
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
      .update({ status: "DETAILS_PENDING" })
      .eq("id", app.id)
      .eq("status", "FORM_SUBMITTED");
    await dispatch(messages);
    await notifyDetailsPending(app, parent);
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
        ...toStaffMember(
          { email: t.email, phone: t.phone },
          {
            applicationId: app.id,
            event: "N-4",
            subject: "Assessment booked for your slot",
            body: `A parent booked your assessment slot on ${when} (Grade ${app.grade_applying}).${hostLine}`,
          },
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
        ...toStaffMember(
          { email: t.email, phone: t.phone },
          {
            applicationId: app.id,
            event: "ZOOM_LINK_READY",
            subject: "Zoom link ready for your assessment",
            body: `The Zoom meeting for your assessment on ${when} (Grade ${app.grade_applying}) is ready.\n\nStart as host:\n${meeting.startUrl}`,
          },
        ),
      );
    }
  }
  await dispatch(messages);
  return true;
}

// ---------------------------------------------------------------------------
// 10-minutes-before reminder — fired by the polling cron route
// (/api/cron/assessment-reminders), once per slot (guarded there by
// assessment_slots.reminder_sent so a slot is never reminded twice). Notifies
// the parent and the assigned teacher; by this point the Zoom link is already
// active (it opens 30 minutes early), so it's safe to include.
// ---------------------------------------------------------------------------
export async function notifyAssessmentReminder(slot: {
  application_id: string;
  teacher_id: string | null;
  starts_at: string;
  zoom_join_url: string | null;
  zoom_passcode: string | null;
  zoom_start_url: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin
    .from("applications")
    .select("*")
    .eq("id", slot.application_id)
    .maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  if (!parentRow) return;
  const parent = parentRow as Parent;

  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const joinLine = slot.zoom_join_url
    ? `\n\nJoin here:\n${slot.zoom_join_url}${slot.zoom_passcode ? `\nPasscode: ${slot.zoom_passcode}` : ""}`
    : "";

  const messages: OutboundMessage[] = [
    ...multiChannel(
      {
        applicationId: app.id,
        event: "ASSESSMENT_REMINDER",
        subject: "Your assessment starts in 10 minutes",
        body: `Hello ${parent.full_name},\n\nYour assessment starts in 10 minutes, at ${when}.${joinLine}`,
        // Only attach the template when there's a real join link to put in
        // it — the template's {{4}} is required, unlike the freeform body's
        // joinLine, which is allowed to be blank if Zoom isn't set up. Falls
        // back to freeform text in that edge case, same as before.
        ...(slot.zoom_join_url
          ? {
              whatsappTemplate: {
                name: "assessment_starting_soon",
                params: [parent.full_name, "10 minutes", when, slot.zoom_join_url],
              },
            }
          : {}),
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
      const hostLine = slot.zoom_start_url ? `\n\nStart as host:\n${slot.zoom_start_url}` : "";
      messages.push(
        ...toStaffMember(
          { email: t.email, phone: t.phone },
          {
            applicationId: app.id,
            event: "ASSESSMENT_REMINDER",
            subject: "Your assessment starts in 10 minutes",
            body: `Hello,\n\nYour assessment${app.grade_applying ? ` with a Grade ${app.grade_applying} applicant` : ""} starts in 10 minutes, at ${when}.${hostLine}`,
          },
        ),
      );
    }
  }

  await dispatch(messages);
}

// ---------------------------------------------------------------------------
// 2-hours-before reminder — separate from the 10-minute one above (its own
// reminder_2h_sent flag), with a confirm link and a reschedule link so the
// parent can act on it directly from email/WhatsApp instead of just being
// told the time. Confirm is a plain GET link (non-destructive, same pattern
// as every other token link in this app); reschedule sends them to the
// portal where releasing the slot needs an explicit button click, since
// that's a real state change (frees the slot for someone else to book).
// ---------------------------------------------------------------------------
// Human-friendly form of the admin-configured lead time, e.g. 120 -> "2
// hours", 90 -> "1 hour 30 minutes", 45 -> "45 minutes".
function formatLeadTime(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rem === 0 ? hourPart : `${hourPart} ${rem} minutes`;
}

export async function notifyAssessmentReminder2h(
  slot: { application_id: string; starts_at: string },
  leadMinutes: number,
) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin
    .from("applications")
    .select("*")
    .eq("id", slot.application_id)
    .maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  if (!parentRow) return;
  const parent = parentRow as Parent;

  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const confirmUrl = `${config.appUrl}/api/assessment/confirm/${app.access_token}`;
  const rescheduleUrl = applyUrl(app.access_token);
  const lead = formatLeadTime(leadMinutes);

  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "ASSESSMENT_REMINDER_2H",
        subject: `Your assessment is in ${lead}`,
        body:
          `Hello ${parent.full_name},\n\nYour assessment is coming up in ${lead}, at ${when}.\n\n` +
          `Please confirm you'll attend:\n${confirmUrl}\n\n` +
          `Need to reschedule instead? Visit your portal and release your slot to pick a new time:\n${rescheduleUrl}`,
        whatsappTemplate: {
          name: "assessment_reminder",
          params: [parent.full_name, lead, when, confirmUrl, rescheduleUrl],
        },
      },
      parent,
    ),
  );
}

// Called by GET /api/assessment/confirm/[token] — a plain link click from
// the 2h reminder. Idempotent: confirming twice just no-ops the second time
// (and only notifies on the genuine first confirmation).
export async function confirmAssessmentSlot(applicationId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("assessment_slots")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .is("confirmed_at", null)
    .select("id, starts_at, teacher_id");
  if (error) {
    console.error("[workflow] confirmAssessmentSlot failed", error);
    return false;
  }
  if (data && data.length > 0) {
    await logAudit({ action: "assessment.confirmed", entity: "application", entityId: applicationId, details: {} });
    await notifyAssessmentConfirmed(applicationId, data[0] as { starts_at: string; teacher_id: string | null });
  }
  return true;
}

// Tells admin + the assigned teacher a parent confirmed attendance — the
// mirror of notifySlotReleased's recipients for the opposite action, so
// a teacher finds out either way rather than only when a slot falls through.
async function notifyAssessmentConfirmed(
  applicationId: string,
  slot: { starts_at: string; teacher_id: string | null },
) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  const parent = parentRow as Parent | null;

  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const who = parent?.full_name ?? "The parent";

  const messages: OutboundMessage[] = [
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "ASSESSMENT_CONFIRMED",
      subject: "Parent confirmed attendance",
      body: `${who} confirmed they'll attend the ${when} assessment (Grade ${app.grade_applying ?? "—"}).`,
    }),
  ];

  if (slot.teacher_id) {
    const { data: t } = await admin.from("users").select("email, phone").eq("id", slot.teacher_id).maybeSingle();
    if (t) {
      messages.push(
        ...toStaffMember(
          { email: t.email, phone: t.phone },
          {
            applicationId: app.id,
            event: "ASSESSMENT_CONFIRMED",
            subject: "Parent confirmed attendance",
            body: `${who} confirmed they'll attend your ${when} assessment.`,
          },
        ),
      );
    }
  }

  await dispatch(messages);
}

// Called after release_assessment_slot succeeds — lets the teacher and admin
// know the slot is open again rather than them finding out only when it
// silently reappears in the pool.
export async function notifySlotReleased(
  appId: string,
  slotInfo: { starts_at: string; teacher_id?: string | null },
) {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  const parent = parentRow as Parent | null;

  const when = `${formatInZone(slotInfo.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const messages: OutboundMessage[] = [
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "ASSESSMENT_RESCHEDULED",
      subject: "Assessment rescheduled by parent",
      body: `${parent?.full_name ?? "A parent"} released their ${when} slot to pick a new time (Grade ${app.grade_applying ?? "—"}).`,
    }),
  ];
  if (slotInfo.teacher_id) {
    const { data: t } = await admin.from("users").select("email, phone").eq("id", slotInfo.teacher_id).maybeSingle();
    if (t) {
      messages.push(
        ...toStaffMember(
          { email: t.email, phone: t.phone },
          {
            applicationId: app.id,
            event: "ASSESSMENT_RESCHEDULED",
            subject: "A booked slot was released",
            body: `Your ${when} assessment slot was released by the parent and is open again.`,
          },
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
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  await dispatch(
    toStaffMember(
      { email: t.email, phone: t.phone },
      {
        event: "SLOT_ASSIGNED",
        subject: "New assessment slot assigned to you",
        body: `An assessment slot on ${when} has been assigned to you. It will appear on your dashboard.`,
      },
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
        ...toStaffMember(
          { email: old.email, phone: old.phone },
          {
            event: "SLOT_REASSIGNED",
            subject: "Assessment reassigned away from you",
            body: `Your assessment on ${when} has been reassigned to another teacher. It's been removed from your dashboard.`,
          },
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
      ...toStaffMember(
        { email: newT.email, phone: newT.phone },
        {
          event: "SLOT_REASSIGNED",
          subject: "Assessment reassigned to you",
          body: `An assessment on ${when} has been reassigned to you. Check your dashboard for details.`,
        },
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
      studentName: st?.full_name ?? app.lead_student_name ?? parent.full_name,
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
  // On a PASS, fold the "complete your details" call-to-action (previously a
  // separate N-2b send right after this one) into the same message — the two
  // always fired back-to-back with no parent action in between, so sending
  // them separately was just a duplicate ping.
  const nextStepLine =
    outcome === "PASS"
      ? `\nNext step: please complete your remaining admission details (documents, addresses and parent information) here:\n${portal}`
      : `\nYou can also view the full results online here:\n${portal}`;
  const parentBody =
    `Hello ${parent.full_name},\n\n` +
    `Your child's assessment result is: ${outcome}.\n` +
    (subjectLines ? `\nSubject scores:\n${subjectLines}\n` : "") +
    (remarks ? `\nRemarks: ${remarks}\n` : "") +
    (pdfAttached
      ? `\nYour detailed assessment report (PDF)${hasFiles ? " and the subject sheets are" : " is"} attached.`
      : "") +
    nextStepLine;

  // N-5 result to parent (with per-subject scores + attached files) + admin
  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-5",
        subject: "Assessment result",
        body: parentBody,
        attachments,
        whatsappTemplate: { name: "assessment_result", params: [parent.full_name, portal] },
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
      .update({ status: "DETAILS_PENDING" })
      .eq("id", app.id)
      .eq("status", "ASSESSMENT_COMPLETED");
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
// ERP integration — after enrollment, look up the exact ERP class_name
// configured on the section this app already assigned (Admin → Sections),
// and notify the ERP so the student record exists there automatically.
// This app's own sections decide the division (enroll_application's existing
// fill-order, unchanged) — the ERP has no say in that decision, only in
// which of its own class names each section corresponds to. Additive and
// independent of the enrollment notifications: never throws — any failure
// here is logged and flagged for admin review (Admin → ERP) rather than
// surfaced to the parent, since enrollment itself already succeeded by the
// time this runs.
// ---------------------------------------------------------------------------
export async function syncEnrollmentToErp(app: Application, parent: Parent, admissionNumber: string) {
  if (!config.erp.enabled) return;
  const admin = createSupabaseAdminClient();

  try {
    const { data: section } = await admin
      .from("sections")
      .select("erp_class_name")
      .eq("id", app.section_id)
      .maybeSingle();

    if (!section?.erp_class_name) {
      await admin.from("applications").update({ erp_status: "no_mapping" }).eq("id", app.id);
      await logAudit({
        action: "erp.no_mapping",
        entity: "application",
        entityId: app.id,
        details: { section_id: app.section_id },
      });
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "ERP_NO_MAPPING",
          subject: "ERP sync needs attention: no class mapping",
          body: `${admissionNumber} can't sync to the ERP yet — the assigned section has no ERP class name set. Configure it under Admin → Sections, then retry under Admin → ERP.`,
        }),
      );
      return;
    }

    const className = section.erp_class_name;
    // Recorded before the send attempt so a crash mid-send still leaves a
    // retryable record with the class already resolved.
    await admin
      .from("applications")
      .update({ erp_status: "send_failed", erp_class_name: className })
      .eq("id", app.id);

    const { data: studentRow } = await admin
      .from("students")
      .select("*")
      .eq("id", app.student_id)
      .maybeSingle();
    const student = studentRow as Student | null;
    const { academicTermStart } = await getSettings();

    const result = await sendErpAdmission({
      admission_id: app.id,
      student_id: admissionNumber,
      full_name: student?.full_name ?? parent.full_name,
      class_name: className,
      email: parent.email,
      phone: parent.phone,
      gender: student?.gender ?? null,
      date_of_birth: student?.dob ?? null,
      address: student?.current_address ?? student?.permanent_address ?? null,
      parent_name: parent.full_name,
      parent_phone: parent.phone,
      parent_email: parent.email,
      joining_date: academicTermStart,
    });

    if (!result.ok) {
      console.error("[erp] admission send failed", result.error);
      await logAudit({
        action: "erp.send_failed",
        entity: "application",
        entityId: app.id,
        details: { error: result.error, class_name: className },
      });
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "ERP_SEND_FAILED",
          subject: "ERP sync failed",
          body: `${admissionNumber} was assigned ERP class "${className}" but the ERP webhook call failed. Retry under Admin → ERP.`,
        }),
      );
      return;
    }

    await admin
      .from("applications")
      .update({ erp_status: "synced", erp_student_id: result.erpStudentId, erp_warning: result.warning })
      .eq("id", app.id);
    await logAudit({
      action: "erp.synced",
      entity: "application",
      entityId: app.id,
      details: { class_name: className, warning: result.warning },
    });

    if (result.warning) {
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "ERP_WARNING",
          subject: "ERP sync warning",
          body: `${admissionNumber} synced to the ERP, but it returned a warning: ${result.warning}`,
        }),
      );
    }
  } catch (err) {
    console.error("[erp] syncEnrollmentToErp threw unexpectedly", err);
  }
}

// ---------------------------------------------------------------------------
// Export an enrolled student's details to Google Sheets — one spreadsheet,
// one tab per class, so each class teacher can be pointed at just their own
// tab. Purely a reporting convenience for staff who work out of Sheets
// rather than this app: additive, independent of enrollment itself, and
// never throws — a failure here is logged for admins to notice in the audit
// log, not surfaced to the parent or retried automatically (unlike ERP sync,
// this doesn't block anything the school depends on operationally).
// ---------------------------------------------------------------------------
export async function syncEnrollmentToGoogleSheet(app: Application, parent: Parent, admissionNumber: string) {
  if (!config.googleSheets.enabled) return;
  const admin = createSupabaseAdminClient();

  try {
    const [{ data: section }, { data: studentRow }] = await Promise.all([
      admin.from("sections").select("grade, name, class_timing").eq("id", app.section_id).maybeSingle(),
      admin.from("students").select("*").eq("id", app.student_id).maybeSingle(),
    ]);
    const student = studentRow as Student | null;
    const tabName = section
      ? sanitizeTabName(`${section.grade}-${section.name}`)
      : sanitizeTabName(app.grade_applying ?? "Unassigned");

    // 10-year signed URLs so the links stay valid for the sheet's whole
    // practical lifetime, not just an admin-session-length window like the
    // 1-hour ones used for in-app viewing.
    const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;
    const docs = app.documents ?? [];
    const signDoc = async (category: string): Promise<string | null> => {
      const doc = docs.find((d) => d.category === category);
      if (!doc) return null;
      const { data } = await admin.storage
        .from("documents")
        .createSignedUrl(doc.path, TEN_YEARS_SECONDS, { download: doc.name });
      return data?.signedUrl ?? null;
    };
    const [passportUrl, birthCertificateUrl, photoUrl] = await Promise.all([
      signDoc("passport"),
      signDoc("birth_certificate"),
      signDoc("photo"),
    ]);

    const result = await appendEnrollmentRow(
      {
        admissionNumber,
        studentName: student?.full_name ?? parent.full_name,
        dob: student?.dob ?? null,
        gender: student?.gender ?? null,
        grade: section?.grade ?? app.grade_applying,
        sectionName: section?.name ?? null,
        classTiming: section?.class_timing ?? null,
        parentName: parent.full_name,
        parentPhone: parent.phone,
        parentEmail: parent.email,
        fatherName: student?.father_name ?? null,
        fatherPhone: student?.father_phone ?? null,
        motherName: student?.mother_name ?? null,
        motherPhone: student?.mother_phone ?? null,
        address: student?.current_address ?? student?.permanent_address ?? null,
        previousSchool: student?.previous_school ?? null,
        curriculum: student?.curriculum ?? null,
        penNumber: student?.pen_number ?? null,
        enrolledOn: formatInZone(new Date(), config.school.timezone),
        passportUrl,
        birthCertificateUrl,
        photoUrl,
      },
      tabName,
    );

    if (!result.ok) {
      console.error("[google-sheets] enrollment row append failed", result.error);
      await logAudit({
        action: "google_sheets.sync_failed",
        entity: "application",
        entityId: app.id,
        details: { error: result.error, tab: tabName },
      });
      return;
    }

    await logAudit({
      action: "google_sheets.synced",
      entity: "application",
      entityId: app.id,
      details: { tab: tabName },
    });
  } catch (err) {
    console.error("[google-sheets] syncEnrollmentToGoogleSheet threw unexpectedly", err);
  }
}

// ---------------------------------------------------------------------------
// Remove an applicant's row from Google Sheets — used when the applicant is
// permanently deleted, and (paired with a fresh syncEnrollmentToGoogleSheet
// call) when they transfer to a different section, so the row moves to the
// new class's tab instead of a stale copy being left behind on the old one.
// No-ops if they were never enrolled (no admission number, so never had a
// row) or Sheets export isn't configured. Never throws.
// ---------------------------------------------------------------------------
export async function removeEnrollmentFromGoogleSheet(
  applicationId: string,
  admissionNumber: string | null,
  sectionId: string | null,
  gradeApplying: string | null,
) {
  if (!config.googleSheets.enabled || !admissionNumber) return;
  const admin = createSupabaseAdminClient();

  try {
    const { data: section } = sectionId
      ? await admin.from("sections").select("grade, name").eq("id", sectionId).maybeSingle()
      : { data: null };
    const tabName = section
      ? sanitizeTabName(`${section.grade}-${section.name}`)
      : sanitizeTabName(gradeApplying ?? "Unassigned");

    const result = await removeEnrollmentRow(admissionNumber, tabName);
    if (!result.ok) {
      console.error("[google-sheets] enrollment row removal failed", result.error);
      await logAudit({
        action: "google_sheets.remove_failed",
        entity: "application",
        entityId: applicationId,
        details: { error: result.error, tab: tabName },
      });
    }
  } catch (err) {
    console.error("[google-sheets] removeEnrollmentFromGoogleSheet threw unexpectedly", err);
  }
}

// Admin "Retry" for erp_status = 'no_mapping' — re-checks the section's ERP
// class name (an admin should have just set it under Admin → Sections) and
// runs the send from scratch.
export async function retryErpSync(appId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  if (!app.admission_number) return; // not actually enrolled yet — nothing to sync
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  if (!parentRow) return;
  await syncEnrollmentToErp(app, parentRow as Parent, app.admission_number);
}

// Admin "Retry" for erp_status = 'send_failed' — a seat was already claimed
// (erp_class_name is set); this must only re-send that same class to the
// ERP, never call claim_erp_seat again, or the student would consume two
// seats in the local tally.
export async function resendErpAdmission(appId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  if (!app.admission_number || !app.erp_class_name) return;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  if (!parentRow) return;
  const parent = parentRow as Parent;
  const { data: studentRow } = await admin
    .from("students")
    .select("*")
    .eq("id", app.student_id)
    .maybeSingle();
  const student = studentRow as Student | null;
  const { academicTermStart } = await getSettings();

  const result = await sendErpAdmission({
    admission_id: app.id,
    student_id: app.admission_number,
    full_name: student?.full_name ?? parent.full_name,
    class_name: app.erp_class_name,
    email: parent.email,
    phone: parent.phone,
    gender: student?.gender ?? null,
    date_of_birth: student?.dob ?? null,
    address: student?.current_address ?? student?.permanent_address ?? null,
    parent_name: parent.full_name,
    parent_phone: parent.phone,
    parent_email: parent.email,
    joining_date: academicTermStart,
  });

  if (!result.ok) {
    console.error("[erp] resend failed", result.error);
    await logAudit({
      action: "erp.send_failed",
      entity: "application",
      entityId: app.id,
      details: { error: result.error, class_name: app.erp_class_name, retry: true },
    });
    return;
  }

  await admin
    .from("applications")
    .update({ erp_status: "synced", erp_student_id: result.erpStudentId, erp_warning: result.warning })
    .eq("id", app.id);
  await logAudit({
    action: "erp.synced",
    entity: "application",
    entityId: app.id,
    details: { class_name: app.erp_class_name, warning: result.warning, retry: true },
  });
}

// Called after an admin transfers an already-enrolled student to a
// different section (Admin -> Sections -> Transfer). The student's ERP class
// mapping is now stale for the OLD section — rather than guessing at
// resending a "class changed" update directly (unverified ERP behavior),
// this re-flags the application as 'no_mapping', the same state a never-
// mapped section produces on first sync. The existing Admin -> ERP "Retry"
// button re-runs syncEnrollmentToErp, which re-reads the section's ERP class
// name fresh from the (now updated) section_id — so it naturally picks up
// the new section's mapping, or re-flags 'no_mapping' again if the new
// section has none, all through the same already-reviewed retry path.
export async function flagErpRecheckAfterTransfer(applicationId: string): Promise<void> {
  if (!config.erp.enabled) return;
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin
    .from("applications")
    .select("admission_number")
    .eq("id", applicationId)
    .maybeSingle();
  if (!appRow?.admission_number) return;

  await admin.from("applications").update({ erp_status: "no_mapping" }).eq("id", applicationId);
  await logAudit({
    action: "erp.recheck_after_transfer",
    entity: "application",
    entityId: applicationId,
    details: {},
  });
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      applicationId,
      event: "ERP_NO_MAPPING",
      subject: "ERP sync needs attention: section transfer",
      body: `${appRow.admission_number} was transferred to a different section — the ERP class needs to be re-verified. Retry under Admin → ERP.`,
    }),
  );
}

// ---------------------------------------------------------------------------
// Push this app's own section (class/division/batch) into the ERP whenever
// one is created or edited — a discrete call per edit, not a poll, per the
// ERP's own instruction. Called from createSection/updateSection after their
// own DB write succeeds; never throws — a section is fully usable in this
// app regardless of whether the ERP mirror call succeeds, matching the same
// "never block the primary action" precedent as Zoom/student sync. Conflicts
// (a name collision the ERP can't resolve on its own) are surfaced to admin
// staff and are never retried automatically — the ERP's own instruction is
// that these need a human to resolve directly in the ERP.
// ---------------------------------------------------------------------------
export type SyncSectionToErpStatus = "synced" | "conflict" | "failed" | "skipped";

export async function syncSectionToErp(section: {
  id: string;
  grade: string;
  name: string;
  batch: string | null;
  capacity: number;
}): Promise<SyncSectionToErpStatus> {
  if (!config.erp.classWebhookEnabled) return "skipped";
  const admin = createSupabaseAdminClient();

  const result = await syncClassToErp({
    external_class_id: section.id,
    class_name: section.grade,
    division: section.name,
    batch: section.batch,
    capacity: section.capacity,
  });

  if (result.ok) {
    await admin
      .from("sections")
      .update({ erp_sync_status: "synced", erp_synced_at: new Date().toISOString() })
      .eq("id", section.id);
    await logAudit({
      action: "erp.section_synced",
      entity: "section",
      entityId: section.id,
      details: { action: result.action },
    });
    return "synced";
  }

  if (result.conflict) {
    await admin.from("sections").update({ erp_sync_status: "conflict" }).eq("id", section.id);
    await logAudit({
      action: "erp.section_conflict",
      entity: "section",
      entityId: section.id,
      details: { raw: result.raw },
    });
    await dispatch(
      fanToStaff(await staffContacts(["admin"]), {
        event: "ERP_SECTION_CONFLICT",
        subject: "ERP class conflict needs manual resolution",
        body: `${section.grade}-${section.name}${section.batch ? ` (${section.batch})` : ""} couldn't sync to the ERP — a name collision needs to be resolved directly in the ERP (not something this app can retry automatically).`,
      }),
    );
    return "conflict";
  }

  console.error("[erp] section sync failed", result.error);
  await admin.from("sections").update({ erp_sync_status: "failed" }).eq("id", section.id);
  await logAudit({
    action: "erp.section_send_failed",
    entity: "section",
    entityId: section.id,
    details: { error: result.error },
  });
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      event: "ERP_SECTION_FAILED",
      subject: "ERP class sync failed",
      body: `${section.grade}-${section.name}${section.batch ? ` (${section.batch})` : ""} couldn't sync to the ERP. Editing the section again will retry.`,
    }),
  );
  return "failed";
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

  // N-7 payment receipt + admin; N-8 welcome + onboarding + class teacher.
  // Itemized from the actual completed payment row (not current settings),
  // since the parent may have chosen to include study material or not, and
  // fees can change later — this reflects what was actually charged.
  const { data: payRow } = await admin
    .from("payments")
    .select("admission_amount, study_material_amount, includes_study_material")
    .eq("application_id", app.id)
    .eq("includes_admission", true)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const admissionAmount = payRow?.admission_amount ?? 0;
  const studyMaterialAmount = payRow?.includes_study_material ? payRow.study_material_amount ?? 0 : 0;
  const totalPaid = admissionAmount + studyMaterialAmount;
  const receiptBody =
    `Hello ${parent.full_name},\n\n` +
    `We have received your payment of ${formatINR(totalPaid)}:\n` +
    `- Admission fee: ${formatINR(admissionAmount)}\n` +
    (studyMaterialAmount > 0 ? `- Study material: ${formatINR(studyMaterialAmount)}\n` : "") +
    `\nA receipt is available in your portal: ${applyUrl(app.access_token)}`;

  const receiptUrl = `${config.appUrl}/api/receipt/${app.access_token}`;
  const receiptMessages = sendReceipt
    ? [
        ...multiChannel(
          {
            applicationId: app.id,
            event: "N-7",
            subject: "Payment received",
            body: receiptBody,
            whatsappTemplate: {
              name: "payment_received",
              params: [parent.full_name, formatINR(totalPaid), receiptUrl],
            },
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
        whatsappTemplate: {
          name: "admission_confirmed",
          params: [parent.full_name, res.admission_number ?? "—", res.section ?? "—", applyUrl(app.access_token)],
        },
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
  await syncEnrollmentToErp(app, parent, res.admission_number!);
  await syncEnrollmentToGoogleSheet(app, parent, res.admission_number!);
  return { ...res, status: "ENROLLED" as const };
}

// ---------------------------------------------------------------------------
// Study material fee paid — either alongside the main admission payment or,
// if the parent declined it then, separately afterward from their portal.
// The application is already ENROLLED by this point, so this only notifies;
// it never touches application status or re-runs enrollment.
// ---------------------------------------------------------------------------
export async function handleStudyMaterialPaymentCompleted(applicationId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", applicationId).single();
  const app = appRow as Application;
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).single();
  const parent = parentRow as Parent;
  const { data: payRow } = await admin
    .from("payments")
    .select("study_material_amount")
    .eq("application_id", applicationId)
    .eq("includes_study_material", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const amount = (payRow?.study_material_amount as number | undefined) ?? 0;

  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-11",
        subject: "Study material payment received",
        body: `Hello ${parent.full_name},\n\nWe have received your study material payment of ${formatINR(amount)}. A receipt is available in your portal: ${applyUrl(app.access_token)}`,
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "N-11",
      subject: "Study material payment received",
      body: `Study material fee (${formatINR(amount)}) received for admission no. ${app.admission_number ?? app.id}.`,
    }),
  ]);
}
