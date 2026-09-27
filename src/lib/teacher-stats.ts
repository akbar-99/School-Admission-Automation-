import "server-only";

// Assessment-teacher performance for the Team dashboard's "Assessment
// teachers" tab — mirrors marketing-stats.ts's shape, kept in its own file
// since this is a genuinely different domain (slots/results, not
// applications).

export interface TeacherSlotRow {
  id: string;
  teacher_id: string | null;
  starts_at: string;
  application_id: string | null;
  claimed_by_teacher: boolean;
  unavailable_reported: boolean;
  applications: { lead_student_name: string | null; students: { full_name: string } | null } | null;
}

export interface TeacherResultRow {
  application_id: string;
  teacher_id: string | null;
  outcome: "PASS" | "FAIL";
}

export interface TeacherFunnelStats {
  totalSlots: number;
  claimed: number;
  assignedByAdmin: number;
  booked: number;
  completed: number;
  eligible: number;
  notEligible: number;
  unavailableReported: number;
}

export const EMPTY_TEACHER_STATS: TeacherFunnelStats = {
  totalSlots: 0,
  claimed: 0,
  assignedByAdmin: 0,
  booked: 0,
  completed: 0,
  eligible: 0,
  notEligible: 0,
  unavailableReported: 0,
};

export type TeacherBucket =
  | "totalSlots"
  | "claimed"
  | "assignedByAdmin"
  | "booked"
  | "completed"
  | "eligible"
  | "notEligible"
  | "unavailableReported";

export interface TeacherCreatorStats {
  stats: TeacherFunnelStats;
  slots: Record<TeacherBucket, TeacherSlotRow[]>;
}

function emptyBucketSlots(): Record<TeacherBucket, TeacherSlotRow[]> {
  return {
    totalSlots: [],
    claimed: [],
    assignedByAdmin: [],
    booked: [],
    completed: [],
    eligible: [],
    notEligible: [],
    unavailableReported: [],
  };
}

// Buckets each slot by teacher_id (an unclaimed open-pool slot has none yet
// and is skipped entirely — it isn't anyone's performance yet), then folds
// in results matched by their own teacher_id (recorded at submission time
// in submitResult, src/app/teacher/actions.ts) onto the same entry.
export function computeTeacherStatsByTeacher(
  slots: TeacherSlotRow[],
  results: TeacherResultRow[],
): Map<string, TeacherCreatorStats> {
  const byTeacher = new Map<string, TeacherCreatorStats>();
  const entryFor = (id: string) => {
    let e = byTeacher.get(id);
    if (!e) {
      e = { stats: { ...EMPTY_TEACHER_STATS }, slots: emptyBucketSlots() };
      byTeacher.set(id, e);
    }
    return e;
  };

  for (const slot of slots) {
    if (!slot.teacher_id) continue;
    const e = entryFor(slot.teacher_id);

    e.stats.totalSlots += 1;
    e.slots.totalSlots.push(slot);

    if (slot.claimed_by_teacher) {
      e.stats.claimed += 1;
      e.slots.claimed.push(slot);
    } else {
      e.stats.assignedByAdmin += 1;
      e.slots.assignedByAdmin.push(slot);
    }
    if (slot.application_id) {
      e.stats.booked += 1;
      e.slots.booked.push(slot);
    }
    if (slot.unavailable_reported) {
      e.stats.unavailableReported += 1;
      e.slots.unavailableReported.push(slot);
    }
  }

  const slotsByApplication = new Map<string, TeacherSlotRow>();
  for (const slot of slots) {
    if (slot.application_id) slotsByApplication.set(slot.application_id, slot);
  }

  for (const result of results) {
    if (!result.teacher_id) continue;
    const e = entryFor(result.teacher_id);
    const slot = slotsByApplication.get(result.application_id);

    e.stats.completed += 1;
    if (slot) e.slots.completed.push(slot);
    if (result.outcome === "PASS") {
      e.stats.eligible += 1;
      if (slot) e.slots.eligible.push(slot);
    } else {
      e.stats.notEligible += 1;
      if (slot) e.slots.notEligible.push(slot);
    }
  }

  return byTeacher;
}

export function teacherCompletionLabel(stats: TeacherFunnelStats): string {
  return stats.booked > 0 ? `${((stats.completed / stats.booked) * 100).toFixed(1)}%` : "—";
}
export function teacherCompletionValue(stats: TeacherFunnelStats): number {
  return stats.booked > 0 ? (stats.completed / stats.booked) * 100 : -1;
}
