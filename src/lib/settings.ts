import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { config } from "@/lib/config";

// Admin-editable settings stored in the app_config table (key/value), read at
// runtime so changes apply without a redeploy. Falls back to sensible defaults.
export interface AppSettings {
  feePaise: number;
  agreementTerms: string;
  schoolName: string;
  schoolContact: string;
  academicTermStart: string;
  academicOrientation: string;
}

const DEFAULT_TERMS =
  "By proceeding with the payment, the parent/guardian accepts the terms of admission, the fee schedule, and the school's code of conduct.";

export const SETTINGS_DEFAULTS: AppSettings = {
  feePaise: config.admission.feePaise,
  agreementTerms: DEFAULT_TERMS,
  schoolName: "Broadway Home Schooling",
  schoolContact: "Admissions Office · admissions@broadwayhomeschool.in",
  academicTermStart: `${config.admission.year}-06-15`,
  academicOrientation: `${config.admission.year}-06-10`,
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

  return {
    feePaise: num("admission_fee_paise", SETTINGS_DEFAULTS.feePaise),
    agreementTerms: str("agreement_terms", SETTINGS_DEFAULTS.agreementTerms),
    schoolName: str("school_name", SETTINGS_DEFAULTS.schoolName),
    schoolContact: str("school_contact", SETTINGS_DEFAULTS.schoolContact),
    academicTermStart: str("academic_term_start", SETTINGS_DEFAULTS.academicTermStart),
    academicOrientation: str("academic_orientation", SETTINGS_DEFAULTS.academicOrientation),
  };
});
