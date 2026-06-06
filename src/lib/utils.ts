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
