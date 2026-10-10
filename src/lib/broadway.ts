import "server-only";
import { config } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Broadway platform client — the school's system of record for classes,
// students and families (replaces the old ERP integration). API contract:
// docs/broadway-integration.md. Same pattern as the old client it replaces:
// server-only, config-gated, boundary functions never throw (a Broadway
// outage must not break enrollment or an admin action) — they log with a
// [broadway] prefix and return a typed failure result instead.
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.broadway.apiKey}` };
}

interface BroadwayErrorBody {
  error?: string;
}

// Shared by every call below: joins the configured base URL, attaches the
// bearer token, applies the 10s timeout, and parses Broadway's uniform
// { "error": "<message>" } error shape. Returns the raw Response alongside
// the parsed body so each caller can branch on status codes that mean
// something specific to it (404/409/403 aren't always failures here).
async function broadwayFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; ok: boolean; json: unknown; text: string } | { error: string }> {
  try {
    const res = await fetch(`${config.broadway.apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        ...authHeaders(),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // fall through with json = null; raw text still available for logging
    }
    return { status: res.status, ok: res.ok, json, text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function errorMessage(result: { json: unknown; text: string; status: number }): string {
  const parsed = result.json as BroadwayErrorBody | null;
  return parsed?.error ?? `HTTP ${result.status}: ${result.text}`;
}

// ---------------------------------------------------------------------------
// GET /classes — sections, seats, next year's numbers. Replaces the old
// capacity sync.
// ---------------------------------------------------------------------------
export interface BroadwayClassEntry {
  id: string;
  name: string;
  curriculum: string;
  grade: number;
  gradeLabel: string;
  section: string;
  batch: string | null;
  division: string | null;
  timingId: string | null;
  timing: string | null;
  seats: number | null;
  thisYear: { students: number; seatsLeft: number | null };
  nextYear: { continuing: number; joining: number; students: number; seatsLeft: number | null };
}

export interface BroadwayClassesResponse {
  academicYear: { current: string; next: string };
  promoted: Record<string, boolean>;
  timings: { id: string; label: string; grades: number[] }[];
  classes: BroadwayClassEntry[];
  notPlaced: { curriculum: string; grade: number; students: number }[];
}

export async function fetchBroadwayClasses(): Promise<BroadwayClassesResponse | null> {
  if (!config.broadway.enabled) return null;
  const result = await broadwayFetch("/classes");
  if ("error" in result) {
    console.error("[broadway] classes fetch threw", result.error);
    return null;
  }
  if (!result.ok) {
    console.error(`[broadway] classes fetch failed (${result.status}): ${result.text}`);
    return null;
  }
  return result.json as BroadwayClassesResponse;
}

// ---------------------------------------------------------------------------
// GET /students — find a student or an admission. Replaces the old roster
// sync and ERP search. Used directly for a one-off lookup (e.g. confirming
// an admission after the fact); syncBroadwayStudents below pages through
// this for the local search cache.
// ---------------------------------------------------------------------------
export interface BroadwayStudentEntry {
  studentId: string;
  admissionNo: string | null;
  name: string;
  curriculum: string | null;
  grade: number | null;
  gradeLabel: string | null;
  status: "Active" | "Incoming" | "Left";
  classId: string | null;
  className: string | null;
  plannedClassId: string | null;
  plannedClassName: string | null;
  joinsYear: string | null;
  applicationId: string | null;
  parentName: string | null;
  parentEmail: string | null;
}

export interface FetchBroadwayStudentsQuery {
  id?: string;
  admissionNo?: string;
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function fetchBroadwayStudents(
  query: FetchBroadwayStudentsQuery,
): Promise<{ total: number; students: BroadwayStudentEntry[] } | null> {
  if (!config.broadway.enabled) return null;
  const params = new URLSearchParams();
  if (query.id) params.set("id", query.id);
  if (query.admissionNo) params.set("admissionNo", query.admissionNo);
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));

  const result = await broadwayFetch(`/students?${params.toString()}`);
  if ("error" in result) {
    console.error("[broadway] students fetch threw", result.error);
    return null;
  }
  if (!result.ok) {
    console.error(`[broadway] students fetch failed (${result.status}): ${result.text}`);
    return null;
  }
  return result.json as { total: number; students: BroadwayStudentEntry[] };
}

