import "server-only";
import { LEAD_SOURCE_LABEL, LEAD_SOURCES, type AppStatus, type WithdrawalType } from "@/lib/types";
import { needsAssessment } from "@/lib/assessment";
import { CURRICULUM_OPTIONS } from "@/lib/config";

// Statuses that mean a lead reached at least this funnel stage. Derived from
// the status machine (0002_functions.sql): once a lead leaves LEAD_CREATED /
// FORM_SUBMITTED it never goes back, so the current status alone tells us
// whether a milestone was ever reached — no history lookup needed.
// One known simplification: a lead that reached AGREEMENT_SENT or
// PAYMENT_COMPLETED but was later rejected from NEEDS_ADMIN (seat
// unavailable) ends up as REJECTED and isn't counted in these milestones,
// even though it did pass through them.
export const REACHED_AGREEMENT = new Set<AppStatus>([
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
  "PAYMENT_COMPLETED",
  "NEEDS_ADMIN",
  "ENROLLED",
]);
export const REACHED_PAYMENT = new Set<AppStatus>(["PAYMENT_COMPLETED", "NEEDS_ADMIN", "ENROLLED"]);

export interface MarketingFunnelStats {
  leads: number;
  formSubmitted: number;
  agreementSent: number;
  paymentCompleted: number;
  enrolled: number;
  revenuePaise: number;
}

export const EMPTY_MARKETING_STATS: MarketingFunnelStats = {
  leads: 0,
  formSubmitted: 0,
  agreementSent: 0,
  paymentCompleted: 0,
  enrolled: 0,
  revenuePaise: 0,
};

export interface MarketingStatsRow {
  status: AppStatus;
  created_by: string;
  payments: { amount: number; status: string }[] | null;
}

// Aggregate raw application rows into per-creator funnel stats. Shared by the
// admin-wide marketing performance report and each marketing user's own
// "Your performance" view.
export function computeMarketingStatsByCreator(
  rows: MarketingStatsRow[],
): Map<string, MarketingFunnelStats> {
  const byCreator = new Map<string, MarketingFunnelStats>();
  const statsFor = (id: string) => {
    let s = byCreator.get(id);
    if (!s) {
      s = { ...EMPTY_MARKETING_STATS };
      byCreator.set(id, s);
    }
    return s;
  };

  for (const row of rows) {
    const s = statsFor(row.created_by);
    s.leads += 1;
    if (row.status !== "LEAD_CREATED") s.formSubmitted += 1;
    if (REACHED_AGREEMENT.has(row.status)) s.agreementSent += 1;
    if (REACHED_PAYMENT.has(row.status)) s.paymentCompleted += 1;
    if (row.status === "ENROLLED") s.enrolled += 1;
    for (const p of row.payments ?? []) {
      if (p.status === "completed") s.revenuePaise += p.amount;
    }
  }

  return byCreator;
}

export function conversionLabel(stats: MarketingFunnelStats): string {
  return stats.leads > 0 ? `${((stats.enrolled / stats.leads) * 100).toFixed(1)}%` : "—";
}

// ---------------------------------------------------------------------------
// COO cross-team dashboard — a finer-grained, drill-down-capable breakdown of
// the same underlying applications, kept cumulative (same convention as
// above) so the two reports never disagree on what a given status means.
// ---------------------------------------------------------------------------

const WAITING_ASSESSMENT = new Set<AppStatus>(["FORM_SUBMITTED", "ASSESSMENT_SCHEDULED"]);
// Reached ASSESSMENT_COMPLETED or beyond — includes REJECTED, since a failed
// assessment still means the assessment itself was completed.
const REACHED_ASSESSMENT_COMPLETE = new Set<AppStatus>([
  "ASSESSMENT_COMPLETED",
  "DETAILS_PENDING",
  "AGREEMENT_SENT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "ABANDONED",
  "PAYMENT_COMPLETED",
  "NEEDS_ADMIN",
  "ENROLLED",
  "REJECTED",
]);
const WAITING_PAYMENT = new Set<AppStatus>(["AGREEMENT_SENT", "PAYMENT_PENDING", "PAYMENT_FAILED", "ABANDONED"]);

export interface CooFunnelStats {
  enquiries: number;
  claimed: number;
  waitingAssessment: number;
  assessmentCompleted: number;
  waitingPayment: number;
  admissionCompleted: number;
  addedToCourse: number;
  revenuePaise: number;
}

export const EMPTY_COO_STATS: CooFunnelStats = {
  enquiries: 0,
  claimed: 0,
  waitingAssessment: 0,
  assessmentCompleted: 0,
  waitingPayment: 0,
  admissionCompleted: 0,
  addedToCourse: 0,
  revenuePaise: 0,
};

export interface CooStatsRow {
  id: string;
  status: AppStatus;
  grade_applying: string | null;
  created_by: string;
  erp_status: string | null;
  created_at: string;
  lead_student_name: string | null;
  lead_source: string | null;
  lead_source_other: string | null;
  // Set only for a lead auto-captured from an inbound channel (e.g.
  // Instagram) and picked up via claim_lead — null for one this person
  // entered directly through the New lead form. Lets "claimed" be counted
  // separately from "created" even though both set created_by the same way.
  external_contact_id?: string | null;
  preferred_curriculum?: string | null;
  withdrawn_at?: string | null;
  withdrawal_type?: WithdrawalType | null;
  withdrawal_reason?: string | null;
  students: { full_name: string; curriculum?: string | null } | null;
  parents: { full_name: string } | null;
  payments?: { amount: number; status: string }[] | null;
}

