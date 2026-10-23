"use client";

import { useState } from "react";
import { CancelAssessmentButton } from "@/components/admin/cancel-assessment-button";
import { SubmitButton } from "@/components/submit-button";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { cn, formatInZone } from "@/lib/utils";
import { STATUS_LABEL, STATUS_TONE, type AppStatus, type BadgeTone } from "@/lib/types";

export interface ScheduledRow {
  id: string;
  starts_at: string;
  application_id: string;
  studentName: string;
  grade: string | null;
  teacherName: string | null;
  zoomJoinUrl: string | null;
  status: AppStatus;
}

// Synthetic status, not a real AppStatus — "missed" is computed (scheduled
// time has passed with no result ever recorded), not a column in the DB.
const MISSED = "MISSED" as const;
type TabKey = AppStatus | typeof MISSED;

const TAB_ORDER: TabKey[] = [
  "ASSESSMENT_SCHEDULED",
  MISSED,
  "ASSESSMENT_COMPLETED",
  "DETAILS_PENDING",
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
  "PAYMENT_COMPLETED",
  "ENROLLED",
  "NEEDS_ADMIN",
  "REJECTED",
];

const TAB_LABEL: Record<TabKey, string> = { ...STATUS_LABEL, [MISSED]: "Missed" };
const TAB_TONE: Record<TabKey, BadgeTone> = { ...STATUS_TONE, [MISSED]: "danger" };

export function ScheduledAssessmentsPanel({
  rows,
  schoolTz,
  schoolLabel,
  rescheduleMissedAssessment,
  grantRetest,
  generateZoomLink,
  cancelScheduledAssessment,
}: {
  rows: ScheduledRow[];
  schoolTz: string;
  schoolLabel: string;
  rescheduleMissedAssessment: (formData: FormData) => void;
  grantRetest: (formData: FormData) => void;
  generateZoomLink: (formData: FormData) => void;
  cancelScheduledAssessment: (formData: FormData) => void;
}) {
  const withTab = rows.map((r) => ({
    ...r,
    tab: (r.status === "ASSESSMENT_SCHEDULED" && new Date(r.starts_at).getTime() < Date.now()
      ? MISSED
      : r.status) as TabKey,
  }));

  const counts = withTab.reduce<Partial<Record<TabKey, number>>>((acc, r) => {
    acc[r.tab] = (acc[r.tab] ?? 0) + 1;
    return acc;
  }, {});
  const tabs = TAB_ORDER.filter((t) => counts[t]);

  const [active, setActive] = useState<TabKey>(tabs[0] ?? "ASSESSMENT_SCHEDULED");
  const visible = withTab.filter((r) => r.tab === active);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <TabButton key={t} active={active === t} tone={TAB_TONE[t]} onClick={() => setActive(t)}>
            {TAB_LABEL[t]} <span className="opacity-70">({counts[t]})</span>
          </TabButton>
        ))}
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assessments in this view.</p>
        ) : (
          visible.map((s) => {
            const missed = s.tab === MISSED;
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{s.studentName}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · Grade {s.grade ?? "—"} · {s.teacherName ?? "Unassigned"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatInZone(s.starts_at, schoolTz)} {schoolLabel}
                  </span>
                  {missed ? (
                    <Badge tone="danger">Missed</Badge>
                  ) : (
                    <StatusBadge status={s.status} />
                  )}
                  {missed ? (
                    <form action={rescheduleMissedAssessment}>
                      <input type="hidden" name="application_id" value={s.application_id} />
                      <SubmitButton size="sm" variant="outline" pendingText="Releasing…">
                        Reschedule
                      </SubmitButton>
                    </form>
                  ) : s.status === "REJECTED" ? (
                    <form action={grantRetest}>
                      <input type="hidden" name="application_id" value={s.application_id} />
                      <SubmitButton size="sm" variant="outline" pendingText="Granting…">
                        Grant retest
                      </SubmitButton>
                    </form>
                  ) : (
                    !s.zoomJoinUrl &&
                    s.status !== "ASSESSMENT_COMPLETED" && (
                      <form action={generateZoomLink}>
                        <input type="hidden" name="application_id" value={s.application_id} />
                        <SubmitButton size="sm" variant="outline" pendingText="Creating…">
                          Generate Zoom link
                        </SubmitButton>
                      </form>
                    )
                  )}
                  {!missed && s.status === "ASSESSMENT_SCHEDULED" && (
                    <CancelAssessmentButton action={cancelScheduledAssessment} applicationId={s.application_id} />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  tone = "neutral",
  onClick,
  children,
}: {
  active: boolean;
  tone?: BadgeTone;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const TONE_RING: Record<BadgeTone, string> = {
    neutral: "ring-border",
    info: "ring-primary/30",
    warning: "ring-amber-300",
    success: "ring-emerald-300",
    danger: "ring-red-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
        active
          ? cn("bg-primary text-primary-foreground ring-primary")
          : cn("bg-card text-muted-foreground hover:text-foreground", TONE_RING[tone]),
      )}
    >
      {children}
    </button>
  );
}
