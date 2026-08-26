import type { Category } from "@/lib/types";

// The KG/GRADE category is a taxonomic label only, based on the class name —
// any class whose name contains "KG" (KG 1, KG 2, ...) is labeled "KG",
// everything else "GRADE". It is NOT the same thing as whether an assessment
// is required — see needsAssessment() below.
export function classCategory(grade: string): Category {
  return /kg/i.test(grade) ? "KG" : "GRADE";
}

// Whether a class requires the mandatory assessment. Driven entirely by the
// class the parent picked — not age, and not the KG/GRADE label above —
// since age at cutoff doesn't reliably predict which class a child enrolls
// into. Only "KG 1" is exempt; every other class, including "KG 2", requires
// an assessment.
export function needsAssessment(grade: string): boolean {
  return grade.trim().toLowerCase() !== "kg 1";
}
