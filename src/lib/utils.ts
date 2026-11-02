import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { config } from "@/lib/config";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// wa.me needs the number as plain digits (country code, no "+", no spaces)
// — phones are stored combined like "+917994480109" (see PhoneField), so
// this is just stripping everything that isn't a digit.
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

// How long before a slot's start time its Zoom link becomes usable.
export const ZOOM_LINK_LEAD_MINUTES = 30;

// Whether a Zoom join/start link should be clickable right now — from
// ZOOM_LINK_LEAD_MINUTES before the slot starts through its scheduled end
// time (if known). Past the end time it goes back to inactive — the real
// Zoom meeting is over regardless of what this button says, so there's no
// point leaving it live.
export function isZoomLinkActive(startsAt: string | Date, endsAt?: string | Date | null): boolean {
  const now = Date.now();
  const startMs = new Date(startsAt).getTime();
  if (now < startMs - ZOOM_LINK_LEAD_MINUTES * 60_000) return false;
  if (endsAt && now > new Date(endsAt).getTime()) return false;
  return true;
}

// Timers past this get skipped rather than scheduled anywhere in the app —
// browsers silently fire setTimeout immediately once its delay exceeds the
// ~24.8-day 32-bit signed int limit, and this app routinely schedules things
// (Zoom activation, assessment reminders) for slots booked weeks out. A tab
// realistically won't stay open across that gap anyway; the next real page
// load / server check re-evaluates from scratch.
export const MAX_SCHEDULABLE_TIMER_MS = 12 * 60 * 60 * 1000; // 12 hours

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

// "en-IN" alone only controls number/date formatting style, not the
// timezone used for conversion — without an explicit timeZone, this
// silently uses the server process's own timezone (e.g. UTC on most
// hosts), which is wrong for a school whose staff are all in IST.
export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: config.school.timezone,
  });
}

// claim_assessment_slot (supabase/migrations/0083_assessment_slot_weekly_cap.sql,
// superseded by 0084_assessment_slot_weekly_total_ledger.sql) hardcodes this
// exact literal for its own week-boundary math rather than reading a config
// value. Anything that needs to bucket by the SAME week the RPC enforces —
// the ledger-increment in createAssessmentSlot, and the admin slot
// calculator — must use this constant, not config.school.timezone, so they
// can never silently diverge from real enforcement if SCHOOL_TIMEZONE is
// ever overridden to a different zone.
export const ASSESSMENT_WEEK_TIMEZONE = "Asia/Kolkata";

// ---------------------------------------------------------------------------
// Weekday/week-boundary helpers, evaluated in a given IANA timezone so a
// DST-less IST-style zone and a DST-observing one both resolve the same
// wall-clock weekday. Shared by the admin "Create slots" recurrence math and
// the weekly-claim-cap ledger (see createAssessmentSlot / claim_assessment_slot)
// — both need to agree on exactly which calendar week a given instant falls
// in, so this is the single source of truth rather than two copies drifting.
// ---------------------------------------------------------------------------
export function zonedYMD(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

export function zonedWeekday(date: Date, timeZone: string) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(name);
}

// Add `days` calendar days to a Y/M/D triple (pure calendar arithmetic).
export function addDays(ymd: { y: number; m: number; d: number }, days: number) {
  const t = Date.UTC(ymd.y, ymd.m - 1, ymd.d) + days * 86_400_000;
  const dt = new Date(t);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// The Monday ("YYYY-MM-DD", in `timeZone`) of the ISO week containing `date`
// — matches claim_assessment_slot's own date_trunc('week', …) bucketing
// (Monday start), so a JS-computed week key always lands on the same ledger
// row the RPC reads.
export function weekStartDateStr(date: Date, timeZone: string): string {
  const weekday = zonedWeekday(date, timeZone); // 0=Sunday..6=Saturday
  const deltaToMonday = weekday === 0 ? 6 : weekday - 1;
  const { y, m, d } = addDays(zonedYMD(date, timeZone), -deltaToMonday);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: config.school.timezone });
}

// Format an instant in a specific IANA timezone (e.g. "Asia/Kolkata").
export function formatInZone(value: string | Date, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  try {
    return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone });
  } catch {
    return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  }
}

// Same as formatInZone, but with the weekday name prefixed (e.g. "Wed, 26 Aug 2026, 8:46 pm").
// Intl doesn't allow mixing dateStyle/timeStyle with weekday, hence the explicit fields.
export function formatInZoneWithDay(value: string | Date, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  try {
    return d.toLocaleString("en-IN", { ...opts, timeZone });
  } catch {
    return d.toLocaleString("en-IN", opts);
  }
}

// Interpret a naive "YYYY-MM-DDTHH:mm" wall-clock as a time in the given IANA
// timezone and return the matching UTC instant (ISO string). The inverse of
// toZonedInputValue. Used when staff enter slot times in school time.
export function zonedTimeToUtcISO(local: string, timeZone: string): string {
  if (!local) return "";
  const norm = local.length === 16 ? `${local}:00` : local; // ensure seconds
  const asIfUtc = new Date(`${norm}Z`); // treat the wall-clock as if it were UTC
  if (Number.isNaN(asIfUtc.getTime())) return "";
  try {
    // How far that instant's clock in `timeZone` is ahead of/behind UTC.
    const tz = new Date(asIfUtc.toLocaleString("en-US", { timeZone }));
    const utc = new Date(asIfUtc.toLocaleString("en-US", { timeZone: "UTC" }));
    const offset = tz.getTime() - utc.getTime();
    return new Date(asIfUtc.getTime() - offset).toISOString();
  } catch {
    return asIfUtc.toISOString();
  }
}

// Convert an instant into a "YYYY-MM-DDTHH:mm" string (the value format a
// <input type="datetime-local"> expects), expressed in the given IANA timezone.
// Used to pre-fill the confirmed-time field from a parent's requested time.
export function toZonedInputValue(value: string | Date, timeZone: string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .formatToParts(d)
      .reduce<Record<string, string>>((acc, p) => {
        acc[p.type] = p.value;
        return acc;
      }, {});
    // Some engines render midnight as "24"; normalise to "00".
    const hour = parts.hour === "24" ? "00" : parts.hour;
    return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
  } catch {
    return "";
  }
}
