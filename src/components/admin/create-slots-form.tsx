"use client";

import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatMonthLabel, WEEKDAYS_MON_FIRST } from "@/lib/slot-calculator";
import { useCreateSlots } from "@/components/admin/create-slots-context";

export function CreateSlotsForm({
  teachers,
  schoolLabel,
  action,
}: {
  teachers: { id: string; label: string }[];
  schoolLabel: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const { values, plan, setValue, clearPlan } = useCreateSlots();
  const dayName = WEEKDAYS_MON_FIRST.find((d) => String(d.value) === values.weekday)?.long ?? "day";

  return (
    <form action={action} className="space-y-1.5">
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
        <SubmitButton pendingText="Creating…">Create slot(s)</SubmitButton>
      </div>
      <p className="text-xs text-muted-foreground">
        Assign teacher only works when slots per week and repeat weeks are both 1. Otherwise leave as
        &quot;Open&quot;.
      </p>
      {plan && (
        <p className="text-xs">
          {plan.weeksLeft > 0 ? (
            <span className="text-muted-foreground">
              From the calculator: {values.quantity} slots per time (one per teacher), repeated for the{" "}
              {plan.weeksLeft} {dayName}
              {plan.weeksLeft === 1 ? "" : "s"} left in {formatMonthLabel(plan.month)}. Repeat for each
              time and working day.{" "}
            </span>
          ) : (
            <span className="text-warning">
              No {dayName}s left in {formatMonthLabel(plan.month)} — pick another day.{" "}
            </span>
          )}
          <button type="button" onClick={clearPlan} className="font-medium text-primary hover:underline">
            Stop following
          </button>
        </p>
      )}
    </form>
  );
}
