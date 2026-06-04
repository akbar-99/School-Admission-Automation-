-- ============================================================================
-- Row-Level Security (SRS §2.1, §4.2). RLS is enabled on every table so the
-- anon/public key can read nothing by default. Privileged server operations
-- use the service-role key (bypasses RLS) after explicit role checks in code.
-- These policies provide defense-in-depth for any authenticated client reads.
-- ============================================================================

-- Role helpers (SECURITY DEFINER -> not subject to RLS, no recursion)
create or replace function public.app_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('marketing','teacher','admin','class_teacher')
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'admin');
$$;

-- Enable RLS everywhere
alter table app_config         enable row level security;
alter table users              enable row level security;
alter table parents            enable row level security;
alter table students           enable row level security;
alter table sections           enable row level security;
alter table applications       enable row level security;
alter table assessment_slots   enable row level security;
alter table assessment_results enable row level security;
alter table payments           enable row level security;
alter table admission_numbers  enable row level security;
alter table notifications      enable row level security;
alter table audit_logs         enable row level security;

-- users: see own row; admins see all
drop policy if exists users_self_read on users;
create policy users_self_read on users for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- app_config + sections: readable by any authenticated staff member
drop policy if exists config_staff_read on app_config;
create policy config_staff_read on app_config for select to authenticated
  using (public.is_staff());

drop policy if exists sections_staff_read on sections;
create policy sections_staff_read on sections for select to authenticated
  using (public.is_staff());

-- Operational tables: readable by authenticated staff (fine-grained scoping is
-- enforced server-side). No INSERT/UPDATE/DELETE policies => writes only via
-- the service-role key.
do $$
declare t text;
begin
  foreach t in array array['parents','students','applications','assessment_slots',
                           'assessment_results','payments','notifications',
                           'admission_numbers','audit_logs']
  loop
    execute format('drop policy if exists %I_staff_read on %I', t, t);
    execute format(
      'create policy %I_staff_read on %I for select to authenticated using (public.is_staff())',
      t, t);
  end loop;
end $$;
