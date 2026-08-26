import { CalendarClock, BookOpen, Phone, Download, Video } from "lucide-react";
import { Logo } from "@/components/logo";
import { loadApplicationByToken } from "@/lib/parent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config, CURRICULUM_OPTIONS } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { getClassOptions } from "@/lib/classes";
import { needsAssessment } from "@/lib/assessment";
import { formatDateTime, formatINR, formatDate, formatInZone } from "@/lib/utils";
import { bookSlot, acceptAgreement } from "./actions";
import { AdmissionForm } from "@/components/apply/admission-form";
import { PayPanel } from "@/components/apply/pay-panel";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buttonVariants } from "@/components/ui/button";
import type { AppStatus, SubjectResult } from "@/lib/types";

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const { bundle, reason } = await loadApplicationByToken(token);

  return (
    <div className="flex-1">
      <header className="glass sticky top-0 z-20 border-b border-border/70">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-3.5">
          <Logo size="sm" />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Admission Portal
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-10">
        {!bundle ? (
          <Card>
            <CardHeader>
              <CardTitle>Link unavailable</CardTitle>
              <CardDescription>
                {reason === "expired"
                  ? "This admission link has expired. Please contact the school for a new link."
                  : "This admission link is invalid. Please check the link or contact the school."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Content token={token} error={error} bundle={bundle} />
        )}
      </div>
    </div>
  );
}

