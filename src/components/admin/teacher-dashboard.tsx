"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import type { TeacherBucket, TeacherFunnelStats, TeacherSlotRow } from "@/lib/teacher-stats";

// Mirrors teacherCompletionValue/teacherCompletionLabel in lib/teacher-stats.ts
// — duplicated (not imported) because that module is server-only and this is
// a Client Component; the formula is a one-liner so drift risk is negligible.
function completionValue(stats: TeacherFunnelStats): number {
  return stats.booked > 0 ? (stats.completed / stats.booked) * 100 : -1;
}
function completionLabel(stats: TeacherFunnelStats): string {
  return stats.booked > 0 ? `${((stats.completed / stats.booked) * 100).toFixed(1)}%` : "—";
}

interface TeacherEntry {
  id: string;
  name: string;
  stats: TeacherFunnelStats;
  slots: Record<TeacherBucket, TeacherSlotRow[]>;
}

const COLUMNS: { key: TeacherBucket; label: string }[] = [
  { key: "totalSlots", label: "Total slots" },
  { key: "claimed", label: "Claimed from pool" },
  { key: "assignedByAdmin", label: "Assigned by admin" },
  { key: "booked", label: "Booked" },
  { key: "completed", label: "Completed" },
  { key: "eligible", label: "Eligible" },
  { key: "notEligible", label: "Not eligible" },
  { key: "unavailableReported", label: "Unavailable reported" },
];

type SortKey = TeacherBucket | "name" | "completion";

const PALETTE = ["#1b7e9a", "#2f8f6b", "#c08a2d", "#94ac9f", "#c0392b", "#475569", "#7c5cbf", "#0f766e"];

export function TeacherDashboard({
  teachers,
  totals,
  from,
  to,
}: {
  teachers: TeacherEntry[];
  totals: TeacherFunnelStats;
  from?: string;
  to?: string;
}) {
  const rangeQuery = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const [sortKey, setSortKey] = useState<SortKey>("completion");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [modal, setModal] = useState<{ name: string; bucket: TeacherBucket } | null>(null);

  const sorted = useMemo(() => {
    const copy = [...teachers];
    copy.sort((a, b) => {
      const va = sortKey === "name" ? a.name : sortKey === "completion" ? completionValue(a.stats) : a.stats[sortKey];
      const vb = sortKey === "name" ? b.name : sortKey === "completion" ? completionValue(b.stats) : b.stats[sortKey];
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [teachers, sortKey, sortDir]);

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

  const activeTeacher = modal ? teachers.find((t) => t.name === modal.name) : null;
  const modalSlots = activeTeacher && modal ? activeTeacher.slots[modal.bucket] : [];

  const maxCompletion = Math.max(1, ...teachers.map((t) => Math.max(0, completionValue(t.stats))));

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
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Completion rate by teacher</CardTitle>
          <CardDescription>Completed ÷ booked, for the selected range.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {teachers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assessment teachers yet.</p>
          ) : (
            [...teachers]
              .sort((a, b) => completionValue(b.stats) - completionValue(a.stats))
              .map((t, i) => {
                const value = Math.max(0, completionValue(t.stats));
                const pct = Math.round((value / maxCompletion) * 100);
                return (
                  <div key={t.id} className="flex items-center gap-3">
                    <div className="w-32 shrink-0 truncate text-sm font-medium">{t.name}</div>
                    <div className="h-6 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: PALETTE[i % PALETTE.length] }}
                      />
                    </div>
                    <div className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                      {completionLabel(t.stats)}
                    </div>
                  </div>
                );
              })
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By assessment teacher ({teachers.length})</CardTitle>
          <CardDescription>
            Claimed + Assigned by admin = Total slots. Click any number to see the students behind it.
            Click a column header to sort.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {teachers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assessment teachers yet.</p>
          ) : (
            <table className="w-full min-w-[1000px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleSort("name")}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      Teacher <SortIcon column="name" />
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
                      onClick={() => toggleSort("completion")}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      Completion rate <SortIcon column="completion" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 pr-4 font-medium">
                      <Link
                        href={`/admin/teachers/${t.id}${rangeQuery ? `?${rangeQuery}` : ""}`}
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {t.name}
                      </Link>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="py-2.5 pr-4 text-right">
                        <button
                          type="button"
                          disabled={t.stats[c.key] === 0}
                          onClick={() => setModal({ name: t.name, bucket: c.key })}
                          className="rounded-md px-2 py-0.5 font-medium tabular-nums underline-offset-2 hover:bg-secondary hover:underline disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent disabled:hover:no-underline"
                        >
                          {t.stats[c.key]}
                        </button>
                      </td>
                    ))}
                    <td className="py-2.5 pr-4 text-right">
                      <Badge tone="success">{completionLabel(t.stats)}</Badge>
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
              {modalSlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No slots in this bucket.</p>
              ) : (
                <ul className="space-y-2">
                  {modalSlots.map((s) => (
                    <li key={s.id} className="rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-sm">
                      <div className="font-medium">
                        {s.applications?.students?.full_name ?? s.applications?.lead_student_name ?? "Open slot"}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDateTime(s.starts_at)}</div>
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
