import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

// Shared by the PDF/Excel export generators and the assessment-result PDF.
// Reads the logo straight off disk instead of fetching it over HTTP from
// config.appUrl — a self-referential fetch depends on NEXT_PUBLIC_APP_URL
// being correctly set to the live domain, and silently returns no logo
// (caught, swallowed) if that's misconfigured. Reading public/ directly via
// process.cwd() is the documented, reliable approach on Vercel (same
// technique Next.js recommends for embedding fonts/images in generated PDFs
// and OG images).
let cachedLogo: Uint8Array | null | undefined;

export async function fetchSchoolLogo(): Promise<Uint8Array | null> {
  if (cachedLogo !== undefined) return cachedLogo;
  try {
    const bytes = await fs.readFile(path.join(process.cwd(), "public", "broadway-logo.png"));
    cachedLogo = new Uint8Array(bytes);
  } catch {
    cachedLogo = null; // logo is optional
  }
  return cachedLogo;
}
