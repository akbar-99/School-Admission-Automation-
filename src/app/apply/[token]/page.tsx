import { CalendarClock, BookOpen, Phone } from "lucide-react";
import { Logo } from "@/components/logo";
import { loadApplicationByToken } from "@/lib/parent";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config, GRADE_OPTIONS } from "@/lib/config";
import { formatDateTime, formatINR } from "@/lib/utils";
import { bookSlot } from "./actions";
import { AdmissionForm } from "@/components/apply/admission-form";
import { PayPanel } from "@/components/apply/pay-panel";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import type { AppStatus } from "@/lib/types";

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

      {status === "LEAD_CREATED" && (
        <Card>
          <CardHeader>
            <CardTitle>Admission form</CardTitle>
            <CardDescription>
              Tell us about your child. Category (KG / Grade) is detected
              automatically from age as of {config.admission.year}-
              {config.admission.ageCutoffMMDD}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdmissionForm
              token={token}
              gradeOptions={GRADE_OPTIONS}
              defaultStudentName={app.lead_student_name}
              ageConfig={{
                year: config.admission.year,
                cutoffMMDD: config.admission.ageCutoffMMDD,
                kgMin: config.admission.kgMinAge,
                kgMax: config.admission.kgMaxAge,
                gradeMin: config.admission.gradeMinAge,
              }}
            />
          </CardContent>
        </Card>
      )}

      {status === "FORM_SUBMITTED" && app.category === "GRADE" && (
        <SlotPicker token={token} />
      )}

      {status === "FORM_SUBMITTED" && app.category === "KG" && (
        <InfoCard title="Application received" tone="info">
          Your application is being processed. You will receive the admission
          agreement and payment link shortly.
        </InfoCard>
      )}

      {status === "ASSESSMENT_SCHEDULED" && (
        <BookedSlot appId={app.id} />
      )}

      {status === "ASSESSMENT_COMPLETED" && (
        <InfoCard title="Assessment completed" tone="info">
          Your child&apos;s assessment is complete. We are preparing the next
          steps — please check back shortly.
        </InfoCard>
      )}

      {(status === "AGREEMENT_SENT" ||
        status === "PAYMENT_PENDING" ||
        status === "PAYMENT_FAILED" ||
        status === "ABANDONED") && (
        <Card>
          <CardHeader>
            <CardTitle>Admission agreement &amp; payment</CardTitle>
            <CardDescription>
              Review the agreement and pay the admission fee of{" "}
              {formatINR(config.admission.feePaise)} to confirm the seat.
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
            <PayPanel
              token={token}
              amountLabel={formatINR(config.admission.feePaise)}
              razorpayEnabled={config.razorpay.enabled}
              razorpayKeyId={config.razorpay.publicKeyId}
              parentName={parent.full_name}
              parentEmail={parent.email}
              parentPhone={parent.phone}
            />
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
  async function SlotPicker({ token }: { token: string }) {
    const { data: slots } = await admin
      .from("assessment_slots")
      .select("id, starts_at, ends_at")
      .eq("is_open", true)
      .gt("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(50);

    return (
      <Card>
        <CardHeader>
          <CardTitle>Book your assessment slot</CardTitle>
          <CardDescription>
            Pick a slot. Booking is instant and a slot cannot be double-booked.
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
                    {formatDateTime(s.starts_at)}
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

  async function BookedSlot({ appId }: { appId: string }) {
    const { data: slot } = await admin
      .from("assessment_slots")
      .select("starts_at, ends_at")
      .eq("application_id", appId)
      .maybeSingle();
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assessment scheduled</CardTitle>
          <CardDescription>Please arrive 10 minutes early.</CardDescription>
        </CardHeader>
        <CardContent>
          {slot ? (
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4 text-primary" />
              {formatDateTime(slot.starts_at)}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Slot details unavailable.</p>
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
                <li>Prescribed textbooks &amp; workbooks for the grade</li>
                <li>Two notebooks per subject</li>
                <li>School uniform &amp; ID card (collect from front office)</li>
              </ul>
            </div>
            <div>
              <div className="font-medium">Academic calendar</div>
              <p className="text-muted-foreground">
                Term 1 begins {config.admission.year}-06-15. Orientation day:{" "}
                {config.admission.year}-06-10.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Phone className="mt-0.5 size-4 text-primary" />
              <div>
                <div className="font-medium">Contact person</div>
                <p className="text-muted-foreground">
                  Admissions Office · admissions@school.example · +91 90000 00000
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
            <CardContent className="grid gap-4 sm:grid-cols-2 text-sm">
              <Field label="Amount paid" value={formatINR(payment.amount)} />
              <Field label="Receipt no." value={payment.receipt ?? "—"} mono />
              <Field label="Payment ID" value={payment.razorpay_payment_id ?? "—"} mono />
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
