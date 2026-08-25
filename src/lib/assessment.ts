import type { Category } from "@/lib/types";

// Whether a class requires the mandatory assessment. Driven entirely by the
// class the parent picked — not age — since age at cutoff doesn't reliably
// predict which class a child enrolls into. Only "KG 1" is exempt; every
// other class, including "KG 2", requires an assessment.
export function classCategory(grade: string): Category {
  return grade.trim().toLowerCase() === "kg 1" ? "KG" : "GRADE";
}

export function needsAssessment(grade: string): boolean {
  return classCategory(grade) === "GRADE";
}
