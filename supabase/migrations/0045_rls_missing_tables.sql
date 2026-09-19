-- 0040/0041 added these two tables without enabling RLS, so PostgREST
-- exposes them to the anon/authenticated roles by default (Supabase's
-- standard default grants) even though the app only ever touches them via
-- the service-role client. study_material_fees feeds directly into a
-- Razorpay order amount, so a writable anon endpoint here is a real
-- payment-tampering vector, not just a lint nitpick. No policies are added
-- for either table — every real usage goes through the service role, which
-- bypasses RLS entirely, so enabling it with zero policies simply denies
-- anon/authenticated access without touching any legitimate app behavior.
alter table study_material_fees enable row level security;
alter table broadway_admission_sequence enable row level security;
