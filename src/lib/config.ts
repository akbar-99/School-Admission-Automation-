// Centralised configuration. Age bands / cutoff / fee are configuration values,
// not hard-coded (SRS FR-7, §4.2). Env provides defaults; the app_config table
// mirrors them for runtime overrides without redeploy.

// Resolve the public base URL: explicit env first, then the Vercel-injected
// production URL, then localhost for dev.
function resolveAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const config = {
  // Public base URL for parent-facing links (admission link, agreement, receipt).
  // Set NEXT_PUBLIC_APP_URL explicitly in production. Falls back to Vercel's
  // injected `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`, then localhost.
  // Trailing slashes are stripped.
  appUrl: resolveAppUrl(),
  appSecret: process.env.APP_SECRET ?? "dev-insecure-secret",

  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  },

  // The school's operating timezone — staff see times converted to this.
  school: {
    timezone: process.env.SCHOOL_TIMEZONE ?? "Asia/Kolkata",
    timezoneLabel: process.env.SCHOOL_TIMEZONE_LABEL ?? "IST",
  },

  admission: {
    year: Number(process.env.ADMISSION_YEAR ?? 2026),
    defaultSectionCapacity: Number(process.env.DEFAULT_SECTION_CAPACITY ?? 30),
    feePaise: Number(process.env.ADMISSION_FEE_PAISE ?? 5000000),
    retentionDays: Number(process.env.DATA_RETENTION_DAYS ?? 2555),
  },

  // Zoom Server-to-Server OAuth app (school's licensed Zoom account). Used to
  // auto-create assessment meetings hosted by the assigned teacher's own Zoom
  // account. ZOOM_DEFAULT_HOST_EMAIL is a fallback host (e.g. an admin's Zoom
  // login) used when a teacher has no Zoom account on the license.
  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID ?? "",
    clientId: process.env.ZOOM_CLIENT_ID ?? "",
    clientSecret: process.env.ZOOM_CLIENT_SECRET ?? "",
    defaultHostEmail: process.env.ZOOM_DEFAULT_HOST_EMAIL ?? "",
    get enabled() {
      return Boolean(this.accountId && this.clientId && this.clientSecret);
    },
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
    // SMTP email transport (e.g. Hostinger). Preferred over Resend when set.
    smtp: {
      host: process.env.SMTP_HOST ?? "",
      port: Number(process.env.SMTP_PORT ?? 465),
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      // Display From; defaults to the authenticated mailbox.
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
      get enabled() {
        return Boolean(this.host && this.user && this.pass);
      },
    },
  },

  setupSecret: process.env.SETUP_SECRET ?? process.env.APP_SECRET ?? "setup",
} as const;

// Fallback class list used only when no sections exist yet. Normally the
// admission form's classes come from the grades that have sections
// (see getClassOptions in lib/classes.ts).
export const GRADE_OPTIONS = [
  "KG 1",
  "KG 2",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
] as const;

// Curriculum options offered on the admission form (editable).
export const CURRICULUM_OPTIONS = ["IGCSE - Cambridge", "CBSE"] as const;

// Subjects scored during a Grade assessment. The teacher records a score,
// a comment and an optional file (PDF / Excel) per subject.
export const ASSESSMENT_SUBJECTS = ["Maths", "English"] as const;
