"use client";

import { LiveAlerts, type InitialAlert } from "@/components/live-alerts";

interface SlotChangeRow {
  id: string;
  unavailable_reported: boolean;
}

// Popup + sound the instant a teacher reports they can't attend a booked
// assessment — admin-wide (not scoped to one teacher).
export function AdminUnavailableAlerts({ initialAlerts = [] }: { initialAlerts?: InitialAlert[] }) {
  return (
    <LiveAlerts
      storageKey="admin-unavailable"
      initialAlerts={initialAlerts}
      subscribe={(supabase, push) =>
        supabase
          .channel("admin-unavailable-slots")
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "assessment_slots",
              // Only delivers events where the resulting row has this true —
              // i.e. exactly when a teacher just flagged it (reassigning
              // clears the flag back to false, so that update isn't matched).
              filter: "unavailable_reported=eq.true",
            },
            (payload) => {
              const after = payload.new as SlotChangeRow;
              push("A teacher reported they can't attend a booked assessment.", after.id);
            },
          )
          .subscribe()
      }
    />
  );
}
