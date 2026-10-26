-- Hot/Warm/Cold lead scoring for the marketing team. A lead starts
-- unscored (all columns null) and a counselor scores/re-scores it any time
-- from a call, not just at creation — the six underlying answers almost
-- always aren't known yet when the lead is first created.
--
-- lead_score_answers holds the raw per-question answers (question id ->
-- answer id, see src/lib/lead-scoring.ts) so the scoring rubric can change
-- later without losing history on already-scored leads. lead_score_points
-- and lead_temperature are the computed result at the time of scoring
-- (denormalized for cheap filtering/sorting — recomputing from
-- lead_score_answers on every read isn't worth it for a value that only
-- changes when a counselor re-scores). lead_temperature_override lets a
-- counselor say "I know something the score doesn't" without discarding
-- the underlying answers.
alter table applications
  add column if not exists lead_score_answers jsonb,
  add column if not exists lead_score_points integer,
  add column if not exists lead_temperature text check (lead_temperature in ('HOT', 'WARM', 'COLD')),
  add column if not exists lead_temperature_override text check (lead_temperature_override in ('HOT', 'WARM', 'COLD')),
  add column if not exists lead_scored_by uuid references users(id) on delete set null,
  add column if not exists lead_scored_at timestamptz;
