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
import { Alert } from "@/components/ui/alert";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { AppStatus } from "@/lib/types";

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

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { created, error } = await searchParams;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("applications")
    .select("id, status, category, grade_applying, lead_student_name, access_token, created_at, parents(full_name, phone, email), students(full_name)")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as unknown as Row[];

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
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads yet.</p>
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
