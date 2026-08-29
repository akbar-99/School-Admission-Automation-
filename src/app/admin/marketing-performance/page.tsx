import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatINR } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MarketingPerformancePie } from "@/components/admin/marketing-performance-chart";
import type { AppStatus } from "@/lib/types";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// Statuses that mean a lead reached at least this funnel stage. Derived from
// the status machine (0002_functions.sql): once a lead leaves LEAD_CREATED /
// FORM_SUBMITTED it never goes back, so the current status alone tells us
// whether a milestone was ever reached — no history lookup needed.
// One known simplification: a lead that reached AGREEMENT_SENT or
// PAYMENT_COMPLETED but was later rejected from NEEDS_ADMIN (seat
// unavailable) ends up as REJECTED and isn't counted in these milestones,
// even though it did pass through them.
const REACHED_AGREEMENT = new Set<AppStatus>([
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
  "PAYMENT_COMPLETED",
  "NEEDS_ADMIN",
  "ENROLLED",
]);
const REACHED_PAYMENT = new Set<AppStatus>(["PAYMENT_COMPLETED", "NEEDS_ADMIN", "ENROLLED"]);

interface Stats {
  leads: number;
  formSubmitted: number;
  agreementSent: number;
  paymentCompleted: number;
  enrolled: number;
  revenuePaise: number;
}

const EMPTY_STATS: Stats = {
  leads: 0,
  formSubmitted: 0,
  agreementSent: 0,
  paymentCompleted: 0,
  enrolled: 0,
  revenuePaise: 0,
};

export default async function MarketingPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const admin = createSupabaseAdminClient();

  const { data: staffData } = await admin
    .from("users")
    .select("id, full_name, email")
    .eq("role", "marketing")
    .order("full_name", { ascending: true });
  const staff = staffData ?? [];

  // Date range applies to when the lead was created (cohort-based) — a lead
  // created in this window is tracked through to its current status even if
  // that progress happened after the window closed.
  let query = admin
    .from("applications")
    .select("id, status, created_by, created_at, payments(amount, status)")
    .not("created_by", "is", null);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  const { data: appsData } = await query;

  const statsByStaff = new Map<string, Stats>();
  const statsFor = (id: string) => {
    let s = statsByStaff.get(id);
    if (!s) {
      s = { ...EMPTY_STATS };
      statsByStaff.set(id, s);
    }
    return s;
  };

  for (const row of (appsData ?? []) as unknown as {
    status: AppStatus;
    created_by: string;
    payments: { amount: number; status: string }[] | null;
  }[]) {
    const s = statsFor(row.created_by);
    s.leads += 1;
    if (row.status !== "LEAD_CREATED") s.formSubmitted += 1;
    if (REACHED_AGREEMENT.has(row.status)) s.agreementSent += 1;
    if (REACHED_PAYMENT.has(row.status)) s.paymentCompleted += 1;
    if (row.status === "ENROLLED") s.enrolled += 1;
    for (const p of row.payments ?? []) {
      if (p.status === "completed") s.revenuePaise += p.amount;
    }
  }

  const totals = staff.reduce(
    (acc, m) => {
      const s = statsByStaff.get(m.id) ?? EMPTY_STATS;
      acc.leads += s.leads;
      acc.enrolled += s.enrolled;
      acc.revenuePaise += s.revenuePaise;
      return acc;
    },
    { leads: 0, enrolled: 0, revenuePaise: 0 },
  );

  const presetHref = (f: string, t: string) => `/admin/marketing-performance?from=${f}&to=${t}`;
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
  const hasFilters = Boolean(from || to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Marketing performance</h1>
        <p className="text-muted-foreground">
          Leads created, funnel progress, and revenue attributed to each marketing team member.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Total leads</div>
            <div className="font-display text-2xl font-semibold">{totals.leads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Total enrolled</div>
            <div className="font-display text-2xl font-semibold">{totals.enrolled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Total revenue</div>
            <div className="font-display text-2xl font-semibold">{formatINR(totals.revenuePaise)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leads by marketing team member</CardTitle>
          <CardDescription>Share of total leads created, per person, for the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          <MarketingPerformancePie
            data={staff.map((m) => ({
              id: m.id,
              name: m.full_name ?? m.email ?? "—",
              leads: (statsByStaff.get(m.id) ?? EMPTY_STATS).leads,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By marketing team member ({staff.length})</CardTitle>
          <CardDescription>
            Funnel counts are cumulative — a lead counted in &quot;Payment completed&quot; is also
            counted in &quot;Agreement sent&quot; and &quot;Form submitted&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/admin/marketing-performance"
            method="get"
            className="mb-4 flex flex-wrap items-end gap-3 border-b border-border pb-4"
          >
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
              <Link href="/admin/marketing-performance" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
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
          </form>

          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No marketing staff yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Marketing team member</TH>
                  <TH>Leads created</TH>
                  <TH>Form submitted</TH>
                  <TH>Agreement sent</TH>
                  <TH>Payment completed</TH>
                  <TH>Enrolled</TH>
                  <TH>Conversion</TH>
                  <TH>Revenue</TH>
                </TR>
              </THead>
              <TBody>
                {staff.map((m) => {
                  const s = statsByStaff.get(m.id) ?? EMPTY_STATS;
                  const conversion = s.leads > 0 ? `${((s.enrolled / s.leads) * 100).toFixed(1)}%` : "—";
                  return (
                    <TR key={m.id}>
                      <TD>
                        <div className="font-medium">{m.full_name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </TD>
                      <TD className="font-medium">{s.leads}</TD>
                      <TD>{s.formSubmitted}</TD>
                      <TD>{s.agreementSent}</TD>
                      <TD>{s.paymentCompleted}</TD>
                      <TD>
                        <Badge tone="success">{s.enrolled}</Badge>
                      </TD>
                      <TD className="font-medium">{conversion}</TD>
                      <TD className="whitespace-nowrap">{formatINR(s.revenuePaise)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
