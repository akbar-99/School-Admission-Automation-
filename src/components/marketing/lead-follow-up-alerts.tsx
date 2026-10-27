"use client";

import { LiveAlerts, type InitialAlert } from "@/components/live-alerts";

// A due/overdue follow-up isn't a live event (no single DB write represents
// "today arrived") — this only needs LiveAlerts' server-computed "catch up"
// pass on mount, no Realtime subscription. storageKey is per-staff, not a
// fixed string, so one counselor dismissing their own alerts never
// suppresses anyone else's.
export function LeadFollowUpAlerts({
  staffId,
  initialAlerts = [],
}: {
  staffId: string;
  initialAlerts?: InitialAlert[];
}) {
  return <LiveAlerts storageKey={`follow-up-${staffId}`} initialAlerts={initialAlerts} />;
}
