import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { applyUrl } from "@/lib/parent";
import { formatDateTime } from "@/lib/utils";
import { createLead } from "./actions";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { STATUS_LABEL, type AppStatus } from "@/lib/types";

interface Row {
  id: string;
  status: AppStatus;
  category: string | null;
  grade_applying: string | null;
  lead_student_name: string | null;
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
    status?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { created, error, status, from, to } = await searchParams;
  const hasFilters = Boolean(status || from || to);
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("applications")
    .select(
      "id, status, category, grade_applying, lead_student_name, access_token, created_at, parents(full_name, phone, email), students(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
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
              <Label htmlFor="parent_name">Parent name *</Label>
              <Input id="parent_name" name="parent_name" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number *</Label>
              <Input id="phone" name="phone" type="tel" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="student_name">Student name (optional)</Label>
              <Input id="student_name" name="student_name" />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton pendingText="Creating…">Create lead &amp; send link</SubmitButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All leads ({rows.length})</CardTitle>
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
    </div>
  );
}
