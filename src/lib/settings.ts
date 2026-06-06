import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config, GRADE_OPTIONS } from "@/lib/config";

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
  classOptions: string; // raw, one class per line
  classOptionsItems: string[]; // parsed list shown on the admission form
}

const DEFAULT_TERMS =
  "By proceeding with the payment, the parent/guardian accepts the terms of admission, the fee schedule, and the school's code of conduct.";

const DEFAULT_STUDY_MATERIAL = [
  "Prescribed textbooks & workbooks for the grade",
  "Two notebooks per subject",
  "School uniform & ID card (collect from front office)",
].join("\n");

export const SETTINGS_DEFAULTS = {
  feePaise: config.admission.feePaise,
  agreementTerms: DEFAULT_TERMS,
  schoolName: "Broadway Home Schooling",
  schoolPhone: "+91 90000 00000",
  schoolEmail: "admissions@broadwayhomeschool.in",
  academicTermStart: `${config.admission.year}-06-15`,
  academicOrientation: `${config.admission.year}-06-10`,
  studyMaterial: DEFAULT_STUDY_MATERIAL,
  classOptions: GRADE_OPTIONS.join("\n"),
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

  const studyMaterial = str("study_material", SETTINGS_DEFAULTS.studyMaterial);
  const classOptions = str("class_options", SETTINGS_DEFAULTS.classOptions);
  const toList = (raw: string) =>
    raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const classOptionsItems = toList(classOptions);
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
    classOptions,
    // Always fall back to the defaults if the admin saved an empty list.
    classOptionsItems: classOptionsItems.length ? classOptionsItems : toList(SETTINGS_DEFAULTS.classOptions),
  };
});
