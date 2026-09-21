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
// an assessment. Whitespace/case are normalized away entirely (not just
// trimmed) so "KG 1", "KG1", "Kg 1", "kg  1" etc. are all recognized as the
// same exemption, regardless of how an admin happens to type the Grade field
// when creating a new KG 1 section/batch. This does NOT cover a batch name
// mistakenly merged into the Grade field itself (e.g. "KG 1 - Dahlia") — that
// still (correctly, fail-safe) requires an assessment, since it names a
// different grade string entirely, not just a spacing/capitalization variant.
export function needsAssessment(grade: string): boolean {
  return grade.replace(/\s+/g, "").toLowerCase() !== "kg1";
}
