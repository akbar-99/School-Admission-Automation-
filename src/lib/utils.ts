import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function formatDateTime(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-IN", { dateStyle: "medium" });
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