// ---------------------------------------------------------------------------
// POST /admissions — send an admission at enrolment. Resending the same `id`
// is safe (updates the admission until the student joins), so this is used
// for both the first send and every retry.
// ---------------------------------------------------------------------------
export interface BroadwayAdmissionPayload {
  id: string;
  academicYear: string;
  studentName: string;
  curriculum: string;
  grade: string;
  parentName: string;
  parentEmail: string;
  classId?: string | null;
  admissionNo?: string | null;
  dob?: string | null;
  gender?: string | null;
  parentPhone?: string | null;
  country?: string | null;
  enrolledOn?: string | null;
  fatherName?: string | null;
  fatherPhone?: string | null;
  motherName?: string | null;
  motherPhone?: string | null;
  address?: string | null;
  previousSchool?: string | null;
  pen?: string | null;
}

export interface BroadwayAdmissionResultOk {
  id: string;
  ok: true;
  studentId: string;
  admissionNo: string;
  status: "Active" | "Incoming";
  updated: boolean;
  classId: string | null;
  className: string | null;
  warnings: string[];
}
export interface BroadwayAdmissionResultFail {
  id: string;
  ok: false;
  code: number;
  error: string;
}
export type BroadwayAdmissionResult = BroadwayAdmissionResultOk | BroadwayAdmissionResultFail;

// Single-admission convenience wrapper around the batch endpoint. Never
// throws; a transport failure (not reaching Broadway at all) is reported in
// the same shape as a per-admission failure so callers only need one branch.
export async function sendBroadwayAdmission(
  payload: BroadwayAdmissionPayload,
): Promise<BroadwayAdmissionResult> {
  if (!config.broadway.enabled) {
    return { id: payload.id, ok: false, code: 0, error: "Broadway integration not configured" };
  }
  const result = await broadwayFetch("/admissions", { method: "POST", body: payload });
  if ("error" in result) {
    return { id: payload.id, ok: false, code: 0, error: result.error };
  }
  if (!result.ok) {
    return { id: payload.id, ok: false, code: result.status, error: errorMessage(result) };
  }
  const body = result.json as { results?: BroadwayAdmissionResult[] } | null;
  const first = body?.results?.[0];
  if (!first) {
    return { id: payload.id, ok: false, code: result.status, error: `Unexpected response: ${result.text}` };
  }
  return first;
}

// ---------------------------------------------------------------------------
// POST /admissions/section — change (or, before joining, set) a student's
// section.
// ---------------------------------------------------------------------------
export type ChangeSectionResult =
  | { ok: true; studentId: string; admissionNo: string; status: "Active" | "Incoming"; classId: string | null; className: string | null; warnings: string[] }
  | { ok: false; error: string };

export async function changeBroadwaySection(
  applicationId: string,
  classId: string,
  reason?: string | null,
  date?: string | null,
): Promise<ChangeSectionResult> {
  if (!config.broadway.enabled) return { ok: false, error: "Broadway integration not configured" };
  const result = await broadwayFetch("/admissions/section", {
    method: "POST",
    body: { id: applicationId, classId, ...(reason ? { reason } : {}), ...(date ? { date } : {}) },
  });
  if ("error" in result) return { ok: false, error: result.error };
  if (!result.ok) return { ok: false, error: errorMessage(result) };
  const body = result.json as {
    studentId: string;
    admissionNo: string;
    status: "Active" | "Incoming";
    classId: string | null;
    className: string | null;
    warnings?: string[];
  };
  return { ok: true, ...body, warnings: body.warnings ?? [] };
}

// ---------------------------------------------------------------------------
// POST /admissions/cancel — cancel before joining. A 409 means the student
// has already joined Broadway (only the school can withdraw them there,
// under Student records) — reported distinctly from a real failure so
// callers can show the right message instead of treating it as retryable.
// ---------------------------------------------------------------------------
export type CancelAdmissionResult =
  | { ok: true }
  | { ok: false; alreadyJoined: true }
  | { ok: false; alreadyJoined: false; error: string };

