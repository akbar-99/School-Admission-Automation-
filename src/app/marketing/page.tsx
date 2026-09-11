import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { applyUrl } from "@/lib/parent";
import { formatDateTime } from "@/lib/utils";
import { createLead } from "./actions";
import { LeadSourceSelect } from "@/components/marketing/lead-source-select";
import { describeFilters, parseAdmissionsFilters } from "@/lib/admissions-report";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { PhoneField } from "@/components/apply/phone-field";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { STATUS_LABEL, leadSourceLabel, type AppStatus } from "@/lib/types";

interface Row {
  id: string;
  status: AppStatus;
  category: string | null;
  grade_applying: string | null;
  lead_student_name: string | null;
  lead_source: string | null;
  access_token: string;
  created_at: string;
  parents: { full_name: string; phone: string; email: string | null } | null;
  students: { full_name: string } | null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{
    created?: string;
    error?: string;
    duplicate?: string;
    status?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { created, error, duplicate, status, from, to } = await searchParams;
  let duplicateInfo: {
    input: { parent_name: string; phone: string; email: string; student_name?: string; lead_source: string };
    matches: {
      id: string;
      status: string;
      createdAt: string;
      parentName: string;
      phone: string | null;
      studentName: string | null;
      grade: string | null;
      matchedOn: "contact" | "student_name";
    }[];
  } | null = null;
  if (duplicate) {
    try {
      duplicateInfo = JSON.parse(duplicate);
    } catch {
      duplicateInfo = null;
    }
  }
  const hasFilters = Boolean(status || from || to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Leads &amp; Applications</h1>
        <p className="text-muted-foreground">
          Enter a parent lead to generate a secure admission link, then track status.
        </p>
      </div>

      {created && (
        <Alert variant="success" className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Lead created. Admission link:{" "}
            <span className="font-mono text-xs break-all">{applyUrl(created)}</span>
          </span>
          <CopyButton value={applyUrl(created)} />
        </Alert>
      )}
      {error && <Alert variant="error">{error}</Alert>}

      {duplicateInfo && (
        <Alert variant="warning" className="space-y-3">
          <div>
            <p className="font-semibold">Possible duplicate enquiry</p>
            <p className="text-sm text-muted-foreground">
              We found existing lead(s) matching this phone/email or student name. If this is genuinely
              the same family enquiring again, open the existing lead below instead. If it&apos;s a
              different family (e.g. the other parent enquiring separately), you can still create it.
            </p>
          </div>
          <ul className="space-y-1.5 text-sm">
            {duplicateInfo.matches.map((m) => (
              <li key={m.id} className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="font-medium">{m.parentName}</span>
                {m.phone && <span className="text-muted-foreground"> · {m.phone}</span>}
                {m.studentName && <span className="text-muted-foreground"> · student: {m.studentName}</span>}
                {m.grade && <span className="text-muted-foreground"> · {m.grade}</span>}
                <span className="text-muted-foreground"> · {STATUS_LABEL[m.status as AppStatus] ?? m.status}</span>
                <span className="text-muted-foreground"> · {formatDateTime(m.createdAt)}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  (matched by {m.matchedOn === "contact" ? "phone/email" : "student name"})
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <form action={createLead}>
              <input type="hidden" name="parent_name" value={duplicateInfo.input.parent_name} />
              <input type="hidden" name="phone" value={duplicateInfo.input.phone} />
              <input type="hidden" name="email" value={duplicateInfo.input.email} />
              <input type="hidden" name="student_name" value={duplicateInfo.input.student_name ?? ""} />
              <input type="hidden" name="lead_source" value={duplicateInfo.input.lead_source} />
              <input type="hidden" name="confirm_duplicate" value="on" />
              <SubmitButton pendingText="Creating…" variant="outline">
                It&apos;s a different family — create anyway
              </SubmitButton>
            </form>
            <Link href="/marketing" className={buttonVariants({ variant: "ghost" })}>
              Cancel
            </Link>
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New lead</CardTitle>
          <CardDescription>
            The admission link is sent to the parent via WhatsApp, SMS and email (N-1).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createLead} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="parent_name">Parent&apos;s name *</Label>
              <Input id="parent_name" name="parent_name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number *</Label>
              <PhoneField id="phone" name="phone" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student_name">Student&apos;s name (optional)</Label>
              <Input id="student_name" name="student_name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead_source">Source of enquiry *</Label>
              <LeadSourceSelect name="lead_source" />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Creating…">Create lead &amp; send link</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Suspense fallback={<LeadsTableSkeleton />}>
        <LeadsTableSection status={status} from={from} to={to} hasFilters={hasFilters} />
      </Suspense>
    </div>
  );
}

function LeadsTableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Leads</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

async function LeadsTableSection({
  status,
  from,
  to,
  hasFilters,
}: {
  status?: string;
  from?: string;
  to?: string;
  hasFilters: boolean;
}) {
  const { profile } = await requireRole(["marketing", "admin"]);
  // Marketing only sees leads they created themselves; admin sees everything.
  const scopedToOwn = profile.role === "marketing";
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("applications")
    .select(
      "id, status, category, grade_applying, lead_student_name, lead_source, access_token, created_at, parents(full_name, phone, email), students(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (scopedToOwn) query = query.eq("created_by", profile.id);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  // Quick date-range presets — each preserves the current status filter.
  const presetHref = (f: string, t: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    params.set("from", f);
    params.set("to", t);
    return `/marketing?${params.toString()}`;
  };
  const today = isoDate(new Date());
  const presets = [
    { label: "Today", href: presetHref(today, today) },
    { label: "Last 7 days", href: presetHref(isoDate(daysAgo(6)), today) },
    { label: "Last 30 days", href: presetHref(isoDate(daysAgo(29)), today) },
    {
      label: "This month",
      href: presetHref(isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), today),
    },
  ];
  const exportQuery = new URLSearchParams(
    Object.entries({ status, from, to }).filter(([, v]) => v) as [string, string][],
  ).toString();
  const filterSummary = describeFilters(parseAdmissionsFilters({ status, from, to }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{scopedToOwn ? "Your leads" : "All leads"} ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 space-y-3 border-b border-border pb-4">
          <form action="/marketing" method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={status ?? ""} className="w-48">
                <option value="">All statuses</option>
                {(Object.keys(STATUS_LABEL) as AppStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Created from</Label>
              <Input id="from" name="from" type="date" defaultValue={from ?? ""} className="w-40" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Created to</Label>
              <Input id="to" name="to" type="date" defaultValue={to ?? ""} className="w-40" />
            </div>
            <Button type="submit" variant="outline">
              Filter
            </Button>
            {hasFilters && (
              <Link href="/marketing" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
          </form>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Quick range:</span>
            {presets.map((p) => (
              <Link
                key={p.label}
                href={p.href}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                {p.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              Export: <span className="font-medium text-foreground">{filterSummary}</span>
            </p>
            <div className="flex items-center gap-2">
              <a
                href={`/api/marketing/export/pdf${exportQuery ? `?${exportQuery}` : ""}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FileDown className="size-4" />
                Export PDF
              </a>
              <a
                href={`/api/marketing/export/excel${exportQuery ? `?${exportQuery}` : ""}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FileSpreadsheet className="size-4" />
                Export Excel
              </a>
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasFilters ? "No leads match this filter." : "No leads yet."}
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Parent</TH>
                <TH>Student</TH>
                <TH>Category</TH>
                <TH>Source</TH>
                <TH>Grade</TH>
                <TH>Status</TH>
                <TH>Created</TH>
                <TH>Link</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="font-medium">{r.parents?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.parents?.phone}</div>
                  </TD>
                  <TD>{r.students?.full_name ?? r.lead_student_name ?? "—"}</TD>
                  <TD>{r.category ?? "—"}</TD>
                  <TD>{leadSourceLabel(r.lead_source)}</TD>
                  <TD>{r.grade_applying ?? "—"}</TD>
                  <TD>
                    <StatusBadge status={r.status} />
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.created_at)}
                  </TD>
                  <TD>
                    <CopyButton value={applyUrl(r.access_token)} variant="ghost" />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
