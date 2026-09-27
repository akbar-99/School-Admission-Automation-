"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown, Crown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatINR } from "@/lib/utils";
import { STATUS_LABEL, type AppStatus, type WithdrawalType } from "@/lib/types";
import { SourceIcon } from "@/components/icons/lead-source-icons";
import { WithdrawalBadge } from "@/components/withdrawal-badge";
import type { CooBucket, CooFunnelStats, CooStatsRow, WithdrawalStats } from "@/lib/marketing-stats";

// Mirrors cooConversionValue/cooConversionLabel in lib/marketing-stats.ts —
// duplicated (not imported) because that module is server-only and this is a
// Client Component; the formula is a one-liner so drift risk is negligible.
function conversionValue(stats: CooFunnelStats): number {
  return stats.enquiries > 0 ? (stats.admissionCompleted / stats.enquiries) * 100 : -1;
}
function conversionLabel(stats: CooFunnelStats): string {
  return stats.enquiries > 0 ? `${((stats.admissionCompleted / stats.enquiries) * 100).toFixed(1)}%` : "—";
}

interface StaffEntry {
  id: string;
  name: string;
  stats: CooFunnelStats;
  rows: Record<CooBucket, CooStatsRow[]>;
}

const COLUMNS: { key: CooBucket; label: string }[] = [
  { key: "enquiries", label: "Total enquiries" },
  { key: "claimed", label: "Claimed from pool" },
  { key: "waitingAssessment", label: "Waiting for assessment" },
  { key: "assessmentCompleted", label: "Assessment completed" },
  { key: "waitingPayment", label: "Waiting for payment" },
  { key: "admissionCompleted", label: "Admission completed" },
  { key: "addedToCourse", label: "Added to course" },
];

type SortKey = CooBucket | "name" | "conversion";

const PALETTE = ["#1b7e9a", "#2f8f6b", "#c08a2d", "#94ac9f", "#c0392b", "#475569", "#7c5cbf", "#0f766e"];

interface WithdrawalEntry {
  id: string;
  memberName: string;
  studentName: string;
  parentName: string;
  type: WithdrawalType;
  reason: string | null;
  withdrawnAt: string | null;
}

