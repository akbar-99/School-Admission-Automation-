import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { handleAssessmentResult } from "@/lib/workflow";
import { dispatch, multiChannel } from "@/lib/notifications";
import { logAudit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// One-off: a teacher submitted RAZA's assessment result against Fathima
// Zahra's application by mistake (reusing Kelvin's old PDF files and
// wording along the way). Moves the result to RAZA's actual application,
// fires the normal result notification to RAZA's parent, reverts Fathima
// Zahra's application back to ASSESSMENT_SCHEDULED, and sends her parent a
// correction. Delete this route after running it once.
const WRONG_APP_ID = "b5b46b2b-ac69-4960-a6b2-376d4bb7f6d1";
const RAZA_APP_ID = "35965c2c-bd74-4a1a-98b7-866d7371b737";
const RAZA_SLOT_ID = "f10cc1fd-229e-4c9a-9c9e-2b846b67083c";
const RESULT_ID = "3ce9caa7-9b69-4e37-92af-827f853dddfd";

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (!config.cronSecret || secret !== config.cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const steps: Record<string, unknown> = {};

  const correctedRemarks =
    "RAZA IS COMMUNICATING IN ENGKISH. RAZA CAN SOLVE ALL THE PROBLEMS IN MATHS.";
  const correctedSubjects = [
    { subject: "Maths", score: 9, maxScore: 10, comment: "RAZA IS OK IN MATHS", file: null },
    { subject: "English", score: 10, maxScore: 10, comment: "RAZA IS FLUENT IN ENGLISH.", file: null },
  ];

  const { error: moveErr } = await admin
    .from("assessment_results")
    .update({
      application_id: RAZA_APP_ID,
      slot_id: RAZA_SLOT_ID,
      remarks: correctedRemarks,
      subjects: correctedSubjects,
    })
    .eq("id", RESULT_ID);
  if (moveErr) return NextResponse.json({ step: "move", error: moveErr.message, ...steps }, { status: 500 });
  steps.moved = true;

  const { error: razaStatusErr } = await admin
    .from("applications")
    .update({ status: "ASSESSMENT_COMPLETED" })
    .eq("id", RAZA_APP_ID)
    .eq("status", "ASSESSMENT_SCHEDULED");
  if (razaStatusErr) {
    return NextResponse.json({ step: "raza-status", error: razaStatusErr.message, ...steps }, { status: 500 });
  }
  steps.razaAdvanced = true;

  await handleAssessmentResult(RAZA_APP_ID, "PASS", correctedRemarks);
  steps.razaNotified = true;

  const { data: undo, error: undoErr } = await admin.rpc("admin_undo_misfiled_assessment", {
    p_application: WRONG_APP_ID,
  });
  if (undoErr) {
    return NextResponse.json({ step: "undo-fathima", error: undoErr.message, ...steps }, { status: 500 });
  }
  steps.fathimaReverted = undo;

  const { data: wrongApp } = await admin
    .from("applications")
    .select("id, parent_id, created_by")
    .eq("id", WRONG_APP_ID)
    .maybeSingle();
  const { data: wrongParent } = await admin
    .from("parents")
    .select("full_name, email, phone")
    .eq("id", wrongApp?.parent_id)
    .maybeSingle();

  let contactName = "the school team";
  let contactPhone = "";
  if (wrongApp?.created_by) {
    const { data: creator } = await admin
      .from("users")
      .select("full_name, phone")
      .eq("id", wrongApp.created_by)
      .maybeSingle();
    if (creator?.phone) {
      contactName = creator.full_name;
      contactPhone = creator.phone;
    }
  }
  if (!contactPhone) {
    const s = await getSettings();
    contactName = `the ${s.schoolName} team`;
    contactPhone = s.schoolPhone;
  }

  if (wrongParent) {
    const correctionBody =
      `Hello ${wrongParent.full_name},\n\n` +
      `We're writing to correct a mistake: the assessment result message you received earlier today referencing "Kelvin" was sent to you in error — it belongs to a different applicant and does not reflect your child's results. Please disregard that message entirely.\n\n` +
      `Your child's own assessment is still pending, and we will share the actual result with you separately once it's ready.\n\n` +
      `We apologise for the confusion. Questions? Contact ${contactName} at ${contactPhone}.`;

    await dispatch(
      multiChannel(
        {
          applicationId: WRONG_APP_ID,
          event: "N-5-CORRECTION",
          subject: "Correction: please disregard the earlier assessment result message",
          body: correctionBody,
        },
        wrongParent,
        ["email", "sms"],
      ),
    );
    steps.fathimaCorrected = true;
  }

  await logAudit({
    actorId: null,
    actorRole: "admin",
    action: "assessment.mixup_corrected",
    entity: "application",
    entityId: WRONG_APP_ID,
    details: { movedResultTo: RAZA_APP_ID, resultId: RESULT_ID },
  });

  return NextResponse.json({ ok: true, ...steps });
}
