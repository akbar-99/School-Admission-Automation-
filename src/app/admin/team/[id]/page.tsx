import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime, formatINR } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { SourceIcon } from "@/components/icons/lead-source-icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  computeCooStatsByCreator,
  computeCurriculumBreakdown,
  computeSourceBreakdown,
  cooConversionLabel,
  EMPTY_COO_STATS,
  type CooStatsRow,
} from "@/lib/marketing-stats";
import { leadSourceLabel, type AppStatus } from "@/lib/types";

const STAT_CARDS: { key: keyof typeof EMPTY_COO_STATS; label: string }[] = [
  { key: "enquiries", label: "Total enquiries" },
  { key: "claimed", label: "Claimed from pool" },
  { key: "waitingAssessment", label: "Waiting for assessment" },
  { key: "assessmentCompleted", label: "Assessment completed" },
  { key: "waitingPayment", label: "Waiting for payment" },
  { key: "admissionCompleted", label: "Admission completed" },
  { key: "addedToCourse", label: "Added to course" },
];

const PALETTE = ["#1b7e9a", "#2f8f6b", "#c08a2d", "#94ac9f", "#c0392b", "#475569"];

export default async function TeamMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireRole(["admin", "coo"]);
  const { id } = await params;
  const { from, to } = await searchParams;

  const admin = createSupabaseAdminClient();
  const { data: member } = await admin.from("users").select("id, full_name, email").eq("id", id).maybeSingle();
  if (!member) notFound();

  let query = admin
    .from("applications")
    .select(
      "id, status, grade_applying, created_by, erp_status, created_at, lead_student_name, lead_source, lead_source_other, external_contact_id, lead_message, preferred_curriculum, category, students(full_name, curriculum), parents(full_name), payments(amount, status)",
    )
    .eq("created_by", id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (from) query = query.gte("created_at", `${from}T00:00:00`);
  if (to) query = query.lte("created_at", `${to}T23:59:59`);
  const { data } = await query;
  const rows = (data ?? []) as unknown as (CooStatsRow & { category: string | null; lead_message: string | null })[];

  const stats = computeCooStatsByCreator(rows).get(id)?.stats ?? EMPTY_COO_STATS;
  const sourceBreakdown = computeSourceBreakdown(rows);
  const curriculumBreakdown = computeCurriculumBreakdown(rows);
  const maxSource = Math.max(1, ...sourceBreakdown.map((s) => s.count));
  const rangeQuery = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/admin/coo-dashboard${rangeQuery ? `?${rangeQuery}` : ""}`}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to Team dashboard
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {member.full_name ?? member.email ?? "—"}
        </h1>
        <p className="text-muted-foreground">Full enquiry-to-enrollment detail for this team member.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {STAT_CARDS.map((c) => (
          <Card key={c.key} className="shadow-luxe">
            <CardContent className="py-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="font-display text-2xl font-semibold">{stats[c.key]}</div>
            </CardContent>
          </Card>
        ))}
        <Card className="shadow-luxe">
          <CardContent className="py-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conversion rate</div>
            <div className="font-display text-2xl font-semibold">{cooConversionLabel(stats)}</div>
          </CardContent>
        </Card>
        <Card className="shadow-luxe">
          <CardContent className="py-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue</div>
            <div className="font-display text-2xl font-semibold">{formatINR(stats.revenuePaise)}</div>
          </CardContent>
        </Card>
        {curriculumBreakdown.map((c) => (
          <Card key={c.curriculum} className="shadow-luxe">
            <CardContent className="py-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {c.curriculum} enrolled
              </div>
              <div className="font-display text-2xl font-semibold">{c.count}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Leads by source</CardTitle>
          <CardDescription>Which channel their enquiries come from.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sourceBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enquiries yet for this range.</p>
          ) : (
            sourceBreakdown.map((s, i) => {
              const pct = Math.round((s.count / maxSource) * 100);
              return (
                <div key={s.source} className="flex items-center gap-3">
                  <div className="flex w-28 shrink-0 items-center gap-1.5 truncate text-sm font-medium">
                    <SourceIcon source={s.source} className="size-4 shrink-0" />
                    {s.label}
                  </div>
                  <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                    />
                  </div>
                  <div className="w-10 shrink-0 text-right text-sm font-medium tabular-nums">{s.count}</div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All leads ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads yet for this range.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Parent</TH>
                  <TH>Student</TH>
                  <TH>Category</TH>
                  <TH>Source</TH>
                  <TH>Grade</TH>
                  <TH>Curriculum</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const isDm = Boolean(r.external_contact_id);
                  const pending = <span className="text-xs italic text-muted-foreground">{isDm ? "Not collected yet" : "—"}</span>;
                  return (
                    <TR key={r.id}>
                      <TD className="max-w-[260px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.parents?.full_name ?? "—"}</span>
                          {isDm && (
                            <Badge tone="info">
                              <SourceIcon source={r.lead_source ?? "instagram"} className="mr-1 size-3" />
                              DM
                            </Badge>
                          )}
                          {isDm && (
                            <Link href={`/marketing/leads/${r.id}`} className="text-xs text-primary underline-offset-2 hover:underline">
                              Chat
                            </Link>
                          )}
                        </div>
                        {isDm && r.lead_message && (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground" title={r.lead_message}>
                            “{r.lead_message}”
                          </div>
                        )}
                      </TD>
                      <TD>{r.students?.full_name ?? r.lead_student_name ?? pending}</TD>
                      <TD>{r.category ?? pending}</TD>
                      <TD>{leadSourceLabel(r.lead_source, r.lead_source_other)}</TD>
                      <TD>{r.grade_applying ?? pending}</TD>
                      <TD>{r.students?.curriculum ?? r.preferred_curriculum ?? pending}</TD>
                      <TD>
                        <StatusBadge status={r.status as AppStatus} />
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.created_at)}</TD>
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
