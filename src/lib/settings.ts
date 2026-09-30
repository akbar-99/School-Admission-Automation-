import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config, ASSESSMENT_SUBJECTS } from "@/lib/config";

// Admin-editable settings stored in the app_config table (key/value), read at
// runtime so changes apply without a redeploy. Falls back to sensible defaults.
export interface AppSettings {
  feePaise: number;
  agreementTerms: string;
  schoolName: string;
  schoolPhone: string;
  schoolEmail: string;
  academicTermStart: string;
  academicOrientation: string;
  studyMaterial: string; // raw, one item per line
  studyMaterialItems: string[]; // parsed list
  booksDepartmentPhones: string; // raw, one number per line — CBSE onboarding pack
  booksDepartmentPhonesItems: string[]; // parsed list
  booksProviderWebsite: string; // CBSE onboarding pack
  assessmentSubjects: string; // raw, one subject per line
  assessmentSubjectsItems: string[]; // parsed list scored on the assessment
  assessmentReminder2hMinutes: number; // lead time for the confirm/reschedule reminder
}

const DEFAULT_TERMS =
  "By proceeding with the payment, the parent/guardian accepts the terms of admission, the fee schedule, and the school's code of conduct.";

const DEFAULT_STUDY_MATERIAL = [
  "Prescribed textbooks & workbooks for the grade",
  "Two notebooks per subject",
  "School uniform & ID card (collect from front office)",
].join("\n");

const DEFAULT_BOOKS_DEPARTMENT_PHONES = ["+91 95399 31818", "+91 73062 21818"].join("\n");

export const SETTINGS_DEFAULTS = {
  feePaise: config.admission.feePaise,
  agreementTerms: DEFAULT_TERMS,
  schoolName: "Broadway Home Schooling",
  schoolPhone: "+91 95399 61818",
  schoolEmail: "info@broadwayhomeschool.com",
  booksDepartmentPhones: DEFAULT_BOOKS_DEPARTMENT_PHONES,
  booksProviderWebsite: "",
  academicTermStart: `${config.admission.year}-06-15`,
  academicOrientation: `${config.admission.year}-06-10`,
  studyMaterial: DEFAULT_STUDY_MATERIAL,
  assessmentSubjects: ASSESSMENT_SUBJECTS.join("\n"),
  assessmentReminder2hMinutes: 120,
};

// Cached per-request so multiple reads during one render hit the DB once.
export const getSettings = cache(async (): Promise<AppSettings> => {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("app_config").select("key, value");
  const map = new Map((data ?? []).map((r) => [r.key as string, r.value as string]));

  const num = (k: string, fallback: number) => {
    const v = map.get(k);
    const n = v != null && v !== "" ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (k: string, fallback: string) => {
    const v = map.get(k);
    return v != null && v !== "" ? v : fallback;
  };

  const toList = (raw: string) =>
    raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  const studyMaterial = str("study_material", SETTINGS_DEFAULTS.studyMaterial);
  const booksDepartmentPhones = str("books_department_phones", SETTINGS_DEFAULTS.booksDepartmentPhones);
  const assessmentSubjects = str("assessment_subjects", SETTINGS_DEFAULTS.assessmentSubjects);
  const assessmentSubjectsItems = toList(assessmentSubjects);
  return {
    feePaise: num("admission_fee_paise", SETTINGS_DEFAULTS.feePaise),
    agreementTerms: str("agreement_terms", SETTINGS_DEFAULTS.agreementTerms),
    schoolName: str("school_name", SETTINGS_DEFAULTS.schoolName),
    schoolPhone: str("school_phone", SETTINGS_DEFAULTS.schoolPhone),
    schoolEmail: str("school_email", SETTINGS_DEFAULTS.schoolEmail),
    academicTermStart: str("academic_term_start", SETTINGS_DEFAULTS.academicTermStart),
    academicOrientation: str("academic_orientation", SETTINGS_DEFAULTS.academicOrientation),
    studyMaterial,
    studyMaterialItems: toList(studyMaterial),
    booksDepartmentPhones,
    booksDepartmentPhonesItems: toList(booksDepartmentPhones),
    booksProviderWebsite: str("books_provider_website", SETTINGS_DEFAULTS.booksProviderWebsite),
    assessmentSubjects,
    // Fall back to defaults if the admin saved an empty list.
    assessmentSubjectsItems: assessmentSubjectsItems.length
      ? assessmentSubjectsItems
      : toList(SETTINGS_DEFAULTS.assessmentSubjects),
    assessmentReminder2hMinutes: num(
      "assessment_reminder_2h_minutes",
      SETTINGS_DEFAULTS.assessmentReminder2hMinutes,
    ),
  };
});

// Study material fee, unlike the flat admission fee, varies by grade —
// stored in its own table (study_material_fees) rather than app_config.
export const getStudyMaterialFees = cache(async (): Promise<Record<string, number>> => {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("study_material_fees").select("grade, fee_paise");
  return Object.fromEntries((data ?? []).map((r) => [r.grade as string, r.fee_paise as number]));
});

// CBSE families arrange textbooks separately (see booksDepartmentPhones /
// booksProviderWebsite in the onboarding pack) — the school never charges or
// supplies study material for them, regardless of what's configured for
// their grade. No schema change: study_material_fees stays grade-only.
export async function getStudyMaterialFeeForGrade(
  grade: string | null | undefined,
  curriculum?: string | null,
): Promise<number> {
  if (!grade) return 0;
  if (curriculum === "CBSE") return 0;
  const fees = await getStudyMaterialFees();
  return fees[grade] ?? 0;
}

// The next admission number to be issued — a single school-wide sequence
// (see broadway_admission_sequence / next_broadway_admission_number()),
// not scoped by year or grade. Admin-editable under Admin -> Settings.
export const getNextAdmissionNumber = cache(async (): Promise<number> => {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("broadway_admission_sequence").select("next_number").eq("id", 1).maybeSingle();
  return data?.next_number ?? 1;
});
