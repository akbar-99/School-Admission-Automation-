import Link from "next/link";
import { Suspense } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatINR, formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { markPaymentRefunded } from "./actions";
import type { PaymentState } from "@/lib/types";

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  status: PaymentState;
  receipt: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  includes_admission: boolean;
  includes_study_material: boolean;
  admission_amount: number;
  study_material_amount: number;
  refunded_at: string | null;
  refund_reason: string | null;
  created_at: string;
  updated_at: string;
  applications: {
    id: string;
    admission_number: string | null;
    grade_applying: string | null;
    students: { full_name: string } | null;
    parents: { full_name: string; phone: string } | null;
  } | null;
}

const STATUS_TONE: Record<PaymentState, "neutral" | "success" | "warning" | "danger" | "info"> = {
  created: "neutral",
  pending: "info",
  completed: "success",
  failed: "danger",
  abandoned: "warning",
  refunded: "warning",
};

function describe(p: Pick<PaymentRow, "includes_admission" | "includes_study_material">): string {
  if (p.includes_admission && p.includes_study_material) return "Admission fee + Study material";
  if (p.includes_study_material) return "Study material";
  return "Admission fee";
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; from?: string; to?: string; error?: string; refunded?: string }>;
}) {
  const { status, from, to, error, refunded } = await searchParams;
  const hasFilters = Boolean(status || from || to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Payments</h1>
        <p className="text-muted-foreground">
          Every payment attempt across the school — transaction IDs, references, and status.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {refunded && <Alert variant="success">Marked as refunded — the marketing rep who owns this lead has been notified.</Alert>}

      <Suspense fallback={<PaymentsTableSkeleton />}>
        <PaymentsTable status={status} from={from} to={to} hasFilters={hasFilters} />
      </Suspense>
    </div>
  );
}

function PaymentsTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-2 pt-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}

async function PaymentsTable({
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
  const admin = createSupabaseAdminClient();

  let query = admin
    .from("payments")
    .select(
      "id, amount, currency, status, receipt, razorpay_order_id, razorpay_payment_id, includes_admission, includes_study_material, admission_amount, study_material_amount, refunded_at, refund_reason, created_at, updated_at, applications(id, admission_number, grade_applying, students(full_name), parents(full_name, phone))",
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);

  const { data } = await query;
  const rows = (data ?? []) as unknown as PaymentRow[];

  const totals = rows.reduce(
    (acc, r) => {
      if (r.status === "completed") acc.completed += r.amount;
      if (r.status === "refunded") acc.refunded += r.amount;
      acc.count += 1;
      return acc;
    },
    { completed: 0, refunded: 0, count: 0 },
  );

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Total collected (this filter)</div>
            <div className="font-display text-2xl font-semibold">{formatINR(totals.completed)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Total refunded (this filter)</div>
            <div className="font-display text-2xl font-semibold">{formatINR(totals.refunded)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <div className="text-sm text-muted-foreground">Transactions (this filter)</div>
            <div className="font-display text-2xl font-semibold">{totals.count}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All transactions ({rows.length})</CardTitle>
          <CardDescription>Most recent first.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/admin/payments" method="get" className="mb-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={status ?? ""} className="w-44">
                <option value="">All statuses</option>
                <option value="created">Created</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="abandoned">Abandoned</option>
                <option value="refunded">Refunded</option>
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
              <Link href="/admin/payments" className={buttonVariants({ variant: "ghost" })}>
                Clear
              </Link>
            )}
          </form>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {hasFilters ? "No payments match this filter." : "No payments yet."}
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Student / Parent</TH>
                  <TH>Admission no.</TH>
                  <TH>Description</TH>
                  <TH>Amount</TH>
                  <TH>Status</TH>
                  <TH>Refund</TH>
                  <TH>Transaction ID</TH>
                  <TH>Order ID</TH>
                  <TH>Reference</TH>
                  <TH>Date &amp; time</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      {p.applications ? (
                        <Link href={`/admin/applications/${p.applications.id}`} className="hover:underline">
                          <div className="font-medium">
                            {p.applications.students?.full_name ?? p.applications.parents?.full_name ?? "—"}
                          </div>
                          <div className="text-xs text-muted-foreground">{p.applications.parents?.full_name}</div>
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="font-mono text-xs">{p.applications?.admission_number ?? "—"}</TD>
                    <TD className="whitespace-nowrap">{describe(p)}</TD>
                    <TD className="whitespace-nowrap">
                      <div className="font-medium tabular-nums">{formatINR(p.amount)}</div>
                      {p.includes_admission && p.includes_study_material && (
                        <div className="text-xs text-muted-foreground">
                          {formatINR(p.admission_amount)} + {formatINR(p.study_material_amount)}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                    </TD>
                    <TD className="min-w-[180px]">
                      {p.status === "refunded" ? (
                        <div>
                          <div className="text-xs text-muted-foreground">{formatDateTime(p.refunded_at!)}</div>
                          {p.refund_reason && <div className="text-xs">{p.refund_reason}</div>}
                        </div>
                      ) : p.status === "completed" ? (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-medium text-primary underline-offset-2 hover:underline">
                            Mark as refunded
                          </summary>
                          <form action={markPaymentRefunded} className="mt-1.5 space-y-1.5">
                            <input type="hidden" name="payment_id" value={p.id} />
                            <Textarea
                              name="reason"
                              required
                              placeholder="Why is this being refunded?"
                              className="h-16 w-56 text-xs"
                            />
                            <SubmitButton size="sm" variant="outline" pendingText="…">
                              Confirm refund
                            </SubmitButton>
                          </form>
                        </details>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="max-w-40 truncate font-mono text-xs">{p.razorpay_payment_id ?? "—"}</TD>
                    <TD className="max-w-40 truncate font-mono text-xs">{p.razorpay_order_id ?? "—"}</TD>
                    <TD className="max-w-32 truncate font-mono text-xs">{p.receipt ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">
                      {formatDateTime(p.status === "completed" ? p.updated_at : p.created_at)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
