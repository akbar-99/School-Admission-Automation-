-- ============================================================================
-- Seed: configuration, class sections, private document storage bucket.
-- ============================================================================

insert into app_config (key, value, description) values
  ('admission_year',          '2026',    'Academic year for admission numbers'),
  ('age_cutoff_mmdd',         '06-01',   'Age is computed as of this MM-DD of admission year (SRS FR-7)'),
  ('kg_min_age',              '3',       'Minimum age (years) for KG'),
  ('kg_max_age',              '5',       'Maximum age (years) for KG'),
  ('grade_min_age',           '6',       'Minimum age (years) for Grade'),
  ('default_section_capacity','30',      'Default per-section seat capacity'),
  ('admission_fee_paise',     '5000000', 'Admission fee charged via Razorpay, in paise (50,000 INR)'),
  ('data_retention_days',     '2555',    'DPDP retention period in days (~7 years)')
on conflict (key) do nothing;

-- Class sections: KG + Grades 1..5, divisions A & B, capacity 30 (SRS FR-22)
insert into sections (grade, name, capacity)
select g.grade, d.name, 30
from (values ('KG'),('G1'),('G2'),('G3'),('G4'),('G5')) as g(grade)
cross join (values ('A'),('B')) as d(name)
on conflict (grade, name) do nothing;

-- Private bucket for uploaded admission documents (SRS FR-4a)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
