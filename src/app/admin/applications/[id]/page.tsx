import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";
import { applyUrl } from "@/lib/parent";
import { formatDateTime, formatDate, formatINR, formatInZone } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton } from "@/components/copy-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { deleteApplication, rotateAccessToken } from "../../actions";
import { needsAssessment } from "@/lib/assessment";
import { leadSourceLabel, type Application, type Student, type Parent, type Payment, type SubjectResult } from "@/lib/types";

const DOC_LABEL: Record<string, string> = {
  passport: "Passport/Aadhaar",
  birth_certificate: "Birth certificate",
  photo: "Photo",
};

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { error, ok } = await searchParams;
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
      .order("created_at", { ascending: false }),
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
  const payments = (paymentRes.data ?? []) as Payment[];
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

  const isGrade = needsAssessment(app.grade_applying ?? "");
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
      {ok && (
        <Alert variant="success" className="print:hidden">
          {ok}
        </Alert>
      )}

      <Section title="Application">
        <Field label="Category" value={app.category ?? "—"} />
        <Field label="Class / grade" value={app.grade_applying ?? "—"} />
        <Field label="Preferred class timing" value={app.preferred_class_timing ?? "No preference"} />
        <Field label="Source of enquiry" value={leadSourceLabel(app.lead_source)} />
        <Field label="Admission number" value={app.admission_number ?? "—"} mono />
        <Field label="Section" value={section ? `${section.grade}-${section.name}` : "—"} />
        <Field label="Study material" value={app.study_material_paid ? "Paid" : "Not paid"} />
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
        <Field label="Student&apos;s name" value={student?.full_name ?? "—"} />
        <Field label="Date of birth" value={student?.dob ? formatDate(student.dob) : "—"} />
        <Field label="Gender" value={student?.gender ?? "—"} />
        <Field label="Curriculum" value={student?.curriculum ?? "—"} />
        <Field label="Country of residence" value={student?.country_of_residence ?? "—"} />
        <Field label="Previous school" value={student?.previous_school ?? "—"} />
        <Field label="PEN number" value={student?.pen_number ?? "—"} />
        <Field label="Current address" value={student?.current_address ?? "—"} wide />
        <Field label="Permanent address" value={student?.permanent_address ?? "—"} wide />
      </Section>

      <Section title="Parent / guardian">
        <Field label="Father&apos;s name" value={student?.father_name ?? "—"} />
        <Field label="Father's contact" value={student?.father_phone ?? "—"} />
        <Field label="Mother&apos;s name" value={student?.mother_name ?? "—"} />
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
                    <span className="tabular-nums">{sub.score != null ? `${sub.score}/${sub.maxScore ?? 100}` : "—"}</span>
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
        <div className="sm:col-span-2">
          <a
            href={`/api/agreement/${app.access_token}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            View {app.agreement_accepted ? "signed agreement" : "agreement"}
          </a>
        </div>
      </Section>

      <Card>
        <CardHeader>
          <CardTitle>Payments ({payments.length})</CardTitle>
          <CardDescription>Admission and study material can be paid together or separately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payment attempts yet.</p>
          ) : (
            payments.map((p) => {
              const description =
                p.includes_admission && p.includes_study_material
                  ? "Admission fee + Study material"
                  : p.includes_study_material
                    ? "Study material"
                    : "Admission fee";
              return (
                <div key={p.id} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{description}</span>
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">{p.status}</span>
                  </div>
                  <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">Amount: </span>
                      {formatINR(p.amount)}
                      {p.includes_admission && p.includes_study_material && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({formatINR(p.admission_amount)} + {formatINR(p.study_material_amount)})
                        </span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Date: </span>
                      {formatDateTime(p.created_at)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Receipt: </span>
                      <span className="font-mono text-xs">{p.receipt ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Razorpay payment ID: </span>
                      <span className="font-mono text-xs">{p.razorpay_payment_id ?? "—"}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

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

      <Card className="print:hidden">
        <CardHeader>
          <CardTitle>Parent access link</CardTitle>
          <CardDescription>
            This is the parent&apos;s only sign-in — anyone holding the link can act as
            them. If a link has been forwarded or leaked, regenerate it below; the old
            link stops working immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-xs">
              {applyUrl(app.access_token)}
            </span>
            <CopyButton value={applyUrl(app.access_token)} />
          </div>
          <form action={rotateAccessToken}>
            <input type="hidden" name="application_id" value={app.id} />
            <SubmitButton variant="outline" size="sm" pendingText="Regenerating…">
              Regenerate link
            </SubmitButton>
          </form>
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
