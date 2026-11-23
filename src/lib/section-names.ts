// Naming rules for a class section, shared by the Sections form (client) and
// tests. No server-only imports: this runs in the browser too.

// Same "KG" test as lib/classes.ts's isKgClass — duplicated rather than
// imported since that file is server-only.
export function isKgGrade(grade: string): boolean {
  return /kg/i.test(grade);
}

// Mirrors the "Grade-Section - Batch" label enroll_application builds
// (supabase/migrations/0082) — the Broadway class name is that same string,
// plus a curriculum prefix for KG, whose grade alone doesn't say CBSE vs
// Cambridge the way "STD …"/"STAGE …" already do. Upper-cased the same way
// the server stores grade, section and batch, so it matches the saved row.
export function buildBroadwayClassName(grade: string, name: string, batch: string, kgCurriculum: string): string {
  const g = grade.trim().toUpperCase();
  const n = name.trim().toUpperCase();
  const b = batch.trim().toUpperCase();
  if (!g || !n) return "";
  const base = `${g}-${n}${b ? ` - ${b}` : ""}`;
  if (isKgGrade(g)) return kgCurriculum ? `${kgCurriculum} ${base}` : "";
  return base;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// True when a saved Broadway class name is the automatic one for this grade
// and section, whatever batch/curriculum it was built from — e.g. "CBSE KG
// 1-A - PANSY" for KG 1 A. Such a name should keep following Batch and
// Curriculum when they change, rather than be treated as a hand-typed
// override and silently left stale (which is how a renamed batch ended up
// sending its old name to Broadway).
export function isAutomaticBroadwayName(saved: string, grade: string, name: string): boolean {
  const g = escapeRegExp(grade.trim());
  const n = escapeRegExp(name.trim());
  if (!g || !n) return false;
  const pattern = isKgGrade(grade) ? `^(CBSE|Cambridge) ${g}-${n}( - .+)?$` : `^${g}-${n}( - .+)?$`;
  return new RegExp(pattern, "i").test(saved.trim());
}