export async function cancelBroadwayAdmission(
  applicationId: string,
  reason: string,
): Promise<CancelAdmissionResult> {
  if (!config.broadway.enabled) return { ok: false, alreadyJoined: false, error: "Broadway integration not configured" };
  const result = await broadwayFetch("/admissions/cancel", {
    method: "POST",
    body: { id: applicationId, reason },
  });
  if ("error" in result) return { ok: false, alreadyJoined: false, error: result.error };
  if (result.status === 409) return { ok: false, alreadyJoined: true };
  // 404 means Broadway never had this id (never actually sent, or already
  // removed) — nothing left to cancel, so this counts as success.
  if (result.status === 404) return { ok: true };
  if (!result.ok) return { ok: false, alreadyJoined: false, error: errorMessage(result) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Refresh the local broadway_classes cache from GET /classes. Called by the
// periodic cron poll and the admin "Sync now" button. Never throws; returns
// the number of classes synced, or null on fetch failure.
// ---------------------------------------------------------------------------
export async function syncBroadwayClasses(): Promise<number | null> {
  const data = await fetchBroadwayClasses();
  if (!data) return null;

  const admin = createSupabaseAdminClient();
  const rows = data.classes.map((c) => ({
    id: c.id,
    name: c.name,
    curriculum: c.curriculum,
    grade: c.grade,
    grade_label: c.gradeLabel,
    section: c.section,
    batch: c.batch,
    division: c.division,
    timing_id: c.timingId,
    timing: c.timing,
    seats: c.seats,
    this_year_students: c.thisYear.students,
    this_year_seats_left: c.thisYear.seatsLeft,
    next_year_continuing: c.nextYear.continuing,
    next_year_joining: c.nextYear.joining,
    next_year_students: c.nextYear.students,
    next_year_seats_left: c.nextYear.seatsLeft,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await admin.from("broadway_classes").upsert(rows, { onConflict: "id" });
  if (upsertErr) {
    console.error("[broadway] classes upsert failed", upsertErr);
    return null;
  }

  // Drop cached classes Broadway no longer reports (deleted/renamed there).
  const currentIds = new Set(data.classes.map((c) => c.id));
  const { data: existing } = await admin.from("broadway_classes").select("id");
  const stale = (existing ?? []).map((r) => r.id as string).filter((id) => !currentIds.has(id));
  if (stale.length > 0) {
    await admin.from("broadway_classes").delete().in("id", stale);
  }

  return data.classes.length;
}

// ---------------------------------------------------------------------------
// Refresh the local broadway_students cache — pages through GET /students
// (limit 500 per the doc's max) so Admin -> Broadway's search has a full
// roster to search without hitting Broadway live on every keystroke. Never
// throws; returns the number of students cached, or null if nothing could
// be fetched at all.
// ---------------------------------------------------------------------------
const STUDENT_PAGE_SIZE = 500;
const MAX_STUDENT_PAGES = 40; // 20,000 students — generous ceiling against a runaway loop

export async function syncBroadwayStudents(): Promise<number | null> {
  if (!config.broadway.enabled) return null;
  const admin = createSupabaseAdminClient();
  const syncedAt = new Date().toISOString();

  const rows: {
    student_id: string;
    admission_no: string | null;
    full_name: string;
    curriculum: string | null;
    grade: number | null;
    grade_label: string | null;
    status: string;
    class_id: string | null;
    class_name: string | null;
    planned_class_id: string | null;
    planned_class_name: string | null;
    joins_year: string | null;
    application_id: string | null;
    parent_name: string | null;
    parent_email: string | null;
    synced_at: string;
  }[] = [];

  let offset = 0;
  let total = Infinity;
  let page = 0;
  while (offset < total && page < MAX_STUDENT_PAGES) {
    const result = await fetchBroadwayStudents({
      limit: STUDENT_PAGE_SIZE,
      offset,
      status: "Active,Incoming,Left",
    });
    if (!result) return rows.length > 0 ? rows.length : null;
    total = result.total;
    for (const s of result.students) {
      rows.push({
        student_id: s.studentId,
        admission_no: s.admissionNo,
        full_name: s.name,
        curriculum: s.curriculum,
        grade: s.grade,
        grade_label: s.gradeLabel,
        status: s.status,
        class_id: s.classId,
        class_name: s.className,
        planned_class_id: s.plannedClassId,
        planned_class_name: s.plannedClassName,
        joins_year: s.joinsYear,
        application_id: s.applicationId,
        parent_name: s.parentName,
        parent_email: s.parentEmail,
        synced_at: syncedAt,
      });
    }
    offset += STUDENT_PAGE_SIZE;
    page += 1;
  }

  if (rows.length === 0) return null;

  const { error: upsertErr } = await admin.from("broadway_students").upsert(rows, { onConflict: "student_id" });
  if (upsertErr) {
    console.error("[broadway] students upsert failed", upsertErr);
    return null;
  }

  const currentIds = new Set(rows.map((r) => r.student_id));
  const { data: existing } = await admin.from("broadway_students").select("student_id");
  const stale = (existing ?? []).map((r) => r.student_id as string).filter((id) => !currentIds.has(id));
  if (stale.length > 0) {
    await admin.from("broadway_students").delete().in("student_id", stale);
  }

  return rows.length;
}
