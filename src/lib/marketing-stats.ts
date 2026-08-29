import "server-only";
import type { AppStatus } from "@/lib/types";

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
