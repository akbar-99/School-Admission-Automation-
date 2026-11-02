"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toZonedInputValue, zonedWeekday } from "@/lib/utils";
import { WEEKDAYS_MON_FIRST, countWeekdayFrom, firstPostableDate } from "@/lib/slot-calculator";

export interface CreateSlotsValues {
  weekday: string;
  time: string;
  duration: string;
  quantity: string;
  weeks: string;
  teacherId: string;
}

// Set by the calculator's "Use these numbers": while active, "Repeat for
// (weeks)" keeps following however many of the chosen weekday are left in
// that month, recalculated whenever Day or Time changes.
export interface FollowedPlan {
  month: string;
  workingWeekdays: number[];
  weeksLeft: number;
}

interface CreateSlotsContextValue {
  values: CreateSlotsValues;
  plan: FollowedPlan | null;
  schoolTz: string;
  setValue: (field: keyof CreateSlotsValues, value: string) => void;
  applyPlan: (input: { quantity: number; month: string; workingWeekdays: number[] }) => void;
  clearPlan: () => void;
  // Fresh weeks-left for the current Day/Time at this exact moment, or null
  // when no plan is being followed. Used right before submitting.
  weeksLeftNow: () => number | null;
  // Re-count weeks left for the current Day/Time and update the form — so a
  // count that went stale while the page sat open is shown, not just used.
  refreshPlan: () => void;
}

const CreateSlotsContext = createContext<CreateSlotsContextValue | null>(null);

const INITIAL_VALUES: CreateSlotsValues = {
  weekday: "1",
  time: "",
  duration: "30",
  quantity: "1",
  weeks: "1",
  teacherId: "",
};

// Every Create slots post ends in a server redirect, which remounts this
// whole page (see server-action-reducer in next/dist), so a followed plan
// would otherwise be lost after the first of several postings. Kept per
// browser tab only; Time is deliberately not kept, so a second click can't
// silently re-post the same batch.
const STORAGE_KEY = "admin.createSlots.plan.v1";

interface StoredPlan {
  plan: { month: string; workingWeekdays: number[] };
  values: Pick<CreateSlotsValues, "weekday" | "duration" | "quantity" | "teacherId">;
  // Live active-teacher count when this was saved: if staff changed since,
  // "one slot per teacher" no longer holds, so the plan is dropped.
  activeTeachers: number;
}

