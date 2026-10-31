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

// Same "KG" test as lib/classes.ts's isKgClass — duplicated rather than
// imported since that file is server-only and this component runs client-side.
function isKgGrade(grade: string): boolean {
  return /kg/i.test(grade);
}

// Mirrors the exact format enroll_application builds for the admission
// app's own "Grade-Section - Batch" label (supabase/migrations/0063, the
// `v_grade || '-' || v_section_nm || coalesce(' - ' || v_section_batch, '')`
// line) — the Broadway class name is meant to be the same string, just with
// a curriculum prefix for KG (whose grade alone doesn't encode CBSE vs
// Cambridge the way "STD …"/"STAGE …" already do for every other grade).
function buildBroadwayClassName(grade: string, name: string, batch: string, kgCurriculum: string): string {
  const g = grade.trim();
  const n = name.trim();
  const b = batch.trim();
  if (!g || !n) return "";
  const base = `${g}-${n}${b ? ` - ${b}` : ""}`;
  if (isKgGrade(g)) return kgCurriculum ? `${kgCurriculum} ${base}` : "";
  return base;
}

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
          <optgroup key={group.label} label={group.label}>
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
  // Once the admin edits the Broadway class name directly, stop overwriting
  // it as Grade/Section/Batch change — it's a live-computed default, not a
  // locked-in value. A saved value already on the row (editing an existing
  // section) counts as a manual override from the start, so reopening the
  // form never silently replaces an admin's existing entry.
  const [broadwayTouched, setBroadwayTouched] = useState(Boolean(initialBroadwayInputName));
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
          <select
            id={id("kg_curriculum")}
            name="curriculum"
            required
            value={kgCurriculum}
            onChange={(e) => setKgCurriculum(e.target.value)}
            className={`${heightClass}w-28 rounded-md border border-input bg-card px-3 text-sm shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            <option value="">— pick —</option>
            <option value="CBSE">CBSE</option>
            <option value="Cambridge">Cambridge</option>
          </select>
        </div>
      )}
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("broadway_input_name")} className={labelClass}>Broadway class name</Label>
        <Input
          id={id("broadway_input_name")}
          name="broadway_input_name"
          placeholder="CBSE KG 1-A - ORCHID"
          className={heightClass + (isEdit ? "w-44" : "w-56")}
          value={displayValue}
          onChange={(e) => {
            setBroadwayTouched(true);
            setBroadwayValue(e.target.value);
          }}
        />
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
