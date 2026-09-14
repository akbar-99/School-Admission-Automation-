import "server-only";
import { config } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// School ERP admission-sync client. Both endpoints already exist, are
// deployed, and are owned by the ERP side — this file only calls them.
// Same pattern as lib/zoom.ts: server-only, config-gated, boundary functions
// never throw (an ERP outage must not break enrollment) — they log with an
// [erp] prefix and return a typed failure result instead.
// ---------------------------------------------------------------------------

const CAPACITY_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-class-capacity";
const CLASS_STUDENTS_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-class-students";
const WEBHOOK_URL = "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-webhook";
const CLASS_WEBHOOK_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-class-webhook";
const CLASS_DEACTIVATE_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-class-deactivate";
const STUDENT_DEACTIVATE_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-student-deactivate";
const STUDENT_TRANSFER_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-student-transfer";

function authHeaders(): Record<string, string> {
  return { "x-admissions-secret": config.erp.secret };
}

// Separate credential from authHeaders() above — the ERP issued a distinct
// secret for the class-push webhook.
function classAuthHeaders(): Record<string, string> {
  return { "x-admissions-secret": config.erp.classWebhookSecret };
}

export interface ErpClassEntry {
  class_name: string;
  base: string;
  division: string;
  batch: string | null;
  is_kg: boolean;
  capacity: number;
  enrolled: number;
  seats_available: number;
}

