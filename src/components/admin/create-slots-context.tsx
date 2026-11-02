"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toZonedInputValue, zonedWeekday } from "@/lib/utils";
import { countWeekdayFrom, firstPostableDate } from "@/lib/slot-calculator";

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
  weeksLeft: number;
}

interface CreateSlotsContextValue {
  values: CreateSlotsValues;
  plan: FollowedPlan | null;
  setValue: (field: keyof CreateSlotsValues, value: string) => void;
  applyPlan: (input: { quantity: number; month: string }) => void;
  clearPlan: () => void;
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

export function CreateSlotsProvider({ schoolTz, children }: { schoolTz: string; children: ReactNode }) {
  const [values, setValues] = useState<CreateSlotsValues>(INITIAL_VALUES);
  const [plan, setPlan] = useState<FollowedPlan | null>(null);

  // Only ever called from event handlers, so reading "now" here never
  // affects what's rendered on the server vs the client.
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

  const setValue = useCallback(
    (field: keyof CreateSlotsValues, value: string) => {
      const next = { ...values, [field]: value };
      if (field === "weeks") {
        setPlan(null); // a manual edit stops following the calculator
      } else if (plan && (field === "weekday" || field === "time")) {
        const weeksLeft = weeksLeftFor(plan.month, next.weekday, next.time);
        setPlan({ month: plan.month, weeksLeft });
        if (weeksLeft > 0) next.weeks = String(weeksLeft);
      }
      setValues(next);
    },
    [values, plan, weeksLeftFor],
  );

  const applyPlan = useCallback(
    ({ quantity, month }: { quantity: number; month: string }) => {
      const weeksLeft = weeksLeftFor(month, values.weekday, values.time);
      setPlan({ month, weeksLeft });
      setValues({
        ...values,
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

  const value = useMemo(
    () => ({ values, plan, setValue, applyPlan, clearPlan }),
    [values, plan, setValue, applyPlan, clearPlan],
  );
  return <CreateSlotsContext.Provider value={value}>{children}</CreateSlotsContext.Provider>;
}

export function useCreateSlots(): CreateSlotsContextValue {
  const ctx = useContext(CreateSlotsContext);
  if (!ctx) throw new Error("useCreateSlots must be used inside <CreateSlotsProvider>");
  return ctx;
}
