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
import {
  sendBroadwayAdmission,
  changeBroadwaySection,
  pushBroadwaySection,
  pushBroadwaySections,
  isNextYearAdmission,
} from "@/lib/broadway";
import { appendEnrollmentRow, removeEnrollmentRow, sanitizeTabName } from "@/lib/google-sheets";
import { needsAssessment } from "@/lib/assessment";
import { fetchSchoolLogo } from "@/lib/school-logo";
import {
  outcomeLabel,
  leadSourceLabel,
  type Application,
  type Parent,
  type Payment,
  type Student,
  type SubjectResult,
} from "@/lib/types";

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
    .in("role", roles)
    .eq("notify_broadcasts", true);
  return (data ?? []).map((u) => ({ email: u.email, phone: u.phone }));
}

// Every lead is created by a marketing staff member (applications.created_by)
// — parent-facing messages point back to that specific person rather than a
// generic school line, since they're who actually knows this lead's
// context. Falls back to the general school contact if the lead has no
// recorded creator, or that staff member has no phone on file.
async function leadCreatorContact(app: Application): Promise<{ name: string; phone: string }> {
  const admin = createSupabaseAdminClient();
  if (app.created_by) {
    const { data: creator } = await admin
      .from("users")
      .select("full_name, phone")
      .eq("id", app.created_by)
      .maybeSingle();
    if (creator?.phone) {
      return { name: creator.full_name, phone: creator.phone };
    }
  }
  const { schoolName, schoolPhone } = await getSettings();
  return { name: `the ${schoolName} team`, phone: schoolPhone };
}

// Student name, for staff messages — a teacher/admin juggling several
// applicants can't identify which one a generic "Grade G4 applicant" message
// is about. Before Stage 2, the students row doesn't exist yet, so
// lead_student_name (captured at Stage 1) is the fallback; once it does,
// that's authoritative (a parent can edit the name after Stage 1).
async function studentLabel(app: Application): Promise<string> {
  if (app.student_id) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin.from("students").select("full_name").eq("id", app.student_id).maybeSingle();
    if (data?.full_name) return data.full_name;
  }
  return app.lead_student_name ?? "the student";
}

// Prefixed onto every staff-facing (admin/teacher) body below that has a
// specific application in scope, so a WhatsApp message alone is enough to
// identify who it's about — never just "Grade G4 applicant".
function staffContextLine(studentName: string, parentName: string): string {
  return `Student: ${studentName} | Parent: ${parentName}. `;
}

// Which (channel, recipient) pairs already have a recorded "sent" row for
// this application+event — lets a resumed call (handlePaymentCompleted can
// be interrupted mid-dispatch, e.g. by a proxy timeout) skip whatever
// already went out while still delivering whatever didn't, instead of
// either re-sending everything or silently giving up on the rest.
async function alreadySentPairs(applicationId: string, event: string): Promise<Set<string>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("channel, recipient")
    .eq("application_id", applicationId)
    .eq("event", event)
    .eq("status", "sent");
  return new Set((data ?? []).map((r) => `${r.channel}|${r.recipient}`));
}

function excludeAlreadySent(messages: OutboundMessage[], sent: Set<string>): OutboundMessage[] {
  return messages.filter((m) => !sent.has(`${m.channel}|${m.recipient}`));
}

// Convenience wrapper around studentLabel + a parent lookup, for call sites
// that only have the Application row in hand and want the standard "Student:
// X | Parent: Y. " prefix. Returns "" if the parent row can't be found.
async function applicationContext(app: Application): Promise<string> {
  const admin = createSupabaseAdminClient();
  const { data: parentRow } = await admin.from("parents").select("full_name").eq("id", app.parent_id).maybeSingle();
  if (!parentRow?.full_name) return "";
  return staffContextLine(await studentLabel(app), parentRow.full_name);
}

// Every staff-facing WhatsApp send reuses the one generic approved template
// (staff_alert_v6, confirmed APPROVED + still category UTILITY): {{1}} a
// short reference, {{2}} the detail — the subject/body pair every call site
// already provides fits this directly, so no per-event template is needed
// for internal alerts. v2 said "Open the admin portal", wrong for
// teacher-only events like a slot assignment; v3's reword ("Check your
// dashboard for details") got auto-reclassified from Utility to Marketing by
// Meta's classifier. v4 kept v2's exact proven-Utility structure with a
// role-neutral CTA, but crammed {{1}} and {{2}} into one run-on sentence
// ("Admission record update for {{1}}. Status: {{2}}.") — unreadable once
// {{2}} carries real content. v5 tried fixing that by cutting the fixed
// wording down to "🔔 {{1}}\n\n{{2}}\n\n..." — Meta's classifier
// reclassified it Utility -> Marketing, same failure as v3 (too little fixed
// transactional wording, too generic). v6 keeps v4's exact proven-Utility
// sentences verbatim, only replacing the spaces between them with paragraph
// breaks (a template parameter still can't contain a newline itself, so this
// is a fixed-text-only change).
//
// IMPORTANT: never point this at a new template name before independently
// confirming via GET /{template-id}?fields=name,status,category with
// WHATSAPP_TOKEN that it's both APPROVED and still category UTILITY — the
// WhatsApp Manager UI's own status badge is not sufficient proof (it showed
// v5 as fine before the reclassification notice appeared). Pointing this at
// v6 before that confirmation landed broke every real staff WhatsApp alert
// in production for about half an hour, because local dev shares the same
// live WhatsApp credentials as production — an "uncommitted, not pushed"
// code change is NOT safe here the way it is for the database.
//
// Freeform text only delivers within a 24h
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
    { ...base, whatsappTemplate: { name: "staff_alert_v6", params: [base.subject ?? base.event, detail] } },
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

// Keeps the specific marketing staff member who created a lead in the loop
// on that lead's own progress through the funnel — until now their only
// role was creating it; they had zero visibility afterward, even though
// they're often the person a parent calls back with questions. Returns []
// (composes into an existing messages array like fanToStaff) when the lead
// has no recorded creator or that account has neither contact method.
async function notifyLeadCreator(
  app: Application,
  base: Omit<OutboundMessage, "channel" | "recipient">,
): Promise<OutboundMessage[]> {
  if (!app.created_by) return [];
  const admin = createSupabaseAdminClient();
  const { data: creator } = await admin
    .from("users")
    .select("email, phone")
    .eq("id", app.created_by)
    .maybeSingle();
  if (!creator || (!creator.email && !creator.phone)) return [];
  return toStaffMember({ email: creator.email, phone: creator.phone }, base);
}

// ---------------------------------------------------------------------------
// N-1 Lead created — admission link to parent
// ---------------------------------------------------------------------------
export async function notifyLeadCreated(app: Application, parent: Parent) {
  const link = applyUrl(app.access_token);
  const expiry = new Date(app.token_expires_at).toDateString();
  const contact = await leadCreatorContact(app);
  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "N-1",
        subject: "Complete your school admission",
        body:
          `Hello ${parent.full_name},\n\nPlease complete the admission form using your secure link:\n${link}\n\n` +
          `This link expires on ${expiry}.\n\nQuestions? Contact ${contact.name} at ${contact.phone}.`,
        whatsappTemplate: {
          name: "admission_link_v3",
          params: [parent.full_name, link, expiry, contact.name, contact.phone],
        },
      },
      parent,
    ),
  );
}