// Fetch every class/division/batch the ERP knows about. Never throws.
export async function fetchErpClassCapacity(): Promise<ErpClassEntry[] | null> {
  if (!config.erp.enabled) return null;
  try {
    const res = await fetch(CAPACITY_URL, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      console.error(`[erp] capacity fetch failed (${res.status}): ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { classes: ErpClassEntry[] };
    return json.classes;
  } catch (err) {
    console.error("[erp] capacity fetch threw", err);
    return null;
  }
}

export interface ErpClassStudentEntry {
  // The ERP's own human-readable admission number (e.g. "2892") — display
  // only, confirmed with the ERP team as the intended value to show admins.
  student_id: string;
  // The ERP's internal row id (a UUID) — the actual identifier
  // admissions-student-transfer / admissions-student-deactivate require.
  // Added after student_id turned out to be the wrong id space for those
  // calls; present for every student in the roster, not just ones this app
  // created itself.
  internal_id: string;
  full_name: string;
  // This app's own applications.id — populated only when the student was
  // created via our admissions-webhook (same admission_id we send in that
  // payload); null when entered directly in the ERP. Uses the same shared
  // secret as the capacity endpoint (ADMISSIONS_WEBHOOK_SECRET), not the
  // separate class-webhook secret.
  admission_id: string | null;
}

// Fetch the real student roster for one ERP class — same matching logic the
// ERP already uses to compute admissions-class-capacity's "enrolled" count,
// so this list and that count always agree. Never throws.
export async function fetchErpClassStudents(className: string): Promise<ErpClassStudentEntry[] | null> {
  if (!config.erp.enabled) return null;
  try {
    const url = `${CLASS_STUDENTS_URL}?class_name=${encodeURIComponent(className)}`;
    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      console.error(`[erp] class students fetch failed (${res.status}): ${await res.text()}`);
      return null;
    }
    const json = (await res.json()) as { class_name: string; students: ErpClassStudentEntry[] };
    return json.students;
  } catch (err) {
    console.error("[erp] class students fetch threw", err);
    return null;
  }
}

export interface ErpAdmissionPayload {
  admission_id: string;
  student_id: string;
  full_name: string;
  class_name: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  address?: string | null;
  parent_name?: string | null;
  parent_phone?: string | null;
  parent_email?: string | null;
  joining_date?: string | null;
}

export type SendErpAdmissionResult =
  | { ok: true; erpStudentId: string; warning: string | null }
  | { ok: false; error: string };

// Notify the ERP a student was admitted. Idempotent on the ERP side keyed by
// admission_id (a retried call updates the same record). Never throws.
export async function sendErpAdmission(
  payload: ErpAdmissionPayload,
): Promise<SendErpAdmissionResult> {
  if (!config.erp.enabled) return { ok: false, error: "ERP integration not configured" };
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `ERP webhook failed (${res.status}): ${text}` };
    }
    const json = JSON.parse(text) as { success: boolean; student_id: string; warning: string | null };
    if (!json.success) {
      return { ok: false, error: `ERP webhook returned success:false: ${text}` };
    }
    return { ok: true, erpStudentId: json.student_id, warning: json.warning ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Resync the local erp_classes cache from the ERP's capacity endpoint. Called
// by the periodic cron poll and the admin "Sync now" button. Never throws;
// returns the number of classes synced, or null on fetch failure.
// ---------------------------------------------------------------------------
export async function syncErpCapacity(): Promise<number | null> {
  const classes = await fetchErpClassCapacity();
  if (!classes) return null;

  const admin = createSupabaseAdminClient();
  // A row missing a usable capacity can't be upserted (not-null column) and
  // can't be claimed against anyway — skip it rather than fail the whole
  // sync over one bad entry, but log it since it means that class is
  // effectively invisible to admissions until the ERP data is fixed.
  const valid = classes.filter((c) => typeof c.capacity === "number");
  const skipped = classes.length - valid.length;
  if (skipped > 0) {
    console.error(
      `[erp] skipping ${skipped} class(es) with no numeric capacity:`,
      classes.filter((c) => typeof c.capacity !== "number").map((c) => c.class_name),
    );
  }

  const rows = valid.map((c) => ({
    class_name: c.class_name,
    base: c.base,
    division: c.division,
    batch: c.batch,
    is_kg: c.is_kg,
    capacity: c.capacity,
    enrolled: c.enrolled,
    admitted_since_sync: 0,
    synced_at: new Date().toISOString(),
  }));

  const { error: upsertErr } = await admin.from("erp_classes").upsert(rows, { onConflict: "class_name" });
  if (upsertErr) {
    console.error("[erp] capacity upsert failed", upsertErr);
    return null;
  }

  // Drop cached classes the ERP no longer reports.
  const currentNames = new Set(classes.map((c) => c.class_name));
  const { data: existing } = await admin.from("erp_classes").select("class_name");
  const stale = (existing ?? []).map((r) => r.class_name as string).filter((n) => !currentNames.has(n));
  if (stale.length > 0) {
    await admin.from("erp_classes").delete().in("class_name", stale);
  }

  return classes.length;
}

// ---------------------------------------------------------------------------
// Push this app's own class/division/batch definition into the ERP on
// section create/edit — a discrete, user-triggered call each time (never on
// a timer), per the ERP's own instruction. external_class_id is this app's
// own permanent id (sections.id) so repeat calls for the same section update
// rather than duplicate. Never throws.
// ---------------------------------------------------------------------------
export interface ErpClassPushPayload {
  external_class_id: string;
  class_name: string;
  division?: string | null;
  batch?: string | null;
  capacity?: number | null;
  curriculum?: string | null;
}

export type SyncClassToErpResult =
  | { ok: true; action: string; raw: unknown }
  | { ok: false; conflict: true; raw: unknown }
  | { ok: false; conflict: false; error: string };

export async function syncClassToErp(payload: ErpClassPushPayload): Promise<SyncClassToErpResult> {
  if (!config.erp.classWebhookEnabled) {
    return { ok: false, conflict: false, error: "ERP class webhook not configured" };
  }
  try {
    const res = await fetch(CLASS_WEBHOOK_URL, {
      method: "POST",
      headers: { ...classAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // fall through with json = null; raw text still reported in the error
    }

    if (res.status === 409) {
      return { ok: false, conflict: true, raw: json ?? text };
    }
    if (!res.ok) {
      return { ok: false, conflict: false, error: `ERP class webhook failed (${res.status}): ${text}` };
    }

    const action = (json as { action?: string } | null)?.action ?? "unknown";
    return { ok: true, action, raw: json };
  } catch (err) {
    return { ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Deactivate this app's own section in the ERP on section delete. Same
// external_class_id/secret as the create/update push above — the ERP side
// deactivates (is_active = false) rather than hard-deletes, since real
// classes are referenced by timetable/journal/ledger rows on their side.
// 404 means the ERP never had this external_class_id linked (nothing to
// deactivate); "unchanged" means it was already deactivated — both are
// treated as success so a delete never gets stuck on ERP state that's
// already correct. Never throws.
// ---------------------------------------------------------------------------
export type DeactivateClassResult =
  | { ok: true; action: "deactivated" | "unchanged" | "not_found" | "skipped"; raw?: unknown }
  | { ok: false; error: string };

export async function deactivateClassInErp(externalClassId: string): Promise<DeactivateClassResult> {
  if (!config.erp.classWebhookEnabled) return { ok: true, action: "skipped" };
  try {
    const res = await fetch(CLASS_DEACTIVATE_URL, {
      method: "POST",
      headers: { ...classAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ external_class_id: externalClassId }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // fall through with json = null; raw text still reported in the error
    }

    if (res.status === 404) {
      return { ok: true, action: "not_found", raw: json ?? text };
    }
    if (!res.ok) {
      return { ok: false, error: `ERP class deactivate failed (${res.status}): ${text}` };
    }

    const action = (json as { action?: string; success?: boolean } | null)?.action;
    if (action === "deactivated" || action === "unchanged") {
      return { ok: true, action, raw: json };
    }
    return { ok: false, error: `ERP class deactivate returned unexpected body: ${text}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Deactivate a student in the ERP — called before permanently deleting an
// applicant locally. Uses the same shared secret as capacity/webhook (not
// classWebhookSecret) per the ERP team. Deactivating frees the student's
// seat automatically on the ERP side (admissions-class-capacity and
// admissions-class-students both filter to active students only) — nothing
// extra needed here for that. "not_found" (a 404 — id unknown, or already
// removed) and "unchanged" (already deactivated) both count as success, same
// contract as deactivateClassInErp. Never throws.
// ---------------------------------------------------------------------------
export type DeactivateStudentResult =
  | { ok: true; action: "deactivated" | "unchanged" | "not_found" | "skipped"; raw?: unknown }
  | { ok: false; error: string };

export async function deactivateErpStudent(erpStudentId: string): Promise<DeactivateStudentResult> {
  if (!config.erp.enabled) return { ok: true, action: "skipped" };
  try {
    const res = await fetch(STUDENT_DEACTIVATE_URL, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ student_id: erpStudentId }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // fall through with json = null; raw text still reported in the error
    }

    if (res.status === 404) {
      return { ok: true, action: "not_found", raw: json ?? text };
    }
    if (!res.ok) {
      return { ok: false, error: `ERP student deactivate failed (${res.status}): ${text}` };
    }

    const action = (json as { action?: string; success?: boolean } | null)?.action;
    if (action === "deactivated" || action === "unchanged") {
      return { ok: true, action, raw: json };
    }
    return { ok: false, error: `ERP student deactivate returned unexpected body: ${text}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Move one or more students to a different ERP class — one endpoint covers
// both a single transfer and bulk promotion (many students into one
// class_name at once). class_name must already exist and be active in the
// ERP (push a new one via syncClassToErp first if it doesn't). A bad id
// inside a bulk call is reported back in missingStudentIds rather than
// failing the whole batch, so one stale record can't block a promotion.
// Same shared secret as capacity/webhook. Never throws.
//
// Note: erpStudentIds must be the ERP's internal id (the same one
// erp_student_id stores) — the human-readable admission number that
// admissions-class-students shows is a different id space and won't work
// here, which is why this only covers students this app has synced itself.
// ---------------------------------------------------------------------------
export type TransferErpStudentsResult =
  | { ok: true; classId: string; transferredCount: number; missingStudentIds: string[] }
  | { ok: false; error: string };

export async function transferErpStudents(
  erpStudentIds: string[],
  className: string,
): Promise<TransferErpStudentsResult> {
  if (!config.erp.enabled) return { ok: false, error: "ERP integration not configured" };
  if (erpStudentIds.length === 0) return { ok: false, error: "No students selected" };
  try {
    const body =
      erpStudentIds.length === 1
        ? { student_id: erpStudentIds[0], class_name: className }
        : { student_ids: erpStudentIds, class_name: className };
    const res = await fetch(STUDENT_TRANSFER_URL, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `ERP transfer failed (${res.status}): ${text}` };
    }
    const json = JSON.parse(text) as {
      success: boolean;
      class_id: string;
      transferred_count: number;
      missing_student_ids?: string[];
    };
    if (!json.success) {
      return { ok: false, error: `ERP transfer returned success:false: ${text}` };
    }
    return {
      ok: true,
      classId: json.class_id,
      transferredCount: json.transferred_count,
      missingStudentIds: json.missing_student_ids ?? [],
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Refresh the local erp_students cache — every student in every class the
// capacity sync already knows about (erp_classes). Powers the admin search
// by student name/ID, since the ERP has no cross-class search endpoint of
// its own, only a per-class roster. Fetches classes in small concurrent
// batches rather than all 185+ at once or fully sequentially, to stay
// reasonable against the ERP's endpoint. One class's fetch failing doesn't
// fail the whole sync — it's just skipped and will retry on the next sync.
// Never throws; returns the number of students cached, or null if the class
// list is empty or every single fetch failed.
// ---------------------------------------------------------------------------
const STUDENT_SYNC_CONCURRENCY = 8;

interface CachedErpStudentRow {
  internal_id: string;
  student_id: string;
  full_name: string;
  class_name: string;
  admission_id: string | null;
  synced_at: string;
}

export async function syncErpStudents(): Promise<number | null> {
  const admin = createSupabaseAdminClient();
  const { data: classRows } = await admin.from("erp_classes").select("class_name");
  const classNames = (classRows ?? []).map((r) => r.class_name as string);
  if (classNames.length === 0) return null;

  const rows: CachedErpStudentRow[] = [];
  let anySucceeded = false;
  const syncedAt = new Date().toISOString();

  for (let i = 0; i < classNames.length; i += STUDENT_SYNC_CONCURRENCY) {
    const batch = classNames.slice(i, i + STUDENT_SYNC_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (className) => ({ className, students: await fetchErpClassStudents(className) })),
    );
    for (const { className, students } of results) {
      if (students === null) continue;
      anySucceeded = true;
      for (const s of students) {
        rows.push({
          internal_id: s.internal_id,
          student_id: s.student_id,
          full_name: s.full_name,
          class_name: className,
          admission_id: s.admission_id,
          synced_at: syncedAt,
        });
      }
    }
  }

  if (!anySucceeded) return null;

  if (rows.length > 0) {
    const { error: upsertErr } = await admin.from("erp_students").upsert(rows, { onConflict: "internal_id" });
    if (upsertErr) {
      console.error("[erp] students upsert failed", upsertErr);
      return null;
    }
  }

  // Drop cached students no longer present in any successfully-synced class
  // (transferred out, deactivated, or the class itself is gone).
  const currentIds = new Set(rows.map((r) => r.internal_id));
  const { data: existing } = await admin.from("erp_students").select("internal_id");
  const stale = (existing ?? []).map((r) => r.internal_id as string).filter((id) => !currentIds.has(id));
  if (stale.length > 0) {
    await admin.from("erp_students").delete().in("internal_id", stale);
  }

  return rows.length;
}
