"use client";

import type { FormEvent } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatMonthLabel, WEEKDAYS_MON_FIRST } from "@/lib/slot-calculator";
import { useCreateSlots } from "@/components/admin/create-slots-context";

// Mirrors createAssessmentSlot's own "max 200 at once" check (actions.ts), so
// the admin sees it before posting instead of after a round-trip.
const MAX_SLOTS_PER_POST = 200;

export function CreateSlotsForm({
  teachers,
  schoolLabel,
  action,
}: {
  teachers: { id: string; label: string }[];
  schoolLabel: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const { values, plan, setValue, clearPlan, weeksLeftNow, refreshPlan } = useCreateSlots();
  const dayName = WEEKDAYS_MON_FIRST.find((d) => String(d.value) === values.weekday)?.long ?? "day";
  const total = Number(values.quantity) * Number(values.weeks);
  const noDatesLeft = plan !== null && plan.weeksLeft === 0;
  const overLimit = Number.isFinite(total) && total > MAX_SLOTS_PER_POST;
  const offWorkingDays = plan !== null && !plan.workingWeekdays.includes(Number(values.weekday));

  // Re-count the weeks at the moment of posting: if the chosen time today
  // has passed since the form was filled, the server would start a week
  // later and spill the last posting into next month. Cancelling in
  // onSubmit stops React from running the action at all, so the form isn't
  // reset and the refreshed "No …s left" message explains why.
  function guardSubmit(e: FormEvent<HTMLFormElement>) {
    if (weeksLeftNow() === 0) {
      e.preventDefault();
      refreshPlan();
    }
  }

  function submit(formData: FormData) {
    const weeksLeft = weeksLeftNow();
    if (weeksLeft !== null && weeksLeft > 0) formData.set("weeks", String(weeksLeft));
    return action(formData);
  }

  return (
    <form action={submit} onSubmit={guardSubmit} className="space-y-1.5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="weekday">Day</Label>
          <Select
            id="weekday"
            name="weekday"
            value={values.weekday}
            onChange={(e) => setValue("weekday", e.target.value)}
            className="w-36"
          >
            {WEEKDAYS_MON_FIRST.map((d) => (
              <option key={d.value} value={d.value}>
                {d.long}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="time">Time ({schoolLabel})</Label>
          <Input
            id="time"
            name="time"
            type="time"
            required
            value={values.time}
            onChange={(e) => setValue("time", e.target.value)}
            className="w-32"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="duration">Duration (min)</Label>
          <Input
            id="duration"
            name="duration"
            type="number"
            min={10}
            max={240}
            value={values.duration}
            onChange={(e) => setValue("duration", e.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quantity">Slots per week</Label>
          <Input
            id="quantity"
            name="quantity"
            type="number"
            min={1}
            max={50}
            value={values.quantity}
            onChange={(e) => setValue("quantity", e.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="weeks">Repeat for (weeks)</Label>
          <Input
            id="weeks"
            name="weeks"
            type="number"
            min={1}
            max={26}
            value={values.weeks}
            onChange={(e) => setValue("weeks", e.target.value)}
            className="w-28"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="teacher_id">Assign teacher</Label>
          <Select
            id="teacher_id"
            name="teacher_id"
            value={values.teacherId}
            onChange={(e) => setValue("teacherId", e.target.value)}
            className="min-w-56"
          >
            <option value="">Open — any teacher can claim it</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingText="Creating…" disabled={noDatesLeft || overLimit}>
          Create slot(s)
        </SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Assign teacher only works when slots per week and repeat weeks are both 1. Otherwise leave as
        &quot;Open&quot;.
      </p>
      {overLimit && (
        <p className="text-xs text-warning">
          That&apos;s {total} slots in one post ({values.quantity} × {values.weeks} weeks) — Create slots allows
          at most {MAX_SLOTS_PER_POST}. Lower the weeks and post the rest separately.
        </p>
      )}
      {plan && (
        <p className="text-xs">
          {noDatesLeft ? (
            <span className="text-warning">
              No {dayName}s left in {formatMonthLabel(plan.month)} — pick another day.{" "}
            </span>
          ) : (
            <span className="text-muted-foreground">
              From the calculator: {values.quantity} slots per time (one per teacher), repeated for the{" "}
              {plan.weeksLeft} {dayName}
              {plan.weeksLeft === 1 ? "" : "s"} left in {formatMonthLabel(plan.month)}. Post again for each
              time and working day — these numbers stay filled in.{" "}
            </span>
          )}
          {offWorkingDays && (
            <span className="text-warning">{dayName} isn&apos;t one of the calculator&apos;s working days. </span>
          )}
          <button type="button" onClick={clearPlan} className="font-medium text-primary hover:underline">
            Stop following
          </button>
        </p>
      )}
    </form>
  );
}
