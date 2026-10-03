import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { applyUrl } from "@/lib/parent";
import { formatDateTime, cn } from "@/lib/utils";
import { createLead, claimLead, dismissLead, addContactInfo, markWithdrawn, restoreWithdrawn } from "./actions";
import { LeadSourceSelect } from "@/components/marketing/lead-source-select";
import { describeFilters, parseAdmissionsFilters } from "@/lib/admissions-report";
import { StatusBadge } from "@/components/status-badge";
import { WithdrawalBadge } from "@/components/withdrawal-badge";
import { Badge } from "@/components/ui/badge";
import { SourceIcon, InstagramIcon, FacebookIcon } from "@/components/icons/lead-source-icons";
import { CopyButton } from "@/components/copy-button";
import { PhoneField } from "@/components/apply/phone-field";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { FileDown, FileSpreadsheet } from "lucide-react";
import { REACHED_PAYMENT } from "@/lib/marketing-stats";
import { STATUS_LABEL, leadSourceLabel, type AppStatus, type WithdrawalType } from "@/lib/types";

interface Row {
  id: string;
  status: AppStatus;
  category: string | null;
  grade_applying: string | null;
  lead_student_name: string | null;
  lead_source: string | null;
  lead_source_other: string | null;
  external_contact_id: string | null;
  access_token: string;
  created_at: string;
  withdrawn_at: string | null;
  withdrawal_type: WithdrawalType | null;
  withdrawal_reason: string | null;
  payments: { status: string; refunded_at: string | null; refund_reason: string | null }[] | null;
  parents: { full_name: string; phone: string | null; email: string | null } | null;
  students: { full_name: string } | null;
}

