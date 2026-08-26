import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppStatus } from "@/lib/types";

export interface AdmissionsReportFilters {
  status?: AppStatus;
  category?: "KG" | "GRADE";
  grade?: string;
  from?: string; // YYYY-MM-DD, inclusive
  to?: string; // YYYY-MM-DD, inclusive
}

export interface AdmissionsReportRow {
  id: string;
  status: AppStatus;
  category: string | null;
  gradeApplying: string | null;
  admissionNumber: string | null;
  createdAt: string;
  parentName: string;
  parentPhone: string;
  studentName: string;
  sectionGrade: string | null;
  sectionName: string | null;
}

// Reads the same filter keys the admin overview page's filter form submits.
export function parseAdmissionsFilters(sp: {
  status?: string;
  category?: string;
  grade?: string;
  from?: string;
  to?: string;
}): AdmissionsReportFilters {
  return {
    status: (sp.status as AppStatus) || undefined,
    category: sp.category === "KG" || sp.category === "GRADE" ? sp.category : undefined,
    grade: sp.grade || undefined,
    from: sp.from || undefined,
    to: sp.to || undefined,
  };
}

export function describeFilters(filters: AdmissionsReportFilters): string {
  const parts: string[] = [];
  if (filters.status) parts.push(`Status: ${filters.status.replaceAll("_", " ")}`);
  if (filters.category) parts.push(`Category: ${filters.category}`);
  if (filters.grade) parts.push(`Grade: ${filters.grade}`);
  if (filters.from || filters.to) {
    parts.push(`Created: ${filters.from ?? "any"} to ${filters.to ?? "any"}`);
  }
  return parts.length ? parts.join(" · ") : "All applications";
}

// Shared by the on-screen table (capped) and the PDF/Excel exports
// (effectively unbounded, capped generously for safety).
export async function fetchAdmissionsReportRows(
  filters: AdmissionsReportFilters,
  limit: number,
): Promise<AdmissionsReportRow[]> {
  const admin = createSupabaseAdminClient();
  let query = admin
    .from("applications")
    .select(
      "id, status, category, grade_applying, admission_number, created_at, parents(full_name, phone), students(full_name), sections(grade, name)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.grade) query = query.eq("grade_applying", filters.grade);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);

  const { data } = await query;
  return ((data ?? []) as unknown as {
    id: string;
    status: AppStatus;
    category: string | null;
    grade_applying: string | null;
    admission_number: string | null;
    created_at: string;
    parents: { full_name: string; phone: string } | null;
    students: { full_name: string } | null;
    sections: { grade: string; name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    status: r.status,
    category: r.category,
    gradeApplying: r.grade_applying,
    admissionNumber: r.admission_number,
    createdAt: r.created_at,
    parentName: r.parents?.full_name ?? "—",
    parentPhone: r.parents?.phone ?? "—",
    studentName: r.students?.full_name ?? "—",
    sectionGrade: r.sections?.grade ?? null,
    sectionName: r.sections?.name ?? null,
  }));
}