async function Content({
  token,
  error,
  bundle,
}: {
  token: string;
  error?: string;
  bundle: Awaited<ReturnType<typeof loadApplicationByToken>>["bundle"];
}) {
  if (!bundle) return null;
  const { application: app, parent, student } = bundle;
  const status = app.status as AppStatus;
  const admin = createSupabaseAdminClient();
  const settings = await getSettings();

  // Class list (from the grades that have sections) + open slots, for the form.
  let openSlots: { id: string; startsAt: string }[] = [];
  let classOptions: string[] = [];
  if (status === "LEAD_CREATED") {
    classOptions = await getClassOptions();
    const { data } = await admin
      .from("assessment_slots")
      .select("id, starts_at")
      .eq("is_open", true)
      .is("application_id", null)
      .not("teacher_id", "is", null) // only slots a teacher has claimed — guarantees a Zoom host
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(50);
    openSlots = (data ?? []).map((s) => ({ id: s.id as string, startsAt: s.starts_at as string }));
  }

  // Assessment result (subject-wise), shown to the parent once recorded.
  let assessmentResult: { outcome: string; remarks: string | null } | null = null;
  let subjectResults: (SubjectResult & { url: string | null })[] = [];
  if (needsAssessment(app.grade_applying ?? "")) {
    const { data: resultRow } = await admin
      .from("assessment_results")
      .select("outcome, remarks, subjects")
      .eq("application_id", app.id)
      .maybeSingle();
    if (resultRow) {
      const row = resultRow as { outcome: string; remarks: string | null; subjects?: SubjectResult[] };
      assessmentResult = { outcome: row.outcome, remarks: row.remarks };
      subjectResults = await Promise.all(
        (row.subjects ?? []).map(async (sub) => {
          let url: string | null = null;
          if (sub.file) {
            const { data } = await admin.storage
              .from("documents")
              .createSignedUrl(sub.file.path, 3600, { download: sub.file.name });
            url = data?.signedUrl ?? null;
          }
          return { ...sub, url };
        }),
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            Hello, {parent.full_name}
          </h1>
          {student && (
            <p className="text-muted-foreground">Applicant: {student.full_name}</p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {student && status !== "LEAD_CREATED" && <StudentDetailsCard />}

      {status === "LEAD_CREATED" && (
        <Card>
          <CardHeader>
            <CardTitle>Admission form</CardTitle>
            <CardDescription>
              Tell us about your child. All classes except KG 1 require an assessment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdmissionForm
              token={token}
              gradeOptions={classOptions}
              curriculumOptions={CURRICULUM_OPTIONS}
              schoolTimezone={config.school.timezone}
              schoolTimezoneLabel={config.school.timezoneLabel}
              availableSlots={openSlots}
              defaultStudentName={app.lead_student_name}
            />
          </CardContent>
        </Card>
      )}

      {status === "FORM_SUBMITTED" && needsAssessment(app.grade_applying ?? "") && (
        <SlotPicker
          token={token}
          requestedDate={app.preferred_assessment_date}
          requestedTz={app.preferred_assessment_tz}
        />
      )}

      {status === "FORM_SUBMITTED" && !needsAssessment(app.grade_applying ?? "") && (
        <InfoCard title="Application received" tone="info">
          Your application is being processed. You will receive the admission
          agreement and payment link shortly.
        </InfoCard>
      )}

      {status === "ASSESSMENT_SCHEDULED" && (
        <BookedSlot appId={app.id} parentTz={app.preferred_assessment_tz} />
      )}

      {status === "ASSESSMENT_COMPLETED" && !assessmentResult && (
        <InfoCard title="Assessment completed" tone="info">
          Your child&apos;s assessment is complete. We are preparing the next
          steps — please check back shortly.
        </InfoCard>
      )}

      {assessmentResult && <ResultsCard />}

      {(status === "AGREEMENT_SENT" ||
        status === "PAYMENT_PENDING" ||
        status === "PAYMENT_FAILED" ||
        status === "ABANDONED") && (
        <Card>
          <CardHeader>
            <CardTitle>Admission agreement &amp; payment</CardTitle>
            <CardDescription>
              Review the agreement and pay the admission fee of{" "}
              {formatINR(settings.feePaise)} to confirm the seat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status === "PAYMENT_FAILED" && (
              <Alert variant="warning">
                Your previous payment did not complete. You can retry below.
              </Alert>
            )}
            <a
              href={`/api/agreement/${token}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex text-sm font-medium text-primary underline underline-offset-4"
            >
              View / print admission agreement (PDF)
            </a>

            {!app.agreement_accepted ? (
              <form
                action={acceptAgreement}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <input type="hidden" name="token" value={token} />
                <p className="text-sm text-muted-foreground">
                  Read the agreement above, then sign and accept it to continue to payment.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="signature">Type the parent/guardian name to sign *</Label>
                  <Input id="signature" name="signature" required placeholder={parent.full_name} />
                  <p className="text-xs text-muted-foreground">
                    Must match the name on record: <strong>{parent.full_name}</strong>
                  </p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="agree" className="mt-1" required />
                  <span>
                    I have read and accept the admission agreement, fee schedule, and code of
                    conduct.
                  </span>
                </label>
                <SubmitButton pendingText="Recording…">I accept the agreement</SubmitButton>
              </form>
            ) : (
              <>
                <Alert variant="success">
                  ✓ Agreement accepted by <strong>{app.agreement_signature}</strong>
                  {app.agreement_accepted_at && <> on {formatDateTime(app.agreement_accepted_at)}</>}.
                </Alert>
                <PayPanel
                  token={token}
                  amountLabel={formatINR(settings.feePaise)}
                  razorpayEnabled={config.razorpay.enabled}
                  razorpayKeyId={config.razorpay.publicKeyId}
                  parentName={parent.full_name}
                  parentEmail={parent.email}
                  parentPhone={parent.phone}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {status === "PAYMENT_COMPLETED" && (
        <InfoCard title="Payment received" tone="success">
          Thank you! We are finalising your admission number and class allocation.
        </InfoCard>
      )}

      {status === "NEEDS_ADMIN" && (
        <InfoCard title="Almost there" tone="warning">
          Your payment is received. Our team is finalising seat allocation and
          will confirm your admission shortly.
        </InfoCard>
      )}

      {status === "REJECTED" && (
        <InfoCard title="Admission update" tone="warning">
          Thank you for your interest. Unfortunately we are unable to offer
          admission at this time. We wish your child the very best.
        </InfoCard>
      )}

      {status === "ENROLLED" && <Onboarding appId={app.id} sectionId={app.section_id} admissionNumber={app.admission_number} />}
    </div>
  );

  // ---- step sub-components (server) ----
  async function SlotPicker({
    token,
    requestedDate,
    requestedTz,
  }: {
    token: string;
    requestedDate: string | null;
    requestedTz: string | null;
  }) {
    const { data: slots } = await admin
      .from("assessment_slots")
      .select("id, starts_at, ends_at")
      .eq("is_open", true)
      .not("teacher_id", "is", null) // only slots a teacher has claimed — guarantees a Zoom host
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(50);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Book your assessment slot</CardTitle>
          <CardDescription>
            {requestedDate ? (
              <>
                You requested{" "}
                <strong>{formatInZone(requestedDate, requestedTz ?? config.school.timezone)}</strong>
                {requestedTz && requestedTz !== config.school.timezone ? (
                  <>
                    {" "}({requestedTz}) — that&apos;s{" "}
                    <strong>
                      {formatInZone(requestedDate, config.school.timezone)} {config.school.timezoneLabel}
                    </strong>{" "}
                    in school time.
                  </>
                ) : (
                  "."
                )}{" "}
                Pick a confirmed slot below — booking is instant.
              </>
            ) : (
              "Pick a slot. Booking is instant and a slot cannot be double-booked."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!slots || slots.length === 0 ? (
            <Alert variant="info">
              No assessment slots are open yet. You will be notified as soon as
              slots become available.
            </Alert>
          ) : (
            <div className="space-y-2">
              {slots.map((s) => (
                <form
                  key={s.id}
                  action={bookSlot}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3"
                >
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="slot_id" value={s.id} />
                  <span className="text-sm font-medium">
                    {formatInZone(s.starts_at, config.school.timezone)} {config.school.timezoneLabel}
                    {requestedTz && requestedTz !== config.school.timezone && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        · your time {formatInZone(s.starts_at, requestedTz)}
                      </span>
                    )}
                  </span>
                  <SubmitButton size="sm" pendingText="Booking…">
                    Book
                  </SubmitButton>
                </form>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  async function BookedSlot({ appId, parentTz }: { appId: string; parentTz: string | null }) {
    const { data: slot } = await admin
      .from("assessment_slots")
      .select("starts_at, ends_at, zoom_join_url, zoom_passcode")
      .eq("application_id", appId)
      .maybeSingle();
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assessment scheduled</CardTitle>
          <CardDescription>This is an online assessment held over Zoom.</CardDescription>
        </CardHeader>
        <CardContent>
          {slot ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CalendarClock className="size-4 text-primary" />
                  {formatInZone(slot.starts_at, config.school.timezone)} {config.school.timezoneLabel}
                </div>
                {parentTz && parentTz !== config.school.timezone && (
                  <div className="pl-6 text-xs text-muted-foreground">
                    Your time: {formatInZone(slot.starts_at, parentTz)}
                  </div>
                )}
              </div>
              {slot.zoom_join_url ? (
                <div className="space-y-1.5">
                  <a
                    href={slot.zoom_join_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ size: "sm" })}
                  >
                    <Video className="size-4" />
                    Join the Zoom assessment
                  </a>
                  {slot.zoom_passcode && (
                    <div className="text-xs text-muted-foreground">
                      Passcode: <span className="font-medium text-foreground">{slot.zoom_passcode}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Join at your slot time — the teacher will admit you from the waiting room.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your Zoom link will appear here shortly and is also sent to your email.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Slot details unavailable.</p>
          )}
        </CardContent>
      </Card>
    );
  }

  async function StudentDetailsCard() {
    if (!student) return null;
    let sectionLabel: string | null = null;
    if (app.section_id) {
      const { data } = await admin
        .from("sections")
        .select("grade, name")
        .eq("id", app.section_id)
        .maybeSingle();
      if (data) sectionLabel = `${data.grade} — Section ${data.name}`;
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Student details</CardTitle>
          <CardDescription>The details submitted for your child&apos;s admission.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Student name" value={student.full_name} />
          <Field label="Date of birth" value={formatDate(student.dob)} />
          <Field label="Gender" value={student.gender ?? "—"} />
          <Field label="Category" value={app.category ?? "—"} />
          <Field label="Class / grade" value={app.grade_applying ?? "—"} />
          <Field label="Curriculum" value={student.curriculum ?? "—"} />
          <Field label="Country of residence" value={student.country_of_residence ?? "—"} />
          <Field label="Previous school" value={student.previous_school ?? "—"} />
          <div className="sm:col-span-2">
            <Field label="Current address" value={student.current_address ?? "—"} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Permanent address" value={student.permanent_address ?? "—"} />
          </div>
          <Field
            label="Father"
            value={[student.father_name, student.father_phone].filter(Boolean).join(" · ") || "—"}
          />
          <Field
            label="Mother"
            value={[student.mother_name, student.mother_phone].filter(Boolean).join(" · ") || "—"}
          />
          <Field label="Parent / guardian" value={parent.full_name} />
          <Field label="Contact" value={[parent.phone, parent.email].filter(Boolean).join(" · ") || "—"} />
          {app.admission_number && (
            <Field label="Admission number" value={app.admission_number} mono />
          )}
          {sectionLabel && <Field label="Class & section" value={sectionLabel} />}
        </CardContent>
      </Card>
    );
  }

  function ResultsCard() {
    if (!assessmentResult) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assessment results</CardTitle>
          <CardDescription>Your child&apos;s subject-wise assessment.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Overall result:</span>
            <Badge tone={assessmentResult.outcome === "PASS" ? "success" : "danger"}>
              {assessmentResult.outcome}
            </Badge>
          </div>
          {assessmentResult.remarks && (
            <p className="text-sm text-muted-foreground">Remarks: {assessmentResult.remarks}</p>
          )}
          {subjectResults.length > 0 && (
            <div className="space-y-2">
              {subjectResults.map((sub) => (
                <div key={sub.subject} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{sub.subject}</span>
                    <span className="tabular-nums">
                      {sub.score != null ? `${sub.score}/${sub.maxScore ?? 100}` : "—"}
                    </span>
                  </div>
                  {sub.comment && <p className="mt-1 text-muted-foreground">{sub.comment}</p>}
                  {sub.file && sub.url && (
                    <a
                      href={sub.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Download className="size-3.5" /> {sub.file.name}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  async function Onboarding({
    appId,
    sectionId,
    admissionNumber,
  }: {
    appId: string;
    sectionId: string | null;
    admissionNumber: string | null;
  }) {
    const [{ data: section }, { data: payment }] = await Promise.all([
      sectionId
        ? admin.from("sections").select("grade, name").eq("id", sectionId).maybeSingle()
        : Promise.resolve({ data: null }),
      admin
        .from("payments")
        .select("amount, receipt, razorpay_payment_id")
        .eq("application_id", appId)
        .eq("status", "completed")
        .maybeSingle(),
    ]);

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>🎉 Admission confirmed — welcome!</CardTitle>
            <CardDescription>Your child is enrolled. Onboarding details below.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Admission number" value={admissionNumber ?? "—"} mono />
            <Field
              label="Class & section"
              value={section ? `${section.grade} — Section ${section.name}` : "—"}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="size-5 text-primary" /> Onboarding pack
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="font-medium">Study material list</div>
              <ul className="ml-5 list-disc text-muted-foreground">
                {settings.studyMaterialItems.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-medium">Academic calendar</div>
              <p className="text-muted-foreground">
                Term 1 begins {settings.academicTermStart}. Orientation day:{" "}
                {settings.academicOrientation}.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Phone className="mt-0.5 size-4 text-primary" />
              <div>
                <div className="font-medium">Contact person</div>
                <p className="text-muted-foreground">
                  <a
                    href={`tel:${settings.schoolPhone.replace(/\s+/g, "")}`}
                    className="text-primary hover:underline"
                  >
                    {settings.schoolPhone}
                  </a>
                  {" · "}
                  <a
                    href={`mailto:${settings.schoolEmail}`}
                    className="text-primary hover:underline"
                  >
                    {settings.schoolEmail}
                  </a>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {payment && (
          <Card>
            <CardHeader>
              <CardTitle>Payment receipt</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount paid" value={formatINR(payment.amount)} />
                <Field label="Receipt no." value={payment.receipt ?? "—"} mono />
                <Field label="Payment ID" value={payment.razorpay_payment_id ?? "—"} mono />
              </div>
              <a
                href={`/api/receipt/${token}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex font-medium text-primary underline underline-offset-4"
              >
                Download / print receipt (PDF)
              </a>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }
}

function InfoCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "info" | "success" | "warning";
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant={tone}>{children}</Alert>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm" : "text-sm font-medium"}>{value}</div>
    </div>
  );
}
