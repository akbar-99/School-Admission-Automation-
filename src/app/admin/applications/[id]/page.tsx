import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { formatDateTime, formatDate, formatINR, formatInZone } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { deleteApplication } from "../../actions";
import type { Application, Student, Parent, Payment, SubjectResult } from "@/lib/types";

const DOC_LABEL: Record<string, string> = {
  passport: "Passport copy",
  birth_certificate: "Birth certificate",
};

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const admin = createSupabaseAdminClient();

  const { data: appRow } = await admin.from("applications").select("*").eq("id", id).maybeSingle();
  if (!appRow) notFound();
  const app = appRow as Application;

  const [studentRes, parentRes, paymentRes, sectionRes, resultRes, slotRes] = await Promise.all([
    app.student_id
      ? admin.from("students").select("*").eq("id", app.student_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("parents").select("*").eq("id", app.parent_id).maybeSingle(),
    admin
      .from("payments")
      .select("*")
      .eq("application_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    app.section_id
      ? admin.from("sections").select("grade, name").eq("id", app.section_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("assessment_results")
      .select("outcome, remarks, subjects")
      .eq("application_id", id)
      .maybeSingle(),
    admin
      .from("assessment_slots")
      .select("starts_at, users(full_name)")
      .eq("application_id", id)
      .maybeSingle(),
  ]);
  const student = studentRes.data as Student | null;
  const parent = parentRes.data as Parent | null;
  const payment = paymentRes.data as Payment | null;
  const section = sectionRes.data as { grade: string; name: string } | null;
  const result = resultRes.data as {
    outcome: string;
    remarks: string | null;
    subjects?: SubjectResult[];
  } | null;
  const slot = slotRes.data as { starts_at: string; users: { full_name: string | null } | null } | null;

  // Signed download URLs for documents in the private bucket.
  const docs = app.documents ?? [];
  const signed = await Promise.all(
    docs.map(async (d) => {
      const { data } = await admin.storage
        .from("documents")
        .createSignedUrl(d.path, 3600, { download: d.name });
      return { doc: d, url: data?.signedUrl ?? null };
    }),
  );

  // Per-subject scores + signed download URLs for any attached file.
  const subjectRows = await Promise.all(
    (result?.subjects ?? []).map(async (sub) => {
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

  const isGrade = app.category === "GRADE";
  const schoolTz = config.school.timezone;
  const schoolLabel = config.school.timezoneLabel;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to applications
        </Link>
        <PrintButton />
      </div>

      <div className="hidden print:block">
        <div className="text-lg font-semibold">Broadway Home Schooling — Applicant details</div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">
            {student?.full_name ?? parent?.full_name ?? "Applicant"}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{app.id}</p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      {error && (
        <Alert variant="error" className="print:hidden">
          {error}
        </Alert>
      )}

      <Section title="Application">
        <Field label="Category" value={app.category ?? "—"} />
        <Field label="Class / grade" value={app.grade_applying ?? "—"} />
        <Field label="Admission number" value={app.admission_number ?? "—"} mono />
        <Field label="Section" value={section ? `${section.grade}-${section.name}` : "—"} />
        <Field label="Created" value={formatDateTime(app.created_at)} />
        <Field
          label="Data consent"
          value={
            app.consent_accepted
              ? `Accepted${app.consent_at ? " · " + formatDate(app.consent_at) : ""}`
              : "Not accepted"
          }
        />
      </Section>

      <Section title="Student">
        <Field label="Full name" value={student?.full_name ?? "—"} />
        <Field label="Date of birth" value={student?.dob ? formatDate(student.dob) : "—"} />
        <Field label="Gender" value={student?.gender ?? "—"} />
        <Field label="Curriculum" value={student?.curriculum ?? "—"} />
        <Field label="Country of residence" value={student?.country_of_residence ?? "—"} />
        <Field label="Previous school" value={student?.previous_school ?? "—"} />
        <Field label="Current address" value={student?.current_address ?? "—"} wide />
        <Field label="Permanent address" value={student?.permanent_address ?? "—"} wide />
      </Section>

      <Section title="Parent / guardian">
        <Field label="Father" value={student?.father_name ?? "—"} />
        <Field label="Father's contact" value={student?.father_phone ?? "—"} />
        <Field label="Mother" value={student?.mother_name ?? "—"} />
        <Field label="Mother's contact" value={student?.mother_phone ?? "—"} />
        <Field label="WhatsApp / phone" value={parent?.phone ?? "—"} />
        <Field label="Email" value={parent?.email ?? "—"} />
      </Section>

      {isGrade && (
        <Section title="Assessment">
          <Field
            label="Preferred (school time)"
            value={
              app.preferred_assessment_date
                ? `${formatInZone(app.preferred_assessment_date, schoolTz)} ${schoolLabel}`
                : "—"
            }
          />
          <Field
            label="Preferred (parent time)"
            value={
              app.preferred_assessment_date && app.preferred_assessment_tz
                ? `${formatInZone(app.preferred_assessment_date, app.preferred_assessment_tz)} (${app.preferred_assessment_tz})`
                : "—"
            }
          />
          <Field
            label="Scheduled time"
            value={slot ? `${formatInZone(slot.starts_at, schoolTz)} ${schoolLabel}` : "Not scheduled"}
          />
          <Field label="Assigned teacher" value={slot?.users?.full_name ?? "—"} />
          <Field label="Result" value={result ? result.outcome : "Pending"} />
          {result?.remarks && <Field label="Remarks" value={result.remarks} wide />}
          {subjectRows.length > 0 && (
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Subject scores</div>
              {subjectRows.map((sub) => (
                <div key={sub.subject} className="rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{sub.subject}</span>
                    <span className="tabular-nums">{sub.score != null ? `${sub.score}/100` : "—"}</span>
                  </div>
                  {sub.comment && <p className="mt-1 text-muted-foreground">{sub.comment}</p>}
                  {sub.file &&
                    (sub.url ? (
                      <a
                        href={sub.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <Download className="size-3.5" /> {sub.file.name}
                      </a>
                    ) : (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {sub.file.name} (link unavailable)
                      </span>
                    ))}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <Section title="Agreement">
        <Field label="Accepted" value={app.agreement_accepted ? "Yes" : "No"} />
        <Field label="Signed by" value={app.agreement_signature ?? "—"} />
        <Field
          label="Accepted at"
          value={app.agreement_accepted_at ? formatDateTime(app.agreement_accepted_at) : "—"}
        />
        <Field label="From IP" value={app.agreement_ip ?? "—"} />
      </Section>

      <Section title="Payment">
        <Field label="Status" value={payment?.status ?? "—"} />
        <Field label="Amount" value={payment ? formatINR(payment.amount) : "—"} />
        <Field label="Receipt" value={payment?.receipt ?? "—"} mono />
        <Field label="Razorpay payment ID" value={payment?.razorpay_payment_id ?? "—"} mono />
      </Section>

      <Card>
        <CardHeader>
          <CardTitle>Documents ({docs.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded.</p>
          ) : (
            signed.map(({ doc, url }, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{DOC_LABEL[doc.category] ?? doc.category}</span>
                  <span className="text-muted-foreground">
                    {" "}· {doc.name} · {Math.max(1, Math.round(doc.size / 1024))} KB
                  </span>
                </div>
                {url ? (
                  <a
                    href={url}
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline print:hidden"
                  >
                    <Download className="size-4" /> Download
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">Unavailable</span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/40 print:hidden">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone — Delete applicant</CardTitle>
          <CardDescription>
            Permanently deletes this applicant and all their records (student, parent, payments,
            notifications, assessment data). Frees their seat if enrolled. <strong>This cannot be
            undone.</strong>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={deleteApplication} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="application_id" value={app.id} />
            <div className="space-y-1.5">
              <Label htmlFor="confirm">
                Type <strong>DELETE</strong> to confirm
              </Label>
              <Input id="confirm" name="confirm" placeholder="DELETE" autoComplete="off" className="w-40" />
            </div>
            <SubmitButton variant="destructive" pendingText="Deleting…">
              Delete applicant
            </SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  mono,
  wide,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm break-all" : "whitespace-pre-wrap text-sm font-medium"}>
        {value}
      </div>
    </div>
  );
}
