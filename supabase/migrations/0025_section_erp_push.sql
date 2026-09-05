-- ============================================================================
-- Push this app's own section (class/division/batch) definitions into the
-- ERP automatically on create/edit, via a new admissions-class-webhook the
-- ERP now exposes. `sections.id` (already a stable UUID, never reused) is
-- sent as external_class_id — no new identity column needed.
-- ============================================================================

alter table sections add column if not exists erp_sync_status text not null default 'pending'
  check (erp_sync_status in ('pending', 'synced', 'conflict', 'failed'));
alter table sections add column if not exists erp_synced_at timestamptz;
