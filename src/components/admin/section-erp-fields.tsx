"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Derives the ERP's own class_name pattern (confirmed against the live ERP:
// "KG 1-MA - DAHLIA 30" for grade "KG 1", section "MA", batch "DAHLIA 30") so
// the field can default itself as the admin types instead of requiring them
// to retype what the other three fields already say.
function computeErpClassName(grade: string, name: string, batch: string): string {
  const g = grade.trim().toUpperCase();
  const n = name.trim().toUpperCase();
  const b = batch.trim();
  if (!g || !n) return "";
  return b ? `${g}-${n} - ${b}` : `${g}-${n}`;
}

// KG runs a plain weekday pattern with no fixed hours given; other grades
// have specific hour ranges. Keyed off whether the typed grade contains
// "KG" so switching between "KG 1" and "G1" swaps the preset list live.
const KG_TIMINGS = ["Monday to Friday", "Sunday to Thursday"];
const GRADE_TIMINGS = [
  "Monday - Friday, 9:30 AM - 12:55 PM IST",
  "Sunday - Thursday, 11:20 AM - 2:45 PM IST",
  "Monday - Friday, 9:30 AM - 1:55 PM IST",
  "Sunday - Thursday, 9:30 AM - 1:55 PM IST",
];
function timingPresetsForGrade(grade: string): string[] {
  return grade.trim().toUpperCase().includes("KG") ? KG_TIMINGS : GRADE_TIMINGS;
}

const CUSTOM = "__custom__";

// A <select> of preset timings plus an "Add a time" option that reveals a
// free-text input — covers the fixed school schedules without locking the
// admin out of a one-off value. `key`-remounted from the parent whenever the
// KG/non-KG preset bucket changes, so switching grade doesn't leave a
// stale preset selected from the other list.
function ClassTimingPicker({
  id,
  presets,
  initialValue,
  labelClass,
  heightClass,
}: {
  id: string;
  presets: string[];
  initialValue: string;
  labelClass?: string;
  heightClass: string;
}) {
  const matchesPreset = presets.includes(initialValue);
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
        {presets.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
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

export function SectionErpFields({
  idPrefix,
  initialGrade = "",
  initialName = "",
  initialBatch = "",
  initialErpClassName = "",
  initialClassTiming = "",
  variant = "create",
  between,
}: {
  idPrefix?: string;
  initialGrade?: string;
  initialName?: string;
  initialBatch?: string;
  initialErpClassName?: string;
  initialClassTiming?: string;
  variant?: "create" | "edit";
  // Rendered between Batch and ERP class name, so callers can keep the
  // Capacity field in its original on-screen position.
  between?: ReactNode;
}) {
  const [grade, setGrade] = useState(initialGrade);
  const [name, setName] = useState(initialName);
  const [batch, setBatch] = useState(initialBatch);
  const [erpClassName, setErpClassName] = useState(initialErpClassName);
  // Once the admin has a real value here (typed it, or it was already saved),
  // stop overwriting it — autofill is only a default for an empty field.
  const [erpTouched, setErpTouched] = useState(Boolean(initialErpClassName.trim()));

  function recompute(g: string, n: string, b: string) {
    if (!erpTouched) setErpClassName(computeErpClassName(g, n, b));
  }

  const id = (base: string) => (idPrefix ? `${base}-${idPrefix}` : base);
  const isEdit = variant === "edit";
  const labelClass = isEdit ? "text-xs" : undefined;
  const heightClass = isEdit ? "h-9 " : "";
  const isKg = grade.trim().toUpperCase().includes("KG");

  return (
    <>
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("grade")} className={labelClass}>Grade</Label>
        <Input
          id={id("grade")}
          name="grade"
          placeholder="KG 1 / G1"
          className={heightClass + (isEdit ? "w-24" : "w-28")}
          required
          value={grade}
          onChange={(e) => {
            setGrade(e.target.value);
            recompute(e.target.value, name, batch);
          }}
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
          onChange={(e) => {
            setName(e.target.value);
            recompute(grade, e.target.value, batch);
          }}
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
          onChange={(e) => {
            setBatch(e.target.value);
            recompute(grade, name, e.target.value);
          }}
        />
      </div>
      {between}
      <div className={isEdit ? "space-y-1" : "space-y-1.5"}>
        <Label htmlFor={id("erp_class_name")} className={labelClass}>ERP class name</Label>
        <Input
          id={id("erp_class_name")}
          name="erp_class_name"
          placeholder="STAGE 5 A"
          className={heightClass + (isEdit ? "w-36" : "w-40")}
          value={erpClassName}
          onChange={(e) => {
            setErpClassName(e.target.value);
            setErpTouched(true);
          }}
        />
      </div>
      <ClassTimingPicker
        key={isKg ? "kg" : "grade"}
        id={id("class_timing")}
        presets={timingPresetsForGrade(grade)}
        initialValue={initialClassTiming}
        labelClass={labelClass}
        heightClass={heightClass}
      />
    </>
  );
}
