-- =========================================================
-- MIGRATION: super admin role
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- =========================================================

-- allow 'admin' as a third role alongside director/ea
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('director','ea','admin'));

-- admin needs to see every profile, not just their own
drop policy if exists "admin reads all profiles" on profiles;
create policy "admin reads all profiles" on profiles
  for select using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- =========================================================
-- After running this file, create the admin's login the same
-- way you created director/ea:
-- 1. Authentication > Users > Add user (email + password)
-- 2. Copy their UID
-- 3. Run, filling in the real UID and name:
--
--    insert into profiles (id, role, name) values
--      ('admin-user-uid-here', 'admin', 'Admin Name');
-- =========================================================