export type CooBucket =
  | "enquiries"
  | "claimed"
  | "waitingAssessment"
  | "assessmentCompleted"
  | "waitingPayment"
  | "admissionCompleted"
  | "addedToCourse";

export interface CooCreatorStats {
  stats: CooFunnelStats;
  rows: Record<CooBucket, CooStatsRow[]>;
}

function emptyBucketRows(): Record<CooBucket, CooStatsRow[]> {
  return {
    enquiries: [],
    claimed: [],
    waitingAssessment: [],
    assessmentCompleted: [],
    waitingPayment: [],
    admissionCompleted: [],
    addedToCourse: [],
  };
}

// Mirrors computeMarketingStatsByCreator's shape, but also retains the
// matched rows per bucket so the dashboard can drive its drill-down view
// without a second round-trip query.
export function computeCooStatsByCreator(rows: CooStatsRow[]): Map<string, CooCreatorStats> {
  const byCreator = new Map<string, CooCreatorStats>();
  const entryFor = (id: string) => {
    let e = byCreator.get(id);
    if (!e) {
      e = { stats: { ...EMPTY_COO_STATS }, rows: emptyBucketRows() };
      byCreator.set(id, e);
    }
    return e;
  };

  for (const row of rows) {
    const e = entryFor(row.created_by);
    const needsExam = needsAssessment(row.grade_applying ?? "");

    e.stats.enquiries += 1;
    e.rows.enquiries.push(row);
    if (row.external_contact_id) {
      e.stats.claimed += 1;
      e.rows.claimed.push(row);
    }

    if (needsExam && WAITING_ASSESSMENT.has(row.status)) {
      e.stats.waitingAssessment += 1;
      e.rows.waitingAssessment.push(row);
    }
    if (needsExam && REACHED_ASSESSMENT_COMPLETE.has(row.status)) {
      e.stats.assessmentCompleted += 1;
      e.rows.assessmentCompleted.push(row);
    }
    if (WAITING_PAYMENT.has(row.status)) {
      e.stats.waitingPayment += 1;
      e.rows.waitingPayment.push(row);
    }
    if (REACHED_PAYMENT.has(row.status)) {
      e.stats.admissionCompleted += 1;
      e.rows.admissionCompleted.push(row);
    }
    if (row.erp_status === "synced") {
      e.stats.addedToCourse += 1;
      e.rows.addedToCourse.push(row);
    }
    for (const p of row.payments ?? []) {
      if (p.status === "completed") e.stats.revenuePaise += p.amount;
    }
  }

  return byCreator;
}

// Which lead source is actually producing enquiries — shared by the
// team-wide breakdown and a single person's own breakdown on their detail
// page, so both use the exact same grouping/sort logic. Grouped by the raw
// source value only (never the free-text "other" detail some rows carry) —
// this is an aggregate count per source, not a per-lead display, so every
// "other" lead is one "Other" bucket regardless of what each one typed.
export function computeSourceBreakdown(
  rows: { lead_source: string | null }[],
): { source: string; label: string; count: number }[] {
  // Seed every known source at 0 first so a channel with no leads yet still
  // shows up (e.g. "we're not getting anything from Google") instead of
  // silently disappearing from the list.
  const counts = new Map<string, number>(LEAD_SOURCES.map((s) => [s, 0]));
  for (const row of rows) {
    const key = row.lead_source ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({
      source,
      label: (LEAD_SOURCE_LABEL as Record<string, string>)[source] ?? "Unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

// Curriculum split of actually-enrolled students (erp_status "synced" — the
// same milestone as the "Added to course" stat), not every enquiry's stated
// preference — someone can prefer Cambridge at enquiry time and still not
// enroll. Falls back to the application's preferred_curriculum only if the
// student record itself has no curriculum set yet.
export function computeCurriculumBreakdown(
  rows: Pick<CooStatsRow, "erp_status" | "students" | "preferred_curriculum">[],
): { curriculum: string; count: number }[] {
  const counts = new Map<string, number>(CURRICULUM_OPTIONS.map((c) => [c, 0]));
  let other = 0;
  for (const row of rows) {
    if (row.erp_status !== "synced") continue;
    const value = row.students?.curriculum ?? row.preferred_curriculum ?? null;
    if (value && counts.has(value)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    } else {
      other += 1;
    }
  }
  const result = [...counts.entries()].map(([curriculum, count]) => ({ curriculum, count }));
  if (other > 0) result.push({ curriculum: "Other", count: other });
  return result;
}

export interface WithdrawalStats {
  preAdmission: number;
  postAdmission: number;
}
export const EMPTY_WITHDRAWAL_STATS: WithdrawalStats = { preAdmission: 0, postAdmission: 0 };

// Counts withdrawals among whatever rows are passed in — team-wide totals if
// given every row, or one person's own count if the rows are already scoped
// to them.
export function computeWithdrawalStats(rows: Pick<CooStatsRow, "withdrawal_type">[]): WithdrawalStats {
  const stats: WithdrawalStats = { ...EMPTY_WITHDRAWAL_STATS };
  for (const row of rows) {
    if (row.withdrawal_type === "pre_admission") stats.preAdmission += 1;
    else if (row.withdrawal_type === "post_admission") stats.postAdmission += 1;
  }
  return stats;
}

export function cooConversionLabel(stats: CooFunnelStats): string {
  return stats.enquiries > 0 ? `${((stats.admissionCompleted / stats.enquiries) * 100).toFixed(1)}%` : "—";
}
export function cooConversionValue(stats: CooFunnelStats): number {
  return stats.enquiries > 0 ? (stats.admissionCompleted / stats.enquiries) * 100 : -1;
}
