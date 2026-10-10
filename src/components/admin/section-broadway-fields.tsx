"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Grouped by grade band so the dropdown shows a heading over each school's
// set of timings, rather than one flat list mixing all of them together.
const TIMING_GROUPS: { label: string; options: string[] }[] = [
  {
    label: "Grade 1 - 3",
    options: [
      "Monday - Friday, 9:30 AM - 12:55 PM IST",
      "Sunday - Thursday, 11:20 AM - 2:45 PM IST",
    ],
  },
  {
    label: "Grade 4 - 8",
    options: [
      "Monday - Friday, 9:30 AM - 1:55 PM IST",
      "Sunday - Thursday, 9:30 AM - 1:55 PM IST",
    ],
  },
  {
    label: "KG",
    options: ["Monday to Friday", "Sunday to Thursday"],
  },
];
const ALL_TIMING_PRESETS = TIMING_GROUPS.flatMap((g) => g.options);

const CUSTOM = "__custom__";

// A <select> of preset timings, grouped by grade band, plus an "Add a time"
// option that reveals a free-text input — covers the fixed school schedules
// without locking the admin out of a one-off value.
function ClassTimingPicker({
  id,
  initialValue,
  labelClass,
  heightClass,
}: {
  id: string;
  initialValue: string;
  labelClass?: string;
  heightClass: string;
}) {
  const matchesPreset = ALL_TIMING_PRESETS.includes(initialValue);
  const [selected, setSelected] = useState(matchesPreset ? initialValue : initialValue ? CUSTOM : "");
  const [customValue, setCustomValue] = useState(matchesPreset ? "" : initialValue);
  const value = selected === CUSTOM ? customValue : selected;

  return (
    <div className={heightClass ? "space-y-1" : "space-y-1.5"}>
      <Label htmlFor={id} className={labelClass}>
        Class timing
      </Label>
      <input type="hidden" name="class_timing" value={value} />
      <select
        id={id}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className={`${heightClass}w-full min-w-56 rounded-md border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <option value="">No timing set</option>
        {TIMING_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label} className="timing-optgroup">
            {group.options.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>+ Add a time…</option>
      </select>
      {selected === CUSTOM && (
        <Input
          value={customValue}
          onChange={(e) => setCustomValue(e.target.value)}
          placeholder="Type a custom timing"
          className={heightClass + "w-full min-w-56"}
        />
      )}
    </div>
  );
}

export interface BroadwayClassOption {
  id: string;
  name: string;
  curriculum: string;
  gradeLabel: string;
  thisYearSeatsLeft: number | null;
  nextYearSeatsLeft: number | null;
}

function classOptionLabel(c: BroadwayClassOption): string {
  const thisYr = c.thisYearSeatsLeft === null ? "∞" : c.thisYearSeatsLeft;
  const nextYr = c.nextYearSeatsLeft === null ? "∞" : c.nextYearSeatsLeft;
  return `${c.name} — ${c.curriculum} ${c.gradeLabel} (${thisYr} left this yr, ${nextYr} next yr)`;
}

export function SectionBroadwayFields({
  idPrefix,
  initialGrade = "",
  initialName = "",
  initialBatch = "",
  initialBroadwayClassId = "",
  initialClassTiming = "",
  variant = "create",
  broadwayClasses,
  between,
}: {
  idPrefix?: string;
  initialGrade?: string;
  initialName?: string;
  initialBatch?: string;
  initialBroadwayClassId?: string;
  initialClassTiming?: string;
  variant?: "create" | "edit";
  broadwayClasses: BroadwayClassOption[];
  // Rendered between Batch and the Broadway class picker, so callers can
  // keep the Capacity field in its original on-screen position.
  between?: ReactNode;
}) {
  const id = (base: string) => (idPrefix ? `${base}-${idPrefix}` : base);
  const isEdit = variant === "edit";
  const labelClass = isEdit ? "text-xs" : undefined;
  const heightClass = isEdit ? "h-9 " : "";

  // The currently-linked class might no longer be in the cached list (e.g.
  // renamed/removed in Broadway since this section was linked, or the cache
  // just hasn't synced yet) — still offer it as a selectable option so
  // saving the form again without changing this field doesn't silently
  // unlink it.
  const options =
    initialBroadwayClassId && !broadwayClasses.some((c) => c.id === initialBroadwayClassId)
      ? [
          { id: initialBroadwayClassId, name: `${initialBroadwayClassId} (not in cache)`, curriculum: "", gradeLabel: "", thisYearSeatsLeft: null, nextYearSeatsLeft: null },
          ...broadwayClasses,
        ]
      : broadwayClasses;

  return (
    <>
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("grade")} className={labelClass}>Grade</Label>
        <Input
          id={id("grade")}
          name="grade"
          placeholder="KG 1 / G1"
          className={heightClass + (isEdit ? "w-44" : "w-28")}
          required
          defaultValue={initialGrade}
        />
      </div>
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("name")} className={labelClass}>Section</Label>
        <Input
          id={id("name")}
          name="name"
          placeholder="C"
          className={heightClass + (isEdit ? "w-16" : "w-24")}
          required
          defaultValue={initialName}
        />
      </div>
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("batch")} className={labelClass}>
          {isEdit ? "Batch" : "Batch (KG only)"}
        </Label>
        <Input
          id={id("batch")}
          name="batch"
          placeholder="DAHLIA"
          className={heightClass + (isEdit ? "w-28" : "w-32")}
          defaultValue={initialBatch}
        />
      </div>
      {between}
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("broadway_class_id")} className={labelClass}>Broadway class</Label>
        <select
          id={id("broadway_class_id")}
          name="broadway_class_id"
          defaultValue={initialBroadwayClassId}
          className={`${heightClass}w-full min-w-56 rounded-md border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        >
          <option value="">Not linked</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {classOptionLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <ClassTimingPicker
        id={id("class_timing")}
        initialValue={initialClassTiming}
        labelClass={labelClass}
        heightClass={heightClass}
      />
    </>
  );
}
