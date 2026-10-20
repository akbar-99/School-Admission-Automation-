"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// Same curriculum-filter logic as lib/classes.ts's filterClassOptionsByCurriculum
// — duplicated rather than imported since that file is server-only (it also
// defines getClassOptions, which hits the database) and this component runs
// client-side, so the class list is filtered live as the curriculum changes
// instead of needing a page reload.
function filterByCurriculum(grades: string[], curriculum: string): string[] {
  if (!curriculum) return grades;
  return grades.filter((g) => {
    const isCambridgeNamed = /^stage\b/i.test(g);
    const isCbseNamed = /^std\b/i.test(g);
    if (curriculum === "Cambridge") return !isCbseNamed;
    if (curriculum === "CBSE") return !isCambridgeNamed;
    return true;
  });
}

// Curriculum + Class, paired: picking a curriculum filters the Class list
// down to just that curriculum's classes (KG stays visible for either,
// matching filterClassOptionsByCurriculum's own behavior). Both fields are
// optional — marketing staff entering a lead often doesn't know the class
// yet, same as the existing "Student's name (optional)" field on this form.
export function CurriculumClassFields({
  classOptions,
  initialCurriculum = "",
  initialGrade = "",
}: {
  classOptions: string[];
  initialCurriculum?: string;
  initialGrade?: string;
}) {
  const [curriculum, setCurriculum] = useState(initialCurriculum);
  const [grade, setGrade] = useState(initialGrade);
  const filtered = filterByCurriculum(classOptions, curriculum);

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="preferred_curriculum">Curriculum</Label>
        <Select
          id="preferred_curriculum"
          name="preferred_curriculum"
          value={curriculum}
          onChange={(e) => {
            setCurriculum(e.target.value);
            // The previously picked class may not belong to the new
            // curriculum — clear it rather than silently submit a mismatch.
            setGrade("");
          }}
        >
          <option value="">Not sure yet</option>
          <option value="CBSE">CBSE</option>
          <option value="Cambridge">Cambridge</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="grade_applying">Class</Label>
        <Select
          id="grade_applying"
          name="grade_applying"
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
        >
          <option value="">Not sure yet</option>
          {filtered.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
      </div>
    </>
  );
}