// ---------------------------------------------------------------------------
// Inbound Instagram DM from an unrecognized sender — captured as an
// unclaimed lead (created_by null) for any marketing team member to pick up
// via claim_lead. No N-1 admission link goes out yet: there's no phone/email
// to send it to until a rep gets the parent's number from the DM
// conversation and submits it via addContactInfo.
// ---------------------------------------------------------------------------
type SocialPlatform = "instagram" | "facebook";

const SOCIAL_MESSAGES_TABLE: Record<SocialPlatform, "instagram_messages" | "facebook_messages"> = {
  instagram: "instagram_messages",
  facebook: "facebook_messages",
};

// Shared by handleInboundInstagramMessage/handleInboundFacebookMessage below
// — same lead-creation/existing-sender/dismissed-revival logic either way,
// parameterized only on which messages table to write to and which
// lead_source value a brand-new lead gets.
async function handleInboundSocialMessage(
  platform: SocialPlatform,
  contactId: string,
  profile: { name?: string | null; username?: string | null },
  messageText?: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const text = messageText?.trim() || null;
  const messagesTable = SOCIAL_MESSAGES_TABLE[platform];

  // Already-known sender (any status) — an ordinary reply in an existing
  // conversation, not a new lead. Also makes a duplicate webhook delivery of
  // the same message a no-op (no second row gets inserted below either,
  // since there's nothing keying a dedup off provider_message_id here —
  // acceptable: a genuine duplicate delivery re-showing one message in the
  // thread is a cosmetic, rare edge case, not a functional problem).
  const { data: existing } = await admin
    .from("applications")
    .select("id, created_by, parent_id, dismissed_at")
    .eq("external_contact_id", contactId)
    .maybeSingle();
  if (existing) {
    await admin.from(messagesTable).insert({
      application_id: existing.id,
      direction: "inbound",
      message_text: text ?? "(no message text)",
    });
    // A dismissed, still-unclaimed enquiry that writes again is live again —
    // put it back in the pool and tell the team, rather than losing the
    // parent's new message in a thread nobody is watching.
    if (existing.dismissed_at && !existing.created_by) {
      const { data: revived } = await admin
        .from("applications")
        .update({ dismissed_at: null, dismissed_by: null })
        .eq("id", existing.id)
        .select("*")
        .maybeSingle();
      const { data: parentRow } = await admin.from("parents").select("*").eq("id", existing.parent_id).maybeSingle();
      if (revived && parentRow) await notifyNewUnclaimedLead(revived as Application, parentRow as Parent);
      return;
    }
    // Only ping the owning rep once someone's actually claimed it — before
    // that, notifyNewUnclaimedLead already fired on the first message, and
    // repeat pings to every marketing member on each follow-up would just
    // be noise. The message is still saved either way.
    if (existing.created_by) {
      const { data: parentRow } = await admin
        .from("parents")
        .select("*")
        .eq("id", existing.parent_id)
        .maybeSingle();
      if (parentRow) {
        await notifyNewSocialMessage(platform, existing.created_by, existing.id, parentRow as Parent, text);
      }
    }
    return;
  }

  const displayName = profile.name?.trim() || profile.username?.trim() || `${leadSourceLabel(platform)} enquiry`;
  const { data: parent, error: pErr } = await admin
    .from("parents")
    .insert({ full_name: displayName, phone: null, email: null })
    .select("*")
    .single();
  if (pErr || !parent) {
    console.error(`[workflow] failed to create parent for inbound ${platform} DM`, pErr);
    return;
  }

  const { data: app, error: aErr } = await admin
    .from("applications")
    .insert({
      parent_id: parent.id,
      status: "LEAD_CREATED",
      lead_source: platform,
      lead_source_other: profile.username ? `@${profile.username}` : null,
      lead_message: text,
      external_contact_id: contactId,
      created_by: null,
    })
    .select("*")
    .single();
  if (aErr || !app) {
    console.error(`[workflow] failed to create application for inbound ${platform} DM`, aErr);
    return;
  }

  await admin.from(messagesTable).insert({
    application_id: app.id,
    direction: "inbound",
    message_text: text ?? "(no message text)",
  });

  await notifyNewUnclaimedLead(app as Application, parent as Parent);
}

// A new unclaimed lead came in via Instagram DM — for any marketing team
// member to pick up via claim_lead. No N-1 admission link goes out yet:
// there's no phone/email to send it to until a rep gets the parent's number
// from the DM conversation and submits it via addContactInfo.
export async function handleInboundInstagramMessage(
  igsid: string,
  profile: { name?: string | null; username?: string | null },
  messageText?: string | null,
): Promise<void> {
  return handleInboundSocialMessage("instagram", igsid, profile, messageText);
}

// Same as handleInboundInstagramMessage, for a Facebook Page Messenger DM.
export async function handleInboundFacebookMessage(
  psid: string,
  profile: { name?: string | null; username?: string | null },
  messageText?: string | null,
): Promise<void> {
  return handleInboundSocialMessage("facebook", psid, profile, messageText);
}

// Shared by recordInstagramEcho/recordFacebookEcho below — a reply typed
// directly in the native app (not through this app) reaches us as a webhook
// "echo". Recorded into the same thread so the history is complete and the
// unclaimed pool can show the enquiry was already answered. Never creates a
// lead: an echo to someone we have no record of is ignored.
async function recordSocialEcho(
  platform: SocialPlatform,
  recipientContactId: string,
  messageId: string | null,
  text: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const messagesTable = SOCIAL_MESSAGES_TABLE[platform];
  const { data: app } = await admin
    .from("applications")
    .select("id")
    .eq("external_contact_id", recipientContactId)
    .maybeSingle();
  if (!app) return;

  // Already saved — this app's own reply also echoes back through here.
  if (messageId) {
    const { data: dup } = await admin
      .from(messagesTable)
      .select("id")
      .eq("provider_message_id", messageId)
      .maybeSingle();
    if (dup) return;
  }
  // Belt-and-braces for the same case if the ids ever don't line up: an
  // identical reply sent from this app in the last couple of minutes.
  const since = new Date(Date.now() - 2 * 60_000).toISOString();
  const { data: recent } = await admin
    .from(messagesTable)
    .select("id")
    .eq("application_id", app.id)
    .eq("direction", "outbound")
    .eq("message_text", text)
    .not("sent_by", "is", null)
    .gte("created_at", since)
    .limit(1);
  if (recent && recent.length > 0) return;

  const { error } = await admin.from(messagesTable).insert({
    application_id: app.id,
    direction: "outbound",
    message_text: text,
    provider_message_id: messageId,
    sent_by: null,
  });
  if (error) console.error(`[workflow] failed to record ${platform} echo`, error);
}

export async function recordInstagramEcho(recipientIgsid: string, messageId: string | null, text: string): Promise<void> {
  return recordSocialEcho("instagram", recipientIgsid, messageId, text);
}

export async function recordFacebookEcho(recipientPsid: string, messageId: string | null, text: string): Promise<void> {
  return recordSocialEcho("facebook", recipientPsid, messageId, text);
}

