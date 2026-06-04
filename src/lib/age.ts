import { config } from "@/lib/config";
import type { Category } from "@/lib/types";

// Cutoff date for the admission year (SRS FR-7), e.g. 2026-06-01.
export function admissionCutoffDate(): Date {
  return new Date(
    `${config.admission.year}-${config.admission.ageCutoffMMDD}T00:00:00`,
  );
}

// Completed years between dob and a reference date.
export function completedYears(dob: Date, asOf: Date): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const m = asOf.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < dob.getDate())) age -= 1;
  return age;
}

export interface CategoryResult {
  ageYears: number;
  category: Category | null;
  eligible: boolean;
  message: string;
}

// Auto-detect KG vs Grade from age at the configured cutoff (SRS FR-7).
//   kgMin..kgMax years  -> KG
//   >= gradeMin years   -> GRADE
export function detectCategory(dobIso: string): CategoryResult {
  const dob = new Date(`${dobIso}T00:00:00`);
  const cutoff = admissionCutoffDate();
  const ageYears = completedYears(dob, cutoff);
  const { kgMinAge, kgMaxAge, gradeMinAge } = config.admission;

  if (Number.isNaN(ageYears)) {
    return { ageYears: 0, category: null, eligible: false, message: "Invalid date of birth." };
  }
  if (ageYears < kgMinAge) {
    return {
      ageYears,
      category: null,
      eligible: false,
      message: `Child is ${ageYears} year(s) old as of ${cutoff.toDateString()} — below the minimum age of ${kgMinAge} for KG.`,
    };
  }
  if (ageYears >= kgMinAge && ageYears <= kgMaxAge) {
    return { ageYears, category: "KG", eligible: true, message: "Eligible for KG." };
  }
  if (ageYears >= gradeMinAge) {
    return { ageYears, category: "GRADE", eligible: true, message: "Eligible for Grade (assessment required)." };
  }
  return { ageYears, category: "KG", eligible: true, message: "Eligible for KG." };
}
