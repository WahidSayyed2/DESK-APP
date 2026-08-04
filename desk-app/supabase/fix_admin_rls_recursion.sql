-- =========================================================
-- FIX: recursive RLS policy broke login for every account
-- Run this in Supabase Dashboard > SQL Editor
--
-- The previous "admin reads all profiles" policy queried the
-- profiles table from within its own policy, which Postgres
-- can't safely evaluate — it broke profile lookups for
-- director, ea, AND admin alike. This replaces it with a
-- SECURITY DEFINER function, the safe standard pattern for
-- this exact situation.
-- =========================================================

drop policy if exists "admin reads all profiles" on profiles;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "admin reads all profiles" on profiles
  for select using (is_admin());