// A new message arrived on an already-claimed social DM thread — let the
// owning rep know, mirroring notifyLeadCreator's single-recipient shape
// (src/lib/workflow.ts:119): resolve the one owner, send directly to them.
async function notifyNewSocialMessage(
  platform: SocialPlatform,
  ownerId: string,
  applicationId: string,
  parent: Parent,
  messageText: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: owner } = await admin.from("users").select("email, phone").eq("id", ownerId).maybeSingle();
  if (!owner || (!owner.email && !owner.phone)) return;
  const quoted = messageText ? `: "${messageText}"` : "";
  const source = leadSourceLabel(platform);
  await dispatch(
    toStaffMember(
      { email: owner.email, phone: owner.phone },
      {
        applicationId,
        event: platform === "instagram" ? "IG_NEW_MESSAGE" : "FB_NEW_MESSAGE",
        subject: `New message from your ${source} lead`,
        body: `${parent.full_name} sent a new message on ${source}${quoted}`,
      },
    ),
  );
}

// A new unclaimed inbound lead is ready to be picked up — mirrors
// notifyOpenSlotAvailable's fan-out shape for the teacher slot pool.
async function notifyNewUnclaimedLead(app: Application, parent: Parent): Promise<void> {
  const source = leadSourceLabel(app.lead_source, app.lead_source_other);
  const quoted = app.lead_message ? ` They wrote: "${app.lead_message}".` : "";
  await dispatch(
    fanToStaff(await staffContacts(["marketing"]), {
      applicationId: app.id,
      event: "UNCLAIMED_LEAD",
      subject: "New enquiry — claim it",
      body: `${parent.full_name} enquired via ${source}.${quoted} Claim it on your Leads page before someone else does.`,
    }),
  );
}

// A marketing team member claimed an unclaimed lead — let admins know who
// has it, mirroring notifySlotClaimed's admin-visibility shape.
export async function notifyLeadClaimed(userId: string, app: Application, parent: Parent): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: u } = await admin.from("users").select("full_name, email").eq("id", userId).maybeSingle();
  const source = leadSourceLabel(app.lead_source, app.lead_source_other);
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "LEAD_CLAIMED",
      subject: "Enquiry claimed",
      body: `${u?.full_name ?? u?.email ?? "A team member"} claimed the ${source} enquiry from ${parent.full_name}.`,
    }),
  );
}

