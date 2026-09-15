-- Free-text detail for a lead source of "other" (e.g. "Newspaper ad",
-- "School fair") — lead_source itself stays constrained to the fixed set
-- (applications_lead_source_check) so marketing stats can still group
-- cleanly by source; this column is just the extra detail shown wherever
-- "Other" would otherwise be a dead end.
alter table applications add column if not exists lead_source_other text;
