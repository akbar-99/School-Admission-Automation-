import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { GRADE_OPTIONS } from "@/lib/config";

// A class is a "KG" (kindergarten) grade if its name contains "KG".
export function isKgClass(name: string): boolean {
  return /kg/i.test(name);
}

// Order: KG classes first, then the rest; within each, by trailing number
// (KG 1 < KG 2, G1 < G2 < … < G10), falling back to alphabetical.
function compareClasses(a: string, b: string): number {
  const ak = isKgClass(a);
  const bk = isKgClass(b);
  if (ak !== bk) return ak ? -1 : 1;
  const an = parseInt(a.replace(/\D/g, ""), 10);
  const bn = parseInt(b.replace(/\D/g, ""), 10);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
  return a.localeCompare(b);
}

// The classes offered on the admission form are the distinct grades that have
// at least one section (Admin → Sections). Falls back to the default list only
// when no sections exist yet, so the form is never empty on a fresh setup.
export const getClassOptions = cache(async (): Promise<string[]> => {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("sections").select("grade");
  const grades = Array.from(
    new Set((data ?? []).map((r) => String(r.grade ?? "").trim()).filter(Boolean)),
  );
  if (grades.length === 0) return [...GRADE_OPTIONS];
  return grades.sort(compareClasses);
});

// Cambridge sections are named "STAGE …", CBSE sections "STD …" (a naming
// convention, not a DB column — confirmed consistent across every live
// section as of this writing). Filters the full class list down to one
// curriculum so the admission form's Class dropdown doesn't mix both
// curricula's grades together. A grade following neither convention (e.g.
// a shared "KG" class) stays visible for both, rather than being hidden.
export function filterClassOptionsByCurriculum(grades: string[], curriculum: string | null): string[] {
  if (!curriculum) return grades;
  return grades.filter((g) => {
    const isCambridgeNamed = /^stage\b/i.test(g);
    const isCbseNamed = /^std\b/i.test(g);
    if (curriculum === "Cambridge") return !isCbseNamed;
    if (curriculum === "CBSE") return !isCambridgeNamed;
    return true;
  });
}
