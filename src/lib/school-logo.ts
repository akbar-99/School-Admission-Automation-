import "server-only";
import { config } from "@/lib/config";

// Shared by the export generators (admissions-pdf.ts, admissions-excel.ts).
// Mirrors the fetch used in workflow.ts for the result-PDF logo.
export async function fetchSchoolLogo(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`${config.appUrl}/broadway-logo.png`);
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  } catch {
    // logo is optional
  }
  return null;
}
