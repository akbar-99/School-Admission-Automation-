"use client";

import { useState, type ReactNode } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { buildBroadwayClassName, isAutomaticBroadwayName, isKgGrade } from "@/lib/section-names";

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
      <Select
        id={id}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className={`${heightClass}w-full min-w-56 text-sm`}
      >
        <option value="">No timing set</option>
        {TIMING_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>+ Add a time…</option>
      </Select>
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

export function SectionBroadwayFields({
  idPrefix,
  initialGrade = "",
  initialName = "",
  initialBatch = "",
  initialBroadwayInputName = "",
  initialClassTiming = "",
  initialCurriculum = "",
  variant = "create",
  between,
}: {
  idPrefix?: string;
  initialGrade?: string;
  initialName?: string;
  initialBatch?: string;
  initialBroadwayInputName?: string;
  initialClassTiming?: string;
  initialCurriculum?: string;
  variant?: "create" | "edit";
  // Rendered between Batch and the Broadway class name, so callers can keep
  // the Capacity field in its original on-screen position.
  between?: ReactNode;
}) {
  const id = (base: string) => (idPrefix ? `${base}-${idPrefix}` : base);
  const isEdit = variant === "edit";
  const labelClass = isEdit ? "text-xs" : undefined;
  const heightClass = isEdit ? "h-9 " : "";

  const [grade, setGrade] = useState(initialGrade);
  const [name, setName] = useState(initialName);
  const [batch, setBatch] = useState(initialBatch);
  const [kgCurriculum, setKgCurriculum] = useState(initialCurriculum);
  // The Broadway class name follows Grade/Section/Batch/Curriculum unless the
  // admin chooses to type their own (the pencil). A saved name in the
  // automatic shape — even one built from an older batch — keeps following,
  // so renaming the batch renames it too; only a genuinely hand-typed name
  // is kept as an override when the form reopens.
  const [broadwayTouched, setBroadwayTouched] = useState(
    Boolean(initialBroadwayInputName) &&
      !isAutomaticBroadwayName(initialBroadwayInputName, initialGrade, initialName),
  );
  const [broadwayValue, setBroadwayValue] = useState(initialBroadwayInputName);

  const kg = isKgGrade(grade);
  const autoValue = buildBroadwayClassName(grade, name, batch, kgCurriculum);
  const displayValue = broadwayTouched ? broadwayValue : autoValue;

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
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
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
          value={name}
          onChange={(e) => setName(e.target.value)}
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
          value={batch}
          onChange={(e) => setBatch(e.target.value)}
        />
      </div>
      {between}
      {kg && (
        <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
          <Label htmlFor={id("kg_curriculum")} className={labelClass}>Curriculum</Label>
          <Select
            id={id("kg_curriculum")}
            name="curriculum"
            required
            value={kgCurriculum}
            onChange={(e) => setKgCurriculum(e.target.value)}
            className={`${heightClass}w-32 text-sm`}
          >
            <option value="">— pick —</option>
            <option value="CBSE">CBSE</option>
            <option value="Cambridge">Cambridge</option>
          </Select>
        </div>
      )}
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("broadway_input_name")} className={labelClass}>Broadway class name</Label>
        <div className="flex items-center gap-1">
          <Input
            id={id("broadway_input_name")}
            name="broadway_input_name"
            placeholder="CBSE KG 1-A - ORCHID"
            className={cn(
              heightClass,
              isEdit ? "w-44" : "w-56",
              !broadwayTouched && "bg-muted/50 text-muted-foreground",
            )}
            value={displayValue}
            readOnly={!broadwayTouched}
            title={broadwayTouched ? undefined : "Follows Grade, Section and Batch automatically"}
            onChange={(e) => setBroadwayValue(e.target.value)}
          />
          {broadwayTouched ? (
            <button
              type="button"
              onClick={() => setBroadwayTouched(false)}
              title={autoValue ? `Go back to the automatic name (${autoValue})` : "Go back to the automatic name"}
              aria-label="Use the automatic Broadway class name"
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                isEdit ? "size-9" : "size-11",
              )}
            >
              <RotateCcw className="size-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setBroadwayValue(autoValue);
                setBroadwayTouched(true);
              }}
              title="Type your own Broadway class name instead"
              aria-label="Edit the Broadway class name"
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                isEdit ? "size-9" : "size-11",
              )}
            >
              <Pencil className="size-4" />
            </button>
          )}
        </div>
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
