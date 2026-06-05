-- ============================================================================
-- Digital agreement acceptance: the parent e-signs the admission agreement
-- (typed name) before paying. Recorded for audit (who / when / from where).
-- ============================================================================

alter table applications
  add column if not exists agreement_accepted    boolean not null default false,
  add column if not exists agreement_accepted_at  timestamptz,
  add column if not exists agreement_signature    text,
  add column if not exists agreement_ip           text;
