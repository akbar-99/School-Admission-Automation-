-- Free-text internal note for the marketing team on a lead — never shown to
-- the parent anywhere, visible only on /marketing and in the marketing/admin
-- leads export. Plain nullable column; no RLS change needed, same policy as
-- every other applications column already governs it.
alter table applications
  add column if not exists marketing_remarks text;
