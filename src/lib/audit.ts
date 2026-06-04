import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

// Best-effort audit log (SRS §5). Never throws — accountability must not break
// the primary operation.
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    await admin.from("audit_logs").insert({
      actor_id: entry.actorId ?? null,
      actor_role: entry.actorRole ?? null,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      details: entry.details ?? {},
    });
  } catch (err) {
    console.error("[audit] failed to record entry", entry.action, err);
  }
}
