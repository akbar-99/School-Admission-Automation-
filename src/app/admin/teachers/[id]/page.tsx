import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  computeTeacherStatsByTeacher,
  EMPTY_TEACHER_STATS,
  teacherCompletionLabel,
  type TeacherResultRow,
  type TeacherSlotRow,
} from "@/lib/teacher-stats";
import { outcomeLabel } from "@/lib/types";

const STAT_CARDS: { key: keyof typeof EMPTY_TEACHER_STATS; label: string }[] = [
  { key: "totalSlots", label: "Total slots" },
  { key: "claimed", label: "Claimed from pool" },
  { key: "assignedByAdmin", label: "Assigned by admin" },
  { key: "booked", label: "Booked" },
  { key: "completed", label: "Completed" },
  { key: "eligible", label: "Eligible" },
  { key: "notEligible", label: "Not eligible" },
  { key: "unavailableReported", label: "Unavailable reported" },
];

export default async function TeacherDetailPage({
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
  const { data: teacher } = await admin.from("users").select("id, full_name, email").eq("id", id).maybeSingle();
  if (!teacher) notFound();

  let slotQuery = admin
    .from("assessment_slots")
    .select(
      "id, teacher_id, starts_at, application_id, claimed_by_teacher, unavailable_reported, applications(lead_student_name, students(full_name))",
    )
    .eq("teacher_id", id)
    .order("starts_at", { ascending: false })
    .limit(200);
  if (from) slotQuery = slotQuery.gte("starts_at", `${from}T00:00:00`);
  if (to) slotQuery = slotQuery.lte("starts_at", `${to}T23:59:59`);
  const { data: slotData } = await slotQuery;
  const slots = (slotData ?? []) as unknown as TeacherSlotRow[];

  const applicationIds = slots.map((s) => s.application_id).filter((v): v is string => Boolean(v));
  const { data: resultData } =
    applicationIds.length > 0
      ? await admin.from("assessment_results").select("application_id, teacher_id, outcome").in("application_id", applicationIds)
      : { data: [] };
  const results = (resultData ?? []) as unknown as TeacherResultRow[];
  const resultByApplication = new Map(results.map((r) => [r.application_id, r]));

  const stats = computeTeacherStatsByTeacher(slots, results).get(id)?.stats ?? EMPTY_TEACHER_STATS;
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
          {teacher.full_name ?? teacher.email ?? "—"}
        </h1>
        <p className="text-muted-foreground">Full assessment slot detail for this teacher.</p>
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
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Completion rate
            </div>
            <div className="font-display text-2xl font-semibold">{teacherCompletionLabel(stats)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All slots ({slots.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No slots yet for this range.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Student</TH>
                  <TH>Date &amp; time</TH>
                  <TH>Source</TH>
                  <TH>Status</TH>
                  <TH>Outcome</TH>
                </TR>
              </THead>
              <TBody>
                {slots.map((s) => {
                  const result = s.application_id ? resultByApplication.get(s.application_id) : undefined;
                  return (
                    <TR key={s.id}>
                      <TD className="font-medium">
                        {s.applications?.students?.full_name ?? s.applications?.lead_student_name ?? "—"}
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.starts_at)}</TD>
                      <TD>{s.claimed_by_teacher ? "Claimed" : "Assigned by admin"}</TD>
                      <TD>
                        {s.unavailable_reported ? (
                          <Badge tone="warning">Unavailable reported</Badge>
                        ) : result ? (
                          <Badge tone="success">Completed</Badge>
                        ) : s.application_id ? (
                          <Badge tone="info">Booked</Badge>
                        ) : (
                          <Badge tone="neutral">Open</Badge>
                        )}
                      </TD>
                      <TD>{result ? outcomeLabel(result.outcome) : "—"}</TD>
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
