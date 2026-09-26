-- Run after 0048_coo_role.sql has been applied. Extends the RLS role-helper
-- functions so "coo" is treated as admin-equivalent everywhere.
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and role in ('marketing','teacher','admin','class_teacher','coo')
  );
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role in ('admin','coo'));
$$;
