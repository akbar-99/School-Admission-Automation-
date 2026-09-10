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
const WEBHOOK_URL = "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-webhook";
const CLASS_WEBHOOK_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-class-webhook";
const CLASS_DEACTIVATE_URL =
  "https://lxnwnkgyjywoolnqsrjy.supabase.co/functions/v1/admissions-class-deactivate";

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