interface UnclaimedRow {
  id: string;
  lead_source: string | null;
  lead_source_other: string | null;
  lead_message: string | null;
  created_at: string;
  parents: { full_name: string } | null;
  // Last reply staff typed straight into the Instagram app (not this app) —
  // means the enquiry is already being handled somewhere else.
  lastAppReply?: string | null;
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
    claimed?: string;
    dismissed?: string;
    view?: string;
  }>;
}) {
  const { created, error, duplicate, status, from, to, claimed, dismissed, view } = await searchParams;
  let duplicateInfo: {
    input: {
      parent_name: string;
      phone: string;
      email: string;
      student_name?: string;
      lead_source: string;
      lead_source_other?: string;
    };
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
      {claimed && <Alert variant="success">Enquiry claimed — it&apos;s now in your leads below.</Alert>}
      {dismissed && (
        <Alert variant="success">
          Enquiry dismissed. If this parent sends a new message, it&apos;ll come back to the pool automatically.
        </Alert>
      )}

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
              <input type="hidden" name="lead_source_other" value={duplicateInfo.input.lead_source_other ?? ""} />
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

      <Suspense fallback={null}>
        <UnclaimedLeadsSection />
      </Suspense>

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
        <LeadsTableSection status={status} from={from} to={to} view={view} hasFilters={hasFilters} />
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

async function UnclaimedLeadsSection() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("applications")
    .select("id, lead_source, lead_source_other, lead_message, created_at, parents(full_name)")
    .is("created_by", null)
    .is("dismissed_at", null)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as UnclaimedRow[];
  if (rows.length === 0) return null;

  // Staff replies typed straight into the native app (Instagram or
  // Facebook) arrive as outbound messages with no sender in this app —
  // surface the latest per enquiry. Querying both tables for every id is
  // harmless: an id from the other platform simply matches nothing.
  const appIds = rows.map((r) => r.id);
  const [{ data: igReplies }, { data: fbReplies }] = await Promise.all([
    admin
      .from("instagram_messages")
      .select("application_id, message_text, created_at")
      .in("application_id", appIds)
      .eq("direction", "outbound")
      .is("sent_by", null)
      .order("created_at", { ascending: true }),
    admin
      .from("facebook_messages")
      .select("application_id, message_text, created_at")
      .in("application_id", appIds)
      .eq("direction", "outbound")
      .is("sent_by", null)
      .order("created_at", { ascending: true }),
  ]);
  const lastReplyByApp = new Map<string, string>();
  for (const m of [...(igReplies ?? []), ...(fbReplies ?? [])]) lastReplyByApp.set(m.application_id, m.message_text);
  for (const r of rows) r.lastAppReply = lastReplyByApp.get(r.id) ?? null;

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle>Unclaimed enquiries ({rows.length})</CardTitle>
        <CardDescription>
          Captured automatically from social media DMs — first to claim it owns it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5"
          >
            <div>
              <div className="font-medium">{r.parents?.full_name ?? "—"}</div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <SourceIcon source={r.lead_source ?? "other"} className="size-3.5 shrink-0" />
                {leadSourceLabel(r.lead_source, r.lead_source_other)} · {formatDateTime(r.created_at)}
              </div>
              {r.lead_message && (
                <div className="mt-1 max-w-md text-sm italic text-foreground/80">
                  &quot;{r.lead_message}&quot;
                </div>
              )}
              {r.lastAppReply && (
                <div className="mt-2 max-w-md space-y-1">
                  <Badge tone="warning">
                    Already replied on {leadSourceLabel(r.lead_source, r.lead_source_other)}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    Last reply: &quot;{r.lastAppReply}&quot;
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <form action={dismissLead}>
                <input type="hidden" name="application_id" value={r.id} />
                <SubmitButton size="sm" variant="ghost" pendingText="…">
                  Dismiss
                </SubmitButton>
              </form>
              <form action={claimLead}>
                <input type="hidden" name="application_id" value={r.id} />
                <SubmitButton size="sm" pendingText="Claiming…">
                  Claim
                </SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

async function LeadsTableSection({
  status,
  from,
  to,
  view,
  hasFilters,
}: {
  status?: string;
  from?: string;
  to?: string;
  view?: string;
  hasFilters: boolean;
}) {
  const { profile } = await requireRole(["marketing", "admin", "coo"]);
  // Marketing only sees leads they created themselves; admin sees everything.
  const scopedToOwn = profile.role === "marketing";
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("applications")
    .select(
      "id, status, category, grade_applying, lead_student_name, lead_source, lead_source_other, external_contact_id, access_token, created_at, withdrawn_at, withdrawal_type, withdrawal_reason, payments(status, refunded_at, refund_reason), parents(full_name, phone, email), students(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (scopedToOwn) query = query.eq("created_by", profile.id);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);

  const { data } = await query;
  const allRows = (data ?? []) as unknown as Row[];

  // Chat activity, per lead — lets the list show at a glance whether a
  // conversation has started and who sent the last message, instead of
  // having to open each one's Chat page to check. Only leads with a social
  // DM contact id can ever have rows in these tables.
  const chatAppIds = allRows.filter((r) => r.external_contact_id).map((r) => r.id);
  const lastMessageByApp = new Map<string, { direction: "inbound" | "outbound"; created_at: string }>();
  if (chatAppIds.length > 0) {
    const [{ data: igMsgs }, { data: fbMsgs }] = await Promise.all([
      admin
        .from("instagram_messages")
        .select("application_id, direction, created_at")
        .in("application_id", chatAppIds)
        .order("created_at", { ascending: true }),
      admin
        .from("facebook_messages")
        .select("application_id, direction, created_at")
        .in("application_id", chatAppIds)
        .order("created_at", { ascending: true }),
    ]);
    for (const m of [...(igMsgs ?? []), ...(fbMsgs ?? [])]) {
      lastMessageByApp.set(m.application_id, { direction: m.direction, created_at: m.created_at });
    }
  }

  // Instagram/Facebook DMs land here without a phone number yet — they need
  // the rep to fill it in before they look/behave like a normal lead. Mixed
  // into the same list as everyone else, the marketing team kept confusing
  // them for incomplete/broken leads, so they get their own tab instead.
  const isDmNeedsContact = (r: Row) =>
    !r.parents?.phone && (r.lead_source === "instagram" || r.lead_source === "facebook");
  const dmRows = allRows.filter(isDmNeedsContact);
  const mainRows = allRows.filter((r) => !isDmNeedsContact(r));
  const showingDm = view === "dm";
  const rows = showingDm ? dmRows : mainRows;

  // Quick date-range presets — each preserves the current status/view filter.
  const presetHref = (f: string, t: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (showingDm) params.set("view", "dm");
    params.set("from", f);
    params.set("to", t);
    return `/marketing?${params.toString()}#leads`;
  };
  const tabHref = (dm: boolean) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (dm) params.set("view", "dm");
    const qs = params.toString();
    return `/marketing${qs ? `?${qs}` : ""}#leads`;
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
    <Card id="leads">
      <CardHeader>
        <CardTitle>
          {showingDm ? "Instagram/Facebook — needs contact info" : scopedToOwn ? "Your leads" : "All leads"} (
          {rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href={tabHref(false)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              !showingDm
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary/70",
            )}
          >
            All leads ({mainRows.length})
          </Link>
          <Link
            href={tabHref(true)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-white transition-opacity",
              showingDm ? "opacity-100 ring-2 ring-offset-2 ring-offset-background ring-foreground/30" : "opacity-70 hover:opacity-90",
            )}
            style={{
              background:
                "linear-gradient(90deg, #1877F2 0%, #405DE6 20%, #833AB4 45%, #C13584 65%, #E1306C 80%, #FD8D32 100%)",
            }}
          >
            <InstagramIcon className="size-3.5 shrink-0" />
            <FacebookIcon className="size-3.5 shrink-0" />
            Instagram/Facebook — needs contact info ({dmRows.length})
          </Link>
        </div>
        <div className="mb-4 space-y-3 border-b border-border pb-4">
          <form action="/marketing#leads" method="get" className="flex flex-wrap items-end gap-3">
            {showingDm && <input type="hidden" name="view" value="dm" />}
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
              <Link href={tabHref(showingDm)} className={buttonVariants({ variant: "ghost" })}>
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
            {hasFilters
              ? "No leads match this filter."
              : showingDm
                ? "No Instagram/Facebook leads waiting on contact info."
                : "No leads yet."}
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
                <TH>Withdrawal</TH>
                <TH>Created</TH>
                <TH>Link</TH>
                <TH></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <div className="font-medium">{r.parents?.full_name ?? "—"}</div>
                    {r.parents?.phone ? (
                      <div className="text-xs text-muted-foreground">{r.parents.phone}</div>
                    ) : (
                      <form action={addContactInfo} className="mt-1 flex flex-wrap items-center gap-1.5">
                        <input type="hidden" name="application_id" value={r.id} />
                        <PhoneField id={`phone-${r.id}`} name="phone" placeholder="9XXXXXXXXX" required />
                        <Input name="email" type="email" placeholder="Email (optional)" className="h-9 w-36" />
                        <SubmitButton size="sm" variant="outline" pendingText="…">
                          Save
                        </SubmitButton>
                      </form>
                    )}
                  </TD>
                  <TD>{r.students?.full_name ?? r.lead_student_name ?? "—"}</TD>
                  <TD>{r.category ?? "—"}</TD>
                  <TD>{leadSourceLabel(r.lead_source, r.lead_source_other)}</TD>
                  <TD>{r.grade_applying ?? "—"}</TD>
                  <TD>
                    <div className="space-y-1">
                      <StatusBadge status={r.status} />
                      {(() => {
                        const refunded = r.payments?.find((p) => p.status === "refunded");
                        return refunded ? (
                          <Badge tone="warning" className="block w-fit" title={refunded.refund_reason ?? undefined}>
                            Refunded
                          </Badge>
                        ) : null;
                      })()}
                    </div>
                  </TD>
                  <TD className="min-w-[180px]">
                    {r.withdrawn_at && r.withdrawal_type ? (
                      <div className="space-y-1">
                        <WithdrawalBadge type={r.withdrawal_type} reason={r.withdrawal_reason} />
                        {profile.role !== "marketing" && (
                          <form action={restoreWithdrawn}>
                            <input type="hidden" name="application_id" value={r.id} />
                            <button type="submit" className="block text-xs text-muted-foreground underline-offset-2 hover:underline">
                              Restore
                            </button>
                          </form>
                        )}
                      </div>
                    ) : REACHED_PAYMENT.has(r.status) ? (
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-medium text-primary underline-offset-2 hover:underline">
                          Mark as withdrawn
                        </summary>
                        <form action={markWithdrawn} className="mt-1.5 space-y-1.5">
                          <input type="hidden" name="application_id" value={r.id} />
                          <Textarea
                            name="reason"
                            required
                            placeholder="Why are they backing out?"
                            className="h-16 w-56 text-xs"
                          />
                          <SubmitButton size="sm" variant="outline" pendingText="…">
                            Confirm withdrawal
                          </SubmitButton>
                        </form>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.created_at)}
                  </TD>
                  <TD>
                    <CopyButton value={applyUrl(r.access_token)} variant="ghost" />
                  </TD>
                  <TD>
                    {r.external_contact_id && (
                      <div className="space-y-1">
                        <Link href={`/marketing/leads/${r.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                          Chat
                        </Link>
                        {(() => {
                          const last = lastMessageByApp.get(r.id);
                          if (!last) {
                            return <p className="text-xs text-muted-foreground">No messages yet</p>;
                          }
                          return (
                            <Badge tone={last.direction === "inbound" ? "warning" : "success"} className="block w-fit">
                              {last.direction === "inbound" ? "Awaiting reply" : "Replied"} ·{" "}
                              {formatDateTime(last.created_at)}
                            </Badge>
                          );
                        })()}
                      </div>
                    )}
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
