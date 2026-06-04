// Centralised configuration. Age bands / cutoff / fee are configuration values,
// not hard-coded (SRS FR-7, §4.2). Env provides defaults; the app_config table
// mirrors them for runtime overrides without redeploy.

export const config = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  appSecret: process.env.APP_SECRET ?? "dev-insecure-secret",

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  admission: {
    year: Number(process.env.ADMISSION_YEAR ?? 2026),
    ageCutoffMMDD: process.env.AGE_CUTOFF_MMDD ?? "06-01",
    kgMinAge: Number(process.env.KG_MIN_AGE ?? 3),
    kgMaxAge: Number(process.env.KG_MAX_AGE ?? 5),
    gradeMinAge: Number(process.env.GRADE_MIN_AGE ?? 6),
    defaultSectionCapacity: Number(process.env.DEFAULT_SECTION_CAPACITY ?? 30),
    feePaise: Number(process.env.ADMISSION_FEE_PAISE ?? 5000000),
    retentionDays: Number(process.env.DATA_RETENTION_DAYS ?? 2555),
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? "",
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? "",
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
    publicKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? "",
    // When keys are absent we fall back to a mock payment flow for local dev.
    get enabled() {
      return Boolean(this.keyId && this.keySecret);
    },
  },

  notifications: {
    provider: (process.env.NOTIFY_PROVIDER ?? "log") as "log" | "live",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    msg91AuthKey: process.env.MSG91_AUTH_KEY ?? "",
    whatsappToken: process.env.WHATSAPP_TOKEN ?? "",
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID ?? "",
  },

  setupSecret: process.env.SETUP_SECRET ?? process.env.APP_SECRET ?? "setup",
} as const;

export const GRADE_OPTIONS = [
  "KG",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
] as const;
