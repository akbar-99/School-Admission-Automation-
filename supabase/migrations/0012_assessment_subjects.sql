-- ============================================================================
-- Per-subject assessment scoring. Each assessment result can hold a list of
-- subjects, each with a score, a comment, and an optional uploaded file
-- (PDF / Excel). Stored as JSONB:
--   [{ "subject": "Maths", "score": 85, "comment": "…",
--      "file": { "category": "Maths", "type": "application/pdf",
--                "path": "assessments/<app>/…", "name": "maths.pdf", "size": 1234 } }]
-- ============================================================================

alter table assessment_results
  add column if not exists subjects jsonb not null default '[]'::jsonb;
