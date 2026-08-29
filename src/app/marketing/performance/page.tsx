import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatINR } from "@/lib/utils";
import { AdmissionsCharts } from "@/components/admin/admissions-charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button, buttonVariants } from "@/components/ui/button";
import { computeMarketingStatsByCreator, conversionLabel, EMPTY_MARKETING_STATS } from "@/lib/marketing-stats";
import type { AppStatus } from "@/lib/types";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

export default async function YourPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from, to } = await searchParams;
  const { profile } = await requireRole(["marketing", "admin"]);
  const admin = createSupabaseAdminClient();

  // Own leads only — date range is cohort-based (when the lead was created),
  // same as the leads page and the admin-wide performance report.
  let query = admin
    .from("applications")
    .select("id, status, created_at, payments(amount, status)")
    .eq("created_by", profile.id);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  const { data: appsData } = await query;
  // Every row is already scoped to profile.id by the query above — inject it
  // directly rather than selecting created_by, since computeMarketingStatsByCreator
  // groups by that field.
  const rows = ((appsData ?? []) as unknown as {
    status: AppStatus;
    created_at: string;
    payments: { amount: number; status: string }[] | null;
  }[]).map((r) => ({ ...r, created_by: profile.id }));

  const statsByCreator = computeMarketingStatsByCreator(rows);
  const s = statsByCreator.get(profile.id) ?? EMPTY_MARKETING_STATS;
  const conversion = conversionLabel(s);

  const presetHref = (f: string, t: string) => `/marketing/performance?from=${f}&to=${t}`;
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
        <h1 className="font-display text-3xl font-semibold tracking-tight">Your performance</h1>
        <p className="text-muted-foreground">
          Your own leads, funnel progress, and revenue — nobody else&apos;s.
        </p>
      </div>

      <Card>
        <CardContent className="py-4">
          <form
            action="/marketing/performance"
            method="get"
            className="flex flex-wrap items-end gap-3"
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
              <Link href="/marketing/performance" className={buttonVariants({ variant: "ghost" })}>
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
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Leads created</div>
            <div className="font-display text-2xl font-semibold">{s.leads}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Enrolled</div>
            <div className="font-display text-2xl font-semibold">{s.enrolled}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Conversion</div>
            <div className="font-display text-2xl font-semibold">{conversion}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Revenue</div>
            <div className="font-display text-2xl font-semibold">{formatINR(s.revenuePaise)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funnel</CardTitle>
          <CardDescription>
            Cumulative — a lead counted in &quot;Payment completed&quot; is also counted in
            &quot;Agreement sent&quot; and &quot;Form submitted&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <FunnelStat label="Form submitted" value={s.formSubmitted} />
            <FunnelStat label="Agreement sent" value={s.agreementSent} />
            <FunnelStat label="Payment completed" value={s.paymentCompleted} />
            <FunnelStat label="Enrolled" value={s.enrolled} />
          </div>
        </CardContent>
      </Card>

      {s.leads === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No leads yet for this range.
          </CardContent>
        </Card>
      ) : (
        <AdmissionsCharts rows={rows} />
      )}
    </div>
  );
}

function FunnelStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-semibold">{value}</div>
    </div>
  );
}