// A refund has no verified-webhook signal of its own (Razorpay refunds are
// staff-triggered from /admin/payments, not something the parent's gateway
// flow reports back) — so the rep who owns this lead only finds out if we
// tell them directly here.
export async function notifyPaymentRefunded(app: Application, parent: Parent, payment: Payment): Promise<void> {
  await dispatch(
    await notifyLeadCreator(app, {
      applicationId: app.id,
      event: "PAYMENT_REFUNDED",
      subject: "Payment refunded",
      body: `A refund of ${formatINR(payment.amount)} was processed for ${parent.full_name}'s payment.${payment.refund_reason ? ` Reason: ${payment.refund_reason}.` : ""}`,
    }),
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
export async function sendAgreement(app: Application, parent: Parent, curriculum?: string | null) {
  const portal = applyUrl(app.access_token);
  const [{ feePaise }, studyMaterialFeePaise] = await Promise.all([
    getSettings(),
    getStudyMaterialFeeForGrade(app.grade_applying, curriculum ?? app.preferred_curriculum),
  ]);
  const studyMaterialLine =
    studyMaterialFeePaise > 0
      ? `\nStudy material (optional, can also be paid later): ${formatINR(studyMaterialFeePaise)}`
      : "";
  const contact = await leadCreatorContact(app);
  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-6",
        subject: "Admission agreement & payment",
        body:
          `Hello ${parent.full_name},\n\nCongratulations! Your admission agreement is ready.\nReview the agreement and complete your payment here:\n${portal}\n\n` +
          `Admission fee: ${formatINR(feePaise)}${studyMaterialLine}\n\n(You can read the full agreement on that page before paying.)\n\n` +
          `Questions? Contact ${contact.name} at ${contact.phone}.`,
        whatsappTemplate: {
          name: "agreement_ready_v2",
          params: [
            parent.full_name,
            app.grade_applying ?? app.category ?? "your child",
            formatINR(feePaise),
            portal,
            contact.name,
            contact.phone,
          ],
        },
      },
      parent,
    ),
    ...(await notifyLeadCreator(app, {
      applicationId: app.id,
      event: "N-6",
      subject: "Your lead's admission agreement is ready",
      body: `${staffContextLine(await studentLabel(app), parent.full_name)}Agreement sent, admission fee ${formatINR(feePaise)}.`,
    })),
  ]);
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

  const context = staffContextLine(await studentLabel(app), parent.full_name);

  if (!needsAssessment(app.grade_applying ?? "")) {
    // KG 1: never has an assessment, so the remaining-details form unlocks
    // immediately rather than waiting on anything.
    messages.push(
      ...fanToStaff(await staffContacts(["admin"]), {
        applicationId: app.id,
        event: "N-2",
        subject: "New KG application",
        body: `${context}A new KG application was submitted for review.`,
      }),
      ...(await notifyLeadCreator(app, {
        applicationId: app.id,
        event: "N-2",
        subject: "Your lead submitted their form",
        body: `${context}Their KG application was just submitted for review.`,
      })),
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
        body: `${context}A new Grade applicant (${app.grade_applying}) requires an assessment. Please create and assign a slot.`,
      }),
      ...(await notifyLeadCreator(app, {
        applicationId: app.id,
        event: "N-2",
        subject: "Your lead submitted their form",
        body: `${context}Their Grade ${app.grade_applying} application was just submitted — an assessment will be scheduled.`,
      })),
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

  const context = staffContextLine(await studentLabel(app), parent.full_name);

  // Teacher + lead-creator names, so the staff alerts below can name both
  // sides to each other — marketing sees who's teaching it, the teacher sees
  // who to ask about the applicant — instead of leaving either to go look it
  // up on a dashboard.
  const [{ data: teacherRow }, { data: creatorRow }] = await Promise.all([
    slotInfo.teacher_id
      ? admin.from("users").select("full_name, email, phone").eq("id", slotInfo.teacher_id).maybeSingle()
      : Promise.resolve({ data: null }),
    app.created_by
      ? admin.from("users").select("full_name, email, phone").eq("id", app.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const teacherName = teacherRow?.full_name ?? teacherRow?.email ?? null;
  const teacherNameWithPhone = teacherName
    ? `${teacherName}${teacherRow?.phone ? ` (${teacherRow.phone})` : ""}`
    : null;
  const creatorName = creatorRow?.full_name ?? creatorRow?.email ?? null;
  const creatorNameWithPhone = creatorName
    ? `${creatorName}${creatorRow?.phone ? ` (${creatorRow.phone})` : ""}`
    : null;

  // If Zoom is genuinely configured but the create call still failed (a
  // real per-teacher or transient Zoom-side problem), staff need to know
  // right away — otherwise this is only ever discovered by chance, by
  // someone noticing a "Generate Zoom link" button on the admin dashboard
  // days later. No alert when Zoom simply isn't configured at all (that's
  // an expected/known state, not a failure).
  const zoomCreationFailed = config.zoom.enabled && !meeting;
  const zoomFailureAlert: OutboundMessage[] = zoomCreationFailed
    ? [
        ...fanToStaff(await staffContacts(["admin", "coo"]), {
          applicationId: app.id,
          event: "ZOOM_CREATE_FAILED",
          subject: "Zoom link failed to generate for a booked assessment",
          body: `${context}An assessment was booked for ${when}, but the Zoom meeting could not be created automatically. Use "Generate Zoom link" on this application in Admin → Assessments once the issue is resolved.`,
        }),
        ...(await notifyLeadCreator(app, {
          applicationId: app.id,
          event: "ZOOM_CREATE_FAILED",
          subject: "Zoom link didn't generate for your lead's assessment",
          body: `${context}Their assessment is booked for ${when}, but the Zoom link needs to be generated manually — admin has been notified.`,
        })),
      ]
    : [];

  const messages: OutboundMessage[] = [
    ...zoomFailureAlert,
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
      body: `${context}An assessment slot was booked for ${when} (Grade ${app.grade_applying})${
        teacherNameWithPhone ? ` with ${teacherNameWithPhone}` : ""
      }.`,
    }),
    ...(await notifyLeadCreator(app, {
      applicationId: app.id,
      event: "N-4",
      subject: "Your lead booked an assessment slot",
      body: `${context}Their assessment is booked for ${when}${
        teacherNameWithPhone ? ` with ${teacherNameWithPhone}` : ""
      }.`,
    })),
  ];

  // Notify the assigned teacher specifically.
  if (slotInfo.teacher_id && teacherRow) {
    messages.push(
      ...toStaffMember(
        { email: teacherRow.email, phone: teacherRow.phone },
        {
          applicationId: app.id,
          event: "N-4",
          subject: "Assessment booked for your slot",
          body: `${context}A parent booked your assessment slot on ${when} (Grade ${app.grade_applying}).${
            creatorNameWithPhone ? ` Lead created by: ${creatorNameWithPhone}.` : ""
          }${hostLine}${
            zoomCreationFailed
              ? "\n\nThe Zoom meeting couldn't be created automatically — admin has been notified and will generate it."
              : ""
          }`,
        },
      ),
    );
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
  const context = staffContextLine(await studentLabel(app), parent.full_name);

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
            body: `${context}The Zoom meeting for your assessment on ${when} (Grade ${app.grade_applying}) is ready.\n\nStart as host:\n${meeting.startUrl}`,
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
// the parent and the assigned teacher. Re-runs ensureZoomForApplication
// (idempotent — returns the existing meeting if one's already there) so a
// slot whose Zoom creation failed back at booking time gets one more chance
// to generate a real link before this, its last scheduled message, goes out.
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

  const meeting = await ensureZoomForApplication(app.id);
  const zoomJoinUrl = meeting?.joinUrl ?? slot.zoom_join_url;
  const zoomPasscode = meeting?.passcode ?? slot.zoom_passcode;
  const zoomStartUrl = meeting?.startUrl ?? slot.zoom_start_url;

  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const joinLine = zoomJoinUrl
    ? `\n\nJoin here:\n${zoomJoinUrl}${zoomPasscode ? `\nPasscode: ${zoomPasscode}` : ""}`
    : "";
  const contact = await leadCreatorContact(app);
  const context = staffContextLine(await studentLabel(app), parent.full_name);

  // Last chance before the assessment actually happens — if there's still
  // no Zoom link at this point, staff need to know right now, not whenever
  // someone happens to notice.
  const zoomStillMissing = config.zoom.enabled && !zoomJoinUrl;
  const zoomFailureAlert: OutboundMessage[] = zoomStillMissing
    ? [
        ...fanToStaff(await staffContacts(["admin", "coo"]), {
          applicationId: app.id,
          event: "ZOOM_CREATE_FAILED",
          subject: "URGENT — Zoom link still missing, assessment in 10 minutes",
          body: `${context}Assessment at ${when} still has no Zoom link. Generate one now from Admin → Assessments, or contact the parent directly.`,
        }),
      ]
    : [];

  const messages: OutboundMessage[] = [
    ...zoomFailureAlert,
    ...multiChannel(
      {
        applicationId: app.id,
        event: "ASSESSMENT_REMINDER",
        subject: "Your assessment starts in 10 minutes",
        body:
          `Hello ${parent.full_name},\n\nYour assessment starts in 10 minutes, at ${when}.${joinLine}\n\n` +
          `Questions? Contact ${contact.name} at ${contact.phone}.`,
        // v1 put the raw Zoom link straight in the template and only
        // attached it when zoom_join_url existed — real slots without Zoom
        // set up (confirmed happens) silently fell back to unreliable
        // freeform text. v2 points to the portal link instead (which the
        // ZoomLinkGate there already resolves once Zoom is ready), so it
        // works unconditionally regardless of Zoom's state. v3 (this one)
        // adds the lead creator's contact — v2 was still Pending review, so
        // redesigning it once more here costs nothing extra.
        whatsappTemplate: {
          name: "assessment_starting_soon_v3",
          params: [parent.full_name, "10 minutes", when, applyUrl(app.access_token), contact.name, contact.phone],
        },
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
      const hostLine = zoomStartUrl ? `\n\nStart as host:\n${zoomStartUrl}` : "";
      messages.push(
        ...toStaffMember(
          { email: t.email, phone: t.phone },
          {
            applicationId: app.id,
            event: "ASSESSMENT_REMINDER",
            subject: "Your assessment starts in 10 minutes",
            body: `${context}Your assessment${app.grade_applying ? ` with a Grade ${app.grade_applying} applicant` : ""} starts in 10 minutes, at ${when}.${hostLine}`,
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

export async function notifyAssessmentReminder2h(slot: { application_id: string; starts_at: string }) {
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
  // The configured lead time (assessmentReminder2hMinutes) only decides the
  // cron's polling WINDOW — how far ahead it starts looking for slots to
  // remind. It is NOT how far away the slot actually is: a slot booked with
  // less notice than that window (e.g. a same-day booking) can be due in a
  // fraction of the configured time, and the message must say so honestly
  // instead of repeating the configured value verbatim.
  const actualMinutesRemaining = Math.max(
    0,
    Math.round((new Date(slot.starts_at).getTime() - Date.now()) / 60_000),
  );
  const lead = formatLeadTime(actualMinutesRemaining);
  const contact = await leadCreatorContact(app);

  await dispatch(
    multiChannel(
      {
        applicationId: app.id,
        event: "ASSESSMENT_REMINDER_2H",
        subject: `Your assessment is in ${lead}`,
        body:
          `Hello ${parent.full_name},\n\nYour assessment is coming up in ${lead}, at ${when}.\n\n` +
          `Please confirm you'll attend:\n${confirmUrl}\n\n` +
          `Need to reschedule instead? Visit your portal and release your slot to pick a new time:\n${rescheduleUrl}\n\n` +
          `Questions? Contact ${contact.name} at ${contact.phone}.`,
        // WhatsApp still uses the old template/params — swapped once the
        whatsappTemplate: {
          name: "assessment_reminder_v2",
          params: [parent.full_name, lead, when, confirmUrl, rescheduleUrl, contact.name, contact.phone],
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
  const context = staffContextLine(await studentLabel(app), who);

  const messages: OutboundMessage[] = [
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "ASSESSMENT_CONFIRMED",
      subject: "Parent confirmed attendance",
      body: `${context}${who} confirmed they'll attend the ${when} assessment (Grade ${app.grade_applying ?? "—"}).`,
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
            body: `${context}${who} confirmed they'll attend your ${when} assessment.`,
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
  const who = parent?.full_name ?? "A parent";
  const context = staffContextLine(await studentLabel(app), who);
  const messages: OutboundMessage[] = [
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "ASSESSMENT_RESCHEDULED",
      subject: "Assessment rescheduled by parent",
      body: `${context}${who} released their ${when} slot to pick a new time (Grade ${app.grade_applying ?? "—"}).`,
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
            body: `${context}Your ${when} assessment slot was released by the parent and is open again.`,
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
// A teacher reported they can't attend a booked assessment — admin/COO need
// to reassign it, and the marketing rep who owns the lead (notifyLeadCreator)
// should know too, since they're often who the parent calls with questions.
// Every message here names the teacher, student, and parent — whoever reads
// it needs to know exactly who's affected without digging through the
// dashboard first.
// ---------------------------------------------------------------------------
export async function notifyTeacherUnavailable(
  teacherId: string,
  slot: { starts_at: string; applicationId: string },
) {
  const admin = createSupabaseAdminClient();
  const [{ data: t }, { data: appRow }] = await Promise.all([
    admin.from("users").select("full_name, email").eq("id", teacherId).maybeSingle(),
    admin.from("applications").select("*").eq("id", slot.applicationId).maybeSingle(),
  ]);
  const app = appRow as Application | null;
  const context = app ? await applicationContext(app) : "";
  const teacherName = t?.full_name ?? t?.email ?? "A teacher";
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const body = `${context}${teacherName} reported they can't attend this assessment on ${when}. Please reassign it to another teacher.`;

  const messages: OutboundMessage[] = [
    ...fanToStaff(await staffContacts(["admin", "coo"]), {
      event: "SLOT_UNAVAILABLE",
      subject: "Teacher unavailable — assessment needs reassignment",
      body,
    }),
  ];
  if (app) {
    messages.push(
      ...(await notifyLeadCreator(app, {
        applicationId: app.id,
        event: "SLOT_UNAVAILABLE",
        subject: "Your lead's assessment teacher can't attend",
        body,
      })),
    );
  }
  await dispatch(messages);
}

// A "can't attend" report that nobody reassigned in time — re-alert admin/COO
// (and marketing) so a parent's booking doesn't just sit unassigned
// indefinitely. Triggered by the cron pass in /api/cron/assessment-reminders;
// resets the moment reassignSlotTeacher actually reassigns the slot (see
// admin/actions.ts).
export async function notifyUnavailableSlotEscalation(slot: {
  id: string;
  teacher_id: string | null;
  starts_at: string;
  application_id: string;
  hoursSinceReported: number;
}) {
  const admin = createSupabaseAdminClient();
  const [{ data: t }, { data: appRow }] = await Promise.all([
    slot.teacher_id
      ? admin.from("users").select("full_name, email").eq("id", slot.teacher_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("applications").select("*").eq("id", slot.application_id).maybeSingle(),
  ]);
  const app = appRow as Application | null;
  const context = app ? await applicationContext(app) : "";
  const teacherName = t?.full_name ?? t?.email ?? "A teacher";
  const when = `${formatInZone(slot.starts_at, config.school.timezone)} ${config.school.timezoneLabel}`;
  const body = `${context}${teacherName} reported they can't attend this assessment on ${when}, and it's been over ${slot.hoursSinceReported} hours with no reassignment. Please reassign it now.`;

  const messages: OutboundMessage[] = [
    ...fanToStaff(await staffContacts(["admin", "coo"]), {
      event: "SLOT_UNAVAILABLE_ESCALATED",
      subject: "STILL UNASSIGNED — assessment needs a teacher",
      body,
    }),
  ];
  if (app) {
    messages.push(
      ...(await notifyLeadCreator(app, {
        applicationId: app.id,
        event: "SLOT_UNAVAILABLE_ESCALATED",
        subject: "Your lead's assessment is still unassigned",
        body,
      })),
    );
  }
  await dispatch(messages);
  await logAudit({
    action: "assessment.unavailable_escalated",
    entity: "assessment_slot",
    entityId: slot.id,
    details: { hoursSinceReported: slot.hoursSinceReported },
  });
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

  // Fetched up front (not just inside the applicationId branch below) so the
  // outgoing/incoming teacher messages can name the student too, not just
  // the eventual parent confirmation.
  let app: Application | null = null;
  let parent: Parent | null = null;
  if (input.applicationId) {
    const { data: appRow } = await admin.from("applications").select("*").eq("id", input.applicationId).single();
    app = appRow as Application;
    const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).single();
    parent = parentRow as Parent;
  }
  const context = app && parent ? staffContextLine(await studentLabel(app), parent.full_name) : "";

  const messages: OutboundMessage[] = [];
  let oldTeacherName: string | null = null;

  if (input.oldTeacherId) {
    const { data: old } = await admin
      .from("users")
      .select("full_name, email, phone")
      .eq("id", input.oldTeacherId)
      .maybeSingle();
    if (old) {
      oldTeacherName = old.full_name ?? old.email;
      messages.push(
        ...toStaffMember(
          { email: old.email, phone: old.phone },
          {
            event: "SLOT_REASSIGNED",
            subject: "Assessment reassigned away from you",
            body: `${context}Your assessment on ${when} has been reassigned to another teacher. It's been removed from your dashboard.`,
          },
        ),
      );
    }
  }

  const { data: newT } = await admin
    .from("users")
    .select("full_name, email, phone")
    .eq("id", input.newTeacherId)
    .maybeSingle();
  const newTeacherName = newT?.full_name ?? newT?.email ?? "another teacher";
  if (newT) {
    messages.push(
      ...toStaffMember(
        { email: newT.email, phone: newT.phone },
        {
          event: "SLOT_REASSIGNED",
          subject: "Assessment reassigned to you",
          body: `${context}An assessment on ${when} has been reassigned to you. Check your dashboard for details.`,
        },
      ),
    );
  }

  if (app) {
    messages.push(
      ...(await notifyLeadCreator(app, {
        applicationId: app.id,
        event: "SLOT_REASSIGNED",
        subject: "Your lead's assessment teacher has changed",
        body: `${context}The assessment on ${when} has been reassigned${oldTeacherName ? ` from ${oldTeacherName}` : ""} to ${newTeacherName}.`,
      })),
    );
  }

  if (app && parent) {
    // Regenerate the Zoom meeting under the new teacher before notifying the
    // parent, so the confirmation carries a working link.
    const meeting = await ensureZoomForApplication(input.applicationId!);
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
  const contact = await leadCreatorContact(app);
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
    `Your child's assessment result is: ${outcomeLabel(outcome)}.\n` +
    (subjectLines ? `\nSubject scores:\n${subjectLines}\n` : "") +
    (remarks ? `\nRemarks: ${remarks}\n` : "") +
    (pdfAttached
      ? `\nYour detailed assessment report (PDF)${hasFiles ? " and the subject sheets are" : " is"} attached.`
      : "") +
    nextStepLine +
    `\n\nQuestions? Contact ${contact.name} at ${contact.phone}.`;

  const resultContext = staffContextLine(await studentLabel(app), parent.full_name);

  // N-5 result to parent (with per-subject scores + attached files) + admin
  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-5",
        subject: "Assessment result",
        body: parentBody,
        attachments,
        whatsappTemplate: {
          name: "assessment_result_v2",
          params: [parent.full_name, portal, contact.name, contact.phone],
        },
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "N-5",
      subject: "Assessment result recorded",
      body: `${resultContext}Result for Grade ${app.grade_applying} applicant: ${outcomeLabel(outcome)}.`,
    }),
    ...(await notifyLeadCreator(app, {
      applicationId: app.id,
      event: "N-5",
      subject: "Your lead's assessment result is in",
      body: `${resultContext}Result: ${outcomeLabel(outcome)}.`,
    })),
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
    await dispatch([
      ...multiChannel(
        {
          applicationId: app.id,
          event: "N-10",
          subject: "Admission update",
          body: `Hello ${parent.full_name},\n\nThank you for your interest. Unfortunately we are unable to offer admission at this time. We wish your child the very best.\n\nQuestions? Contact ${contact.name} at ${contact.phone}.`,
        },
        parent,
      ),
      ...(await notifyLeadCreator(app, {
        applicationId: app.id,
        event: "N-10",
        subject: "Your lead was not eligible",
        body: `${resultContext}Not Eligible. The application is closed and the parent has been sent a courteous decline.`,
      })),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Broadway integration — after enrollment, look up the Broadway class this
// app's assigned section is linked to (Admin → Sections) and send the
// admission so the student/family exists in Broadway automatically. This
// app's own sections still decide the division (enroll_application's
// existing fill-order, unchanged) — Broadway has no say in that, only in
// which of its own classes each section corresponds to. Additive and
// independent of the enrollment notifications: never throws — any failure
// here is logged and flagged for admin review (Admin → Broadway) rather than
// surfaced to the parent, since enrollment itself already succeeded by the
// time this runs. Resending the same application id is safe (Broadway
// updates the same record until the student joins), so this same function
// serves as the retry path too — see retryBroadwaySync below.
// ---------------------------------------------------------------------------
export async function syncEnrollmentToBroadway(app: Application, parent: Parent, admissionNumber: string) {
  if (!config.broadway.enabled) return;
  const admin = createSupabaseAdminClient();

  try {
    const { data: section } = await admin
      .from("sections")
      .select("broadway_class_id, broadway_class_name")
      .eq("id", app.section_id)
      .maybeSingle();

    if (!section?.broadway_class_id) {
      await admin.from("applications").update({ broadway_status: "no_mapping" }).eq("id", app.id);
      await logAudit({
        action: "broadway.no_mapping",
        entity: "application",
        entityId: app.id,
        details: { section_id: app.section_id },
      });
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "BROADWAY_NO_MAPPING",
          subject: "Broadway sync needs attention: no class linked",
          body: `${admissionNumber} can't sync to Broadway yet — the assigned section isn't linked to a Broadway class. Link it under Admin → Sections, then retry under Admin → Broadway.`,
        }),
      );
      return;
    }

    const { data: studentRow } = await admin
      .from("students")
      .select("*")
      .eq("id", app.student_id)
      .maybeSingle();
    const student = studentRow as Student | null;
    const { academicTermStart } = await getSettings();
    const curriculum = student?.curriculum ?? app.preferred_curriculum ?? "";

    if (!parent.email) {
      await admin.from("applications").update({ broadway_status: "send_failed" }).eq("id", app.id);
      await logAudit({
        action: "broadway.send_failed",
        entity: "application",
        entityId: app.id,
        details: { error: "Parent has no email on file — Broadway requires one (it becomes the sign-in)." },
      });
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "BROADWAY_SEND_FAILED",
          subject: "Broadway sync failed: no parent email",
          body: `${admissionNumber} can't sync to Broadway — no parent email on file (Broadway requires one). Add it, then retry under Admin → Broadway.`,
        }),
      );
      return;
    }

    const result = await sendBroadwayAdmission({
      id: app.id,
      academicYear: String(config.admission.year),
      studentName: student?.full_name ?? parent.full_name,
      curriculum,
      grade: app.grade_applying ?? app.category ?? "",
      parentName: parent.full_name,
      parentEmail: parent.email,
      classId: section.broadway_class_id,
      admissionNo: admissionNumber,
      dob: student?.dob ?? null,
      gender: student?.gender ?? null,
      parentPhone: parent.phone,
      country: student?.country_of_residence ?? null,
      enrolledOn: academicTermStart,
      fatherName: student?.father_name ?? null,
      fatherPhone: student?.father_phone ?? null,
      motherName: student?.mother_name ?? null,
      motherPhone: student?.mother_phone ?? null,
      address: student?.current_address ?? student?.permanent_address ?? null,
      previousSchool: student?.previous_school ?? null,
      pen: student?.pen_number ?? null,
    });

    if (!result.ok) {
      console.error("[broadway] admission send failed", result.error);
      await admin.from("applications").update({ broadway_status: "send_failed" }).eq("id", app.id);
      await logAudit({
        action: "broadway.send_failed",
        entity: "application",
        entityId: app.id,
        details: { error: result.error, class_id: section.broadway_class_id },
      });
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "BROADWAY_SEND_FAILED",
          subject: "Broadway sync failed",
          body: `${admissionNumber} was assigned Broadway class "${section.broadway_class_name ?? section.broadway_class_id}" but the Broadway call failed: ${result.error}. Retry under Admin → Broadway.`,
        }),
      );
      return;
    }

    // classId can come back null even on success — e.g. Broadway itself
    // couldn't resolve the section (not expected here, since classId is
    // always sent explicitly, but defensive regardless). Treated the same
    // as "no mapping" so it stays in the needs-attention queue for a human
    // to assign a section, rather than silently reading as fully synced.
    const warningText = result.warnings.join(" ") || null;
    const noSection = result.classId === null;
    await admin
      .from("applications")
      .update({
        broadway_status: noSection ? "no_mapping" : "synced",
        broadway_student_id: result.studentId,
        broadway_admission_no: result.admissionNo,
        broadway_class_id: result.classId,
        broadway_class_name: result.className,
        broadway_warning: warningText,
      })
      .eq("id", app.id);
    await logAudit({
      action: "broadway.synced",
      entity: "application",
      entityId: app.id,
      details: { class_id: result.classId, status: result.status, warnings: result.warnings },
    });

    if (noSection) {
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "BROADWAY_NO_MAPPING",
          subject: "Broadway sync needs attention: no section assigned",
          body: `${admissionNumber} was admitted in Broadway but has no section yet: ${warningText ?? "no matching section"}. Assign one there, then retry under Admin → Broadway.`,
        }),
      );
    } else if (warningText) {
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "BROADWAY_WARNING",
          subject: "Broadway sync warning",
          body: `${admissionNumber} synced to Broadway, but it returned a warning: ${warningText}`,
        }),
      );
    }
  } catch (err) {
    console.error("[broadway] syncEnrollmentToBroadway threw unexpectedly", err);
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
        parentPhone: parent.phone ?? "",
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

    await admin.from("applications").update({ google_sheet_synced: true }).eq("id", app.id);
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

// Admin "Retry" for any stuck broadway_status (no_mapping or send_failed) —
// just re-runs the send from scratch. Safe regardless of which failure mode:
// resending the same application id is idempotent on Broadway's side (it
// updates the same record until the student joins), so there's no separate
// "resend the same class" path needed the way the old ERP integration
// required (that one couldn't safely re-claim a seat on retry; Broadway has
// no such concept to worry about).
export async function retryBroadwaySync(appId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin.from("applications").select("*").eq("id", appId).maybeSingle();
  if (!appRow) return;
  const app = appRow as Application;
  if (!app.admission_number) return; // not actually enrolled yet — nothing to sync
  const { data: parentRow } = await admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle();
  if (!parentRow) return;
  await syncEnrollmentToBroadway(app, parentRow as Parent, app.admission_number);
}

// Called after an admin transfers an already-enrolled student to a
// different section (Admin -> Sections -> Transfer). If this application was
// never synced to Broadway yet, there's nothing to do — the next sync will
// naturally read the new section_id. If it was, push the section change
// live via POST /admissions/section rather than just re-flagging for a
// later retry (unlike the old ERP integration, which had no verified
// "change class" call and had to fall back to a generic re-sync). Best-
// effort: the local transfer has already succeeded by the time this runs,
// so a Broadway-side failure here is logged and flagged for admin review,
// not surfaced as a failure of the transfer itself.
export async function changeBroadwaySectionAfterTransfer(
  applicationId: string,
  newSectionId: string,
  reason: string,
): Promise<void> {
  if (!config.broadway.enabled) return;
  const admin = createSupabaseAdminClient();
  const { data: appRow } = await admin
    .from("applications")
    .select("admission_number, broadway_student_id, broadway_status")
    .eq("id", applicationId)
    .maybeSingle();
  if (!appRow?.admission_number || !appRow.broadway_student_id) return; // never synced — nothing to push

  const { data: section } = await admin
    .from("sections")
    .select("broadway_class_id, broadway_class_name")
    .eq("id", newSectionId)
    .maybeSingle();
  if (!section?.broadway_class_id) {
    await admin.from("applications").update({ broadway_status: "no_mapping" }).eq("id", applicationId);
    await logAudit({
      action: "broadway.no_mapping",
      entity: "application",
      entityId: applicationId,
      details: { section_id: newSectionId, context: "transfer" },
    });
    await dispatch(
      fanToStaff(await staffContacts(["admin"]), {
        applicationId,
        event: "BROADWAY_NO_MAPPING",
        subject: "Broadway sync needs attention: section transfer",
        body: `${appRow.admission_number} was transferred to a section with no Broadway class linked. Link it under Admin → Sections, then retry under Admin → Broadway.`,
      }),
    );
    return;
  }

  const result = await changeBroadwaySection(applicationId, section.broadway_class_id, reason);
  if (!result.ok) {
    console.error("[broadway] section change failed", result.error);
    await logAudit({
      action: "broadway.section_change_failed",
      entity: "application",
      entityId: applicationId,
      details: { error: result.error, class_id: section.broadway_class_id },
    });
    await dispatch(
      fanToStaff(await staffContacts(["admin"]), {
        applicationId,
        event: "BROADWAY_SEND_FAILED",
        subject: "Broadway section change failed",
        body: `${appRow.admission_number} was transferred locally, but updating their Broadway section failed: ${result.error}. Retry under Admin → Broadway.`,
      }),
    );
    return;
  }

  await admin
    .from("applications")
    .update({
      broadway_class_id: result.classId,
      broadway_class_name: result.className,
      broadway_warning: result.warnings.join(" ") || null,
    })
    .eq("id", applicationId);
  await logAudit({
    action: "broadway.section_changed",
    entity: "application",
    entityId: applicationId,
    details: { class_id: result.classId, warnings: result.warnings },
  });
  if (result.warnings.length > 0) {
    await dispatch(
      fanToStaff(await staffContacts(["admin"]), {
        applicationId,
        event: "BROADWAY_WARNING",
        subject: "Broadway section change warning",
        body: `${appRow.admission_number}'s Broadway section was updated, but it returned a warning: ${result.warnings.join(" ")}`,
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Push this app's own section (class/division/batch) into Broadway whenever
// one is created or edited — a discrete call per edit, not a poll, per
// Broadway's own instruction. Called from createSection/updateSection after
// their own DB write succeeds; never throws — a section is fully usable in
// this app regardless of whether the Broadway push succeeds, matching the
// same "never block the primary action" precedent as Zoom/Google Sheets.
// Skipped (not failed) when there's no Broadway class name to send yet —
// that's a normal, expected state for a brand new section before the admin
// fills it in, not an error.
// ---------------------------------------------------------------------------
export type SyncSectionToBroadwayStatus = "synced" | "failed" | "skipped";

export async function syncSectionToBroadway(section: {
  id: string;
  grade: string;
  name: string;
  batch: string | null;
  capacity: number;
  broadwayInputName: string | null;
  classTiming: string | null;
}): Promise<SyncSectionToBroadwayStatus> {
  if (!config.broadway.enabled || !section.broadwayInputName) return "skipped";
  const admin = createSupabaseAdminClient();

  const result = await pushBroadwaySection({
    id: section.id,
    grade: section.grade,
    section: section.name,
    batch: section.batch,
    capacity: section.capacity,
    erpClassName: section.broadwayInputName,
    classTiming: section.classTiming,
  });

  if (result.ok) {
    await admin
      .from("sections")
      .update({
        broadway_sync_status: "synced",
        broadway_class_id: result.classId,
        broadway_class_name: result.name,
        broadway_warning: result.warnings.join(" ") || null,
        broadway_error: null,
      })
      .eq("id", section.id);
    await logAudit({
      action: "broadway.section_synced",
      entity: "section",
      entityId: section.id,
      details: { linked_existing: !result.created, warnings: result.warnings },
    });
    if (result.warnings.length > 0) {
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          event: "BROADWAY_SECTION_WARNING",
          subject: "Broadway section warning",
          body: `${section.grade}-${section.name}${section.batch ? ` (${section.batch})` : ""} synced to Broadway, but returned a warning: ${result.warnings.join(" ")}`,
        }),
      );
    }
    return "synced";
  }

  console.error("[broadway] section push failed", result.error);
  await admin
    .from("sections")
    .update({ broadway_sync_status: "failed", broadway_error: result.error })
    .eq("id", section.id);
  await logAudit({
    action: "broadway.section_send_failed",
    entity: "section",
    entityId: section.id,
    details: { error: result.error },
  });
  await dispatch(
    fanToStaff(await staffContacts(["admin"]), {
      event: "BROADWAY_SECTION_FAILED",
      subject: "Broadway class sync failed",
      body: `${section.grade}-${section.name}${section.batch ? ` (${section.batch})` : ""} couldn't sync to Broadway: ${result.error}. Editing the section again will retry.`,
    }),
  );
  return "failed";
}

// ---------------------------------------------------------------------------
// "Send all sections to Broadway" — the first-connection action (and a
// handy way to re-sync everything at once later). Sends every section that
// has a Broadway class name set in one batch call; sections without one are
// skipped the same way a single push would skip them. Never throws.
// ---------------------------------------------------------------------------
export async function pushAllSectionsToBroadway(): Promise<{ sent: number; synced: number; failed: number } | null> {
  if (!config.broadway.enabled) return null;
  const admin = createSupabaseAdminClient();
  const { data: sectionRows } = await admin
    .from("sections")
    .select("id, grade, name, batch, capacity, broadway_input_name, class_timing")
    .not("broadway_input_name", "is", null);
  const sections = sectionRows ?? [];
  if (sections.length === 0) return { sent: 0, synced: 0, failed: 0 };

  const payloads = sections.map((s) => ({
    id: s.id as string,
    grade: s.grade as string,
    section: s.name as string,
    batch: s.batch as string | null,
    capacity: s.capacity as number,
    erpClassName: s.broadway_input_name as string,
    classTiming: s.class_timing as string | null,
  }));

  const results = await pushBroadwaySections(payloads);
  if (!results) return null;

  let synced = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) {
      synced += 1;
      await admin
        .from("sections")
        .update({
          broadway_sync_status: "synced",
          broadway_class_id: r.classId,
          broadway_class_name: r.name,
          broadway_warning: r.warnings.join(" ") || null,
          broadway_error: null,
        })
        .eq("id", r.id);
    } else {
      failed += 1;
      await admin.from("sections").update({ broadway_sync_status: "failed", broadway_error: r.error }).eq("id", r.id);
    }
  }
  return { sent: sections.length, synced, failed };
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
    p_use_next_year: await isNextYearAdmission(),
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
  const { data: studentRow } = app.student_id
    ? await admin.from("students").select("curriculum").eq("id", app.student_id).maybeSingle()
    : { data: null };
  const isCbse = (studentRow?.curriculum ?? app.preferred_curriculum) === "CBSE";

  if (res.status === "NEEDS_ADMIN") {
    // `already` => this app was already in NEEDS_ADMIN; don't re-alert admins on
    // a repeat call (the /verify + /webhook double-fire, or repeated resolves).
    if (!res.already) {
      await dispatch(
        fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "N-9",
          subject: "Action needed: all sections full",
          body: `${staffContextLine(await studentLabel(app), parent.full_name)}All sections for ${app.grade_applying ?? app.category} are full. Manual seat allocation required for admission.`,
        }),
      );
      await logAudit({ action: "enrollment.needs_admin", entity: "application", entityId: app.id, details: res });
    }
    return { status: "NEEDS_ADMIN" as const };
  }

  // /verify (checkout) and /webhook both call this for the same payment, and
  // this whole function can also be interrupted mid-flight (a proxy/gateway
  // timeout while still working through dispatch/ERP/Sheets, all genuinely
  // slow external calls). `res.already` on its own used to mean "nothing
  // more to do," which was right for the fast double-fire but wrong for a
  // genuine interruption — it silently abandoned whatever hadn't finished
  // yet. Every step below is now independently checked and only (re)run if
  // it didn't actually complete, so a resumed call finishes exactly what's
  // missing and nothing more.

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
  const contact = await leadCreatorContact(app);
  const context = staffContextLine(await studentLabel(app), parent.full_name);
  const receiptBody =
    `Hello ${parent.full_name},\n\n` +
    `We have received your payment of ${formatINR(totalPaid)}:\n` +
    `- Admission fee: ${formatINR(admissionAmount)}\n` +
    (studyMaterialAmount > 0 ? `- Study material: ${formatINR(studyMaterialAmount)}\n` : "") +
    `\nA receipt is available in your portal: ${applyUrl(app.access_token)}\n\n` +
    `Questions? Contact ${contact.name} at ${contact.phone}.`;

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
              name: "payment_received_v2",
              params: [parent.full_name, formatINR(totalPaid), receiptUrl, contact.name, contact.phone],
            },
          },
          parent,
        ),
        ...fanToStaff(await staffContacts(["admin"]), {
          applicationId: app.id,
          event: "N-7",
          subject: "Payment received",
          body: `${context}Admission fee received for application ${app.id}.`,
        }),
      ]
    : [];
  // CBSE families arrange their own textbooks — spell out the books
  // department contact and provider link directly in the message body
  // (email/SMS and, via admission_confirmed_cbse_v1, WhatsApp too), not just
  // as a portal link.
  let onboardingLine = `Onboarding details (study material list, academic calendar and contacts) are available in your portal: ${applyUrl(app.access_token)}\n\n`;
  let booksPhones = "";
  if (isCbse) {
    const { booksDepartmentPhonesItems, booksProviderWebsite } = await getSettings();
    booksPhones = booksDepartmentPhonesItems.join(" / ") || "the school office";
    const website = booksProviderWebsite ? ` Order online: ${booksProviderWebsite}.` : "";
    onboardingLine =
      `Your child follows the CBSE curriculum, so textbooks are arranged separately — ` +
      `contact our books department at ${booksPhones}.${website}\n` +
      `Full onboarding details (academic calendar and contacts) are in your portal: ${applyUrl(app.access_token)}\n\n`;
  }

  const n8Messages: OutboundMessage[] = [
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-8",
        subject: "Welcome — admission confirmed",
        body:
          `Hello ${parent.full_name},\n\nWelcome! Admission is confirmed.\nAdmission number: ${res.admission_number}\nClass & section: ${res.section}\n\n` +
          onboardingLine +
          `Questions? Contact ${contact.name} at ${contact.phone}.`,
        whatsappTemplate: isCbse
          ? {
              name: "admission_confirmed_cbse_v1",
              params: [
                parent.full_name,
                res.admission_number ?? "—",
                res.section ?? "—",
                booksPhones,
                applyUrl(app.access_token),
                contact.name,
                contact.phone,
              ],
            }
          : {
              name: "admission_confirmed_v2",
              params: [
                parent.full_name,
                res.admission_number ?? "—",
                res.section ?? "—",
                applyUrl(app.access_token),
                contact.name,
                contact.phone,
              ],
            },
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["class_teacher", "admin"]), {
      applicationId: app.id,
      event: "N-8",
      subject: "New student assigned",
      body: `${context}A new student has been enrolled and assigned to ${res.section} (admission no. ${res.admission_number}).`,
    }),
    ...(await notifyLeadCreator(app, {
      applicationId: app.id,
      event: "N-8",
      subject: "Your lead enrolled!",
      body: `${context}Payment complete and admission confirmed — admission no. ${res.admission_number}, ${res.section}.`,
    })),
  ];

  // Filter both batches against what's already recorded as sent for this
  // application, so a resumed call only delivers what's actually missing —
  // not a blind re-send of everything, and not a skip of everything either.
  const [sentN7, sentN8] = await Promise.all([
    alreadySentPairs(app.id, "N-7"),
    alreadySentPairs(app.id, "N-8"),
  ]);
  await dispatch([
    ...excludeAlreadySent(receiptMessages, sentN7),
    ...excludeAlreadySent(n8Messages, sentN8),
  ]);

  await logAudit({ action: "enrollment.completed", entity: "application", entityId: app.id, details: res });
  if (app.broadway_status !== "synced") {
    await syncEnrollmentToBroadway(app, parent, res.admission_number!);
  }
  if (!app.google_sheet_synced) {
    await syncEnrollmentToGoogleSheet(app, parent, res.admission_number!);
  }
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
  const contact = await leadCreatorContact(app);

  await dispatch([
    ...multiChannel(
      {
        applicationId: app.id,
        event: "N-11",
        subject: "Study material payment received",
        body:
          `Hello ${parent.full_name},\n\nWe have received your study material payment of ${formatINR(amount)}. A receipt is available in your portal: ${applyUrl(app.access_token)}\n\n` +
          `Questions? Contact ${contact.name} at ${contact.phone}.`,
      },
      parent,
    ),
    ...fanToStaff(await staffContacts(["admin"]), {
      applicationId: app.id,
      event: "N-11",
      subject: "Study material payment received",
      body: `${staffContextLine(await studentLabel(app), parent.full_name)}Study material fee (${formatINR(amount)}) received for admission no. ${app.admission_number ?? app.id}.`,
    }),
  ]);
}