export function CooDashboard({
  staff,
  totals,
  sourceBreakdown,
  curriculumBreakdown,
  withdrawalStats,
  withdrawals,
  from,
  to,
}: {
  staff: StaffEntry[];
  totals: CooFunnelStats;
  sourceBreakdown: { source: string; label: string; count: number }[];
  curriculumBreakdown: { curriculum: string; count: number }[];
  withdrawalStats: WithdrawalStats;
  withdrawals: WithdrawalEntry[];
  from?: string;
  to?: string;
}) {
  const rangeQuery = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const maxSource = Math.max(1, ...sourceBreakdown.map((s) => s.count));
  const totalSourceCount = sourceBreakdown.reduce((n, s) => n + s.count, 0);
  const [sortKey, setSortKey] = useState<SortKey>("conversion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [modal, setModal] = useState<{ name: string; bucket: CooBucket } | null>(null);

  const sorted = useMemo(() => {
    const copy = [...staff];
    copy.sort((a, b) => {
      const va = sortKey === "name" ? a.name : sortKey === "conversion" ? conversionValue(a.stats) : a.stats[sortKey];
      const vb = sortKey === "name" ? b.name : sortKey === "conversion" ? conversionValue(b.stats) : b.stats[sortKey];
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [staff, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="size-3.5 opacity-40" />;
    return sortDir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />;
  }

  const activeStaff = modal ? staff.find((s) => s.name === modal.name) : null;
  const modalRows = activeStaff && modal ? activeStaff.rows[modal.bucket] : [];

  const topValue = Math.max(0, ...staff.map((s) => conversionValue(s.stats)));
  const isTop = (st: CooFunnelStats) => topValue > 0 && conversionValue(st) === topValue;
  const maxConversion = Math.max(1, ...staff.map((s) => Math.max(0, conversionValue(s.stats))));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {COLUMNS.map((c) => (
          <Card key={c.key} className="shadow-luxe">
            <CardContent className="py-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="font-display text-2xl font-semibold">{totals[c.key]}</div>
            </CardContent>
          </Card>
        ))}
        <Card className="shadow-luxe">
          <CardContent className="py-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total revenue</div>
            <div className="font-display text-2xl font-semibold">{formatINR(totals.revenuePaise)}</div>
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
        <Card className="shadow-luxe">
          <CardContent className="py-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pre-admission withdrawals
            </div>
            <div className="font-display text-2xl font-semibold">{withdrawalStats.preAdmission}</div>
          </CardContent>
        </Card>
        <Card className="shadow-luxe">
          <CardContent className="py-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Post-admission withdrawals
            </div>
            <div className="font-display text-2xl font-semibold">{withdrawalStats.postAdmission}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Withdrawals</CardTitle>
          <CardDescription>Enquiries that backed out after payment, with the reason, for the selected range.</CardDescription>
        </CardHeader>
        <CardContent>
          {withdrawals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No withdrawals for this range.</p>
          ) : (
            <ul className="space-y-3">
              {withdrawals.map((w) => (
                <li key={w.id} className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{w.studentName}</span>
                    <span className="text-xs text-muted-foreground">(parent: {w.parentName})</span>
                    <WithdrawalBadge type={w.type} reason={null} />
                  </div>
                  {w.reason && <p className="mt-1 text-sm text-foreground">{w.reason}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {w.memberName}
                    {w.withdrawnAt && ` · ${formatDateTime(w.withdrawnAt)}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Leads by source</CardTitle>
          <CardDescription>Which channel is actually producing enquiries, for the selected range.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sourceBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No enquiries yet for this range.</p>
          ) : (
            sourceBreakdown.map((s, i) => {
              const pct = Math.round((s.count / maxSource) * 100);
              const share = totalSourceCount > 0 ? Math.round((s.count / totalSourceCount) * 100) : 0;
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
                  <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                    {s.count} ({share}%)
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversion rate by team member</CardTitle>
          <CardDescription>Admission completed ÷ total enquiries handled, for the selected range.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No marketing staff yet.</p>
          ) : (
            [...staff]
              .sort((a, b) => conversionValue(b.stats) - conversionValue(a.stats))
              .map((s, i) => {
                const value = Math.max(0, conversionValue(s.stats));
                const pct = Math.round((value / maxConversion) * 100);
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <div className="flex w-36 shrink-0 items-center gap-1.5 truncate text-sm font-medium">
                      {isTop(s.stats) && <Crown className="size-4 shrink-0 fill-amber-400 text-amber-500" aria-label="Top performer" />}
                      <span className={isTop(s.stats) ? "truncate font-semibold text-amber-600" : "truncate"}>{s.name}</span>
                    </div>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: isTop(s.stats) ? "#f59e0b" : PALETTE[i % PALETTE.length] }}
                      />
                    </div>
                    <div className="w-40 shrink-0 text-right text-sm tabular-nums">
                      <span className="font-medium">{conversionLabel(s.stats)}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {s.stats.admissionCompleted} of {s.stats.enquiries} admitted
                      </span>
                    </div>
                  </div>
                );
              })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By marketing team member ({staff.length})</CardTitle>
          <CardDescription>
            Cumulative — an enquiry counted in &quot;Admission completed&quot; is also counted in
            &quot;Assessment completed&quot;. Click any number to see the students behind it. Click a
            column header to sort.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {staff.length === 0 ? (
            <p className="text-sm text-muted-foreground">No marketing staff yet.</p>
          ) : (
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      Team member <SortIcon column="name" />
                    </button>
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="py-2 pr-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                      >
                        {c.label} <SortIcon column={c.key} />
                      </button>
                    </th>
                  ))}
                  <th className="py-2 pr-4 text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort("conversion")}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      Conversion rate <SortIcon column="conversion" />
                    </button>
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 pr-4 font-medium">
                      <Link
                        href={`/admin/team/${s.id}${rangeQuery ? `?${rangeQuery}` : ""}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {s.name}
                      </Link>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="py-2.5 pr-4 text-right">
                        <button
                          type="button"
                          disabled={s.stats[c.key] === 0}
                          onClick={() => setModal({ name: s.name, bucket: c.key })}
                          className="rounded-md px-2 py-0.5 font-medium tabular-nums underline-offset-2 hover:bg-secondary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent disabled:hover:no-underline"
                        >
                          {s.stats[c.key]}
                        </button>
                      </td>
                    ))}
                    <td className="py-2.5 pr-4 text-right">
                      <Badge tone="success">{conversionLabel(s.stats)}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right whitespace-nowrap">{formatINR(s.stats.revenuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <div className="font-display text-lg font-semibold">
                  {COLUMNS.find((c) => c.key === modal.bucket)?.label}
                </div>
                <div className="text-sm text-muted-foreground">{modal.name}</div>
              </div>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {modalRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No students in this bucket.</p>
              ) : (
                <ul className="space-y-2">
                  {modalRows.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm">
                      <div className="font-medium">
                        {r.students?.full_name ?? r.lead_student_name ?? "Unnamed student"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Parent: {r.parents?.full_name ?? "—"} · {STATUS_LABEL[r.status as AppStatus] ?? r.status} ·{" "}
                        {formatDateTime(r.created_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
