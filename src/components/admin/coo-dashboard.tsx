"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { STATUS_LABEL, type AppStatus } from "@/lib/types";
import type { CooBucket, CooFunnelStats, CooStatsRow } from "@/lib/marketing-stats";

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
  { key: "waitingAssessment", label: "Waiting for assessment" },
  { key: "assessmentCompleted", label: "Assessment completed" },
  { key: "waitingPayment", label: "Waiting for payment" },
  { key: "admissionCompleted", label: "Admission completed" },
  { key: "addedToCourse", label: "Added to course" },
];

type SortKey = CooBucket | "name" | "conversion";

const PALETTE = ["#1b7e9a", "#2f8f6b", "#c08a2d", "#94ac9f", "#c0392b", "#475569", "#7c5cbf", "#0f766e"];

export function CooDashboard({
  staff,
  totals,
}: {
  staff: StaffEntry[];
  totals: CooFunnelStats;
}) {
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

  const maxConversion = Math.max(1, ...staff.map((s) => Math.max(0, conversionValue(s.stats))));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {COLUMNS.map((c) => (
          <Card key={c.key} className="shadow-luxe">
            <CardContent className="py-5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</div>
              <div className="font-display text-2xl font-semibold">{totals[c.key]}</div>
            </CardContent>
          </Card>
        ))}
      </div>

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
                    <div className="w-32 shrink-0 truncate text-sm font-medium">{s.name}</div>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                      />
                    </div>
                    <div className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                      {conversionLabel(s.stats)}
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
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 pr-4 font-medium">{s.name}</td>
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
