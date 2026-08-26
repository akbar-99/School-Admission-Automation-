"use client";

import { LiveAlerts, type InitialAlert } from "@/components/live-alerts";

interface SlotChangeRow {
  id: string;
  application_id: string | null;
  teacher_id: string | null;
  claimed_by_teacher: boolean;
}

// Popup + sound whenever something changes on this teacher's slots — a
// parent books one, or an admin (re)assigns one to them.
export function TeacherLiveAlerts({
  teacherId,
  initialAlerts = [],
}: {
  teacherId: string;
  initialAlerts?: InitialAlert[];
}) {
  return (
    <LiveAlerts
      storageKey={`teacher-${teacherId}`}
      initialAlerts={initialAlerts}
      subscribe={(supabase, push) =>
        supabase
          .channel(`teacher-slots-${teacherId}`)
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "assessment_slots",
              filter: `teacher_id=eq.${teacherId}`,
            },
            (payload) => {
              const before = payload.old as Partial<SlotChangeRow>;
              const after = payload.new as SlotChangeRow;
              if (!before.application_id && after.application_id) {
                push("A parent just booked one of your assessment slots.", after.id);
              } else if (
                before.teacher_id !== teacherId &&
                after.teacher_id === teacherId &&
                !after.claimed_by_teacher
              ) {
                // teacher_id newly == me, but not via my own claim action.
                push("An admin assigned a slot to you.");
              }
            },
          )
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "assessment_slots",
              filter: `teacher_id=eq.${teacherId}`,
            },
            () => {
              push("A new assessment slot has been assigned to you.");
            },
          )
          .subscribe()
      }
    />
  );
}