function readStoredPlan(): StoredPlan | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlan;
    const { plan, values } = parsed ?? {};
    if (
      typeof parsed?.activeTeachers !== "number" ||
      typeof plan?.month !== "string" ||
      !Array.isArray(plan.workingWeekdays) ||
      !plan.workingWeekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ||
      ![values?.weekday, values?.duration, values?.quantity, values?.teacherId].every((v) => typeof v === "string")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function CreateSlotsProvider({
  schoolTz,
  activeTeachers,
  children,
}: {
  schoolTz: string;
  activeTeachers: number;
  children: ReactNode;
}) {
  const [values, setValues] = useState<CreateSlotsValues>(INITIAL_VALUES);
  const [plan, setPlan] = useState<FollowedPlan | null>(null);
  const [restored, setRestored] = useState(false);

  // Only ever called from event handlers and effects, so reading "now" here
  // never affects what's rendered on the server vs the client.
  const weeksLeftFor = useCallback(
    (month: string, weekday: string, time: string) => {
      const now = new Date();
      const local = toZonedInputValue(now, schoolTz);
      const from = firstPostableDate({
        todayYmd: local.slice(0, 10),
        todayWeekday: zonedWeekday(now, schoolTz),
        nowHHMM: local.slice(11),
        weekday: Number(weekday),
        time,
      });
      return countWeekdayFrom(month, Number(weekday), from);
    },
    [schoolTz],
  );

  // Browser storage is only readable after hydration, so the first render
  // always matches the server's default form; a kept plan appears right after.
  useEffect(() => {
    const saved = readStoredPlan();
    const currentMonth = toZonedInputValue(new Date(), schoolTz).slice(0, 7);
    if (saved && saved.plan.month >= currentMonth && saved.activeTeachers === activeTeachers) {
      const next = { ...INITIAL_VALUES, ...saved.values, time: "" };
      const weeksLeft = weeksLeftFor(saved.plan.month, next.weekday, "");
      if (weeksLeft > 0) next.weeks = String(weeksLeft);
      setValues(next);
      setPlan({ month: saved.plan.month, workingWeekdays: saved.plan.workingWeekdays, weeksLeft });
    }
    setRestored(true);
    // Restore once per mount: activeTeachers is deliberately not a dependency,
    // or a refreshed count mid-session would re-restore over live edits.
  }, [schoolTz, weeksLeftFor]);

  useEffect(() => {
    if (!restored) return; // don't wipe a kept plan before it has been read
    try {
      if (plan) {
        const stored: StoredPlan = {
          plan: { month: plan.month, workingWeekdays: plan.workingWeekdays },
          values: {
            weekday: values.weekday,
            duration: values.duration,
            quantity: values.quantity,
            teacherId: values.teacherId,
          },
          activeTeachers,
        };
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage blocked (private mode, site data disabled) — the plan just
      // won't survive the next post; nothing else depends on it.
    }
  }, [restored, plan, values, activeTeachers]);

  const setValue = useCallback(
    (field: keyof CreateSlotsValues, value: string) => {
      const next = { ...values, [field]: value };
      if (field === "weeks") {
        setPlan(null); // a manual edit stops following the calculator
      } else if (plan && (field === "weekday" || field === "time")) {
        const weeksLeft = weeksLeftFor(plan.month, next.weekday, next.time);
        setPlan({ ...plan, weeksLeft });
        if (weeksLeft > 0) next.weeks = String(weeksLeft);
      }
      setValues(next);
    },
    [values, plan, weeksLeftFor],
  );

  const applyPlan = useCallback(
    ({ quantity, month, workingWeekdays }: { quantity: number; month: string; workingWeekdays: number[] }) => {
      // Keep the form's Day if it's one of the calculator's working days;
      // otherwise move to the first working day that still has dates left.
      let weekday = values.weekday;
      if (!workingWeekdays.includes(Number(weekday))) {
        const working = WEEKDAYS_MON_FIRST.filter((d) => workingWeekdays.includes(d.value));
        const withDatesLeft = working.find((d) => weeksLeftFor(month, String(d.value), values.time) > 0);
        weekday = String((withDatesLeft ?? working[0])?.value ?? weekday);
      }
      const weeksLeft = weeksLeftFor(month, weekday, values.time);
      setPlan({ month, workingWeekdays, weeksLeft });
      setValues({
        ...values,
        weekday,
        quantity: String(quantity),
        teacherId: "", // several slots per time only works as an open pool
        weeks: weeksLeft > 0 ? String(weeksLeft) : values.weeks,
      });
      document.getElementById("create-slots")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("time")?.focus({ preventScroll: true });
    },
    [values, weeksLeftFor],
  );

  const clearPlan = useCallback(() => setPlan(null), []);

  const weeksLeftNow = useCallback(
    () => (plan ? weeksLeftFor(plan.month, values.weekday, values.time) : null),
    [plan, values.weekday, values.time, weeksLeftFor],
  );

  const refreshPlan = useCallback(() => {
    if (!plan) return;
    const weeksLeft = weeksLeftFor(plan.month, values.weekday, values.time);
    setPlan({ ...plan, weeksLeft });
    if (weeksLeft > 0) setValues({ ...values, weeks: String(weeksLeft) });
  }, [plan, values, weeksLeftFor]);

  const value = useMemo(
    () => ({ values, plan, schoolTz, setValue, applyPlan, clearPlan, weeksLeftNow, refreshPlan }),
    [values, plan, schoolTz, setValue, applyPlan, clearPlan, weeksLeftNow, refreshPlan],
  );
  return <CreateSlotsContext.Provider value={value}>{children}</CreateSlotsContext.Provider>;
}

export function useCreateSlots(): CreateSlotsContextValue {
  const ctx = useContext(CreateSlotsContext);
  if (!ctx) throw new Error("useCreateSlots must be used inside <CreateSlotsProvider>");
  return ctx;
}
