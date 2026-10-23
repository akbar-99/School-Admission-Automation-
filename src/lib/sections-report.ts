import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isNextYearAdmission } from "@/lib/broadway";
import type { AppStatus, Section } from "@/lib/types";

export interface SectionReportStudent {
  studentName: string;
  parentName: string;
  parentPhone: string | null;
  admissionNumber: string | null;
  status: AppStatus;
}

export interface SectionReportRow {
  grade: string;
  name: string;
  batch: string | null;
  classTiming: string | null;
  capacity: number;
  filled: number; // effective filled — max(this app's own counter, Broadway's)
  broadwayClassName: string | null;
  students: SectionReportStudent[];
}

// Same source data the /admin/sections page itself renders from (grade/
// section grouping, Broadway's own student counts taken as authoritative
// when bigger than this app's own counter, withdrawn students excluded) —
// kept here as the single source so the page and both export formats can
// never drift apart on what "class-wise" actually means.
export async function fetchSectionsReportRows(): Promise<SectionReportRow[]> {
  const admin = createSupabaseAdminClient();
  const [{ data }, useNextYear] = await Promise.all([
    admin.from("sections").select("*").order("grade", { ascending: true }).order("name", { ascending: true }),
    isNextYearAdmission(),
  ]);
  const sections = (data ?? []) as Section[];

  const classIds = sections.map((s) => s.broadway_class_id).filter((id): id is string => Boolean(id));
  const { data: countsData } = classIds.length
    ? await admin.from("broadway_classes").select("id, this_year_students, next_year_students").in("id", classIds)
    : { data: [] };
  const countsByClassId = new Map(
    (
      (countsData ?? []) as { id: string; this_year_students: number; next_year_students: number }[]
    ).map((c) => [c.id, useNextYear ? c.next_year_students : c.this_year_students]),
  );

  const sectionIds = sections.map((s) => s.id);
  const { data: enrolledData } = sectionIds.length
    ? await admin
        .from("applications")
        .select("section_id, admission_number, status, students(full_name), parents(full_name, phone)")
        .in("section_id", sectionIds)
        .is("withdrawn_at", null)
    : { data: [] };
  const enrolledRows = (enrolledData ?? []) as unknown as {
    section_id: string;
    admission_number: string | null;
    status: AppStatus;
    students: { full_name: string } | null;
    parents: { full_name: string; phone: string } | null;
  }[];
  const studentsBySection = enrolledRows.reduce<Record<string, SectionReportStudent[]>>((acc, r) => {
    (acc[r.section_id] ??= []).push({
      studentName: r.students?.full_name ?? "—",
      parentName: r.parents?.full_name ?? "—",
      parentPhone: r.parents?.phone ?? null,
      admissionNumber: r.admission_number,
      status: r.status,
    });
    return acc;
  }, {});

  return sections.map((s) => {
    const broadwayCount = s.broadway_class_id ? countsByClassId.get(s.broadway_class_id) : undefined;
    return {
      grade: s.grade,
      name: s.name,
      batch: s.batch,
      classTiming: s.class_timing,
      capacity: s.capacity,
      filled: Math.max(s.filled, broadwayCount ?? 0),
      broadwayClassName: s.broadway_class_name ?? s.broadway_input_name,
      students: studentsBySection[s.id] ?? [],
    };
  });
}
