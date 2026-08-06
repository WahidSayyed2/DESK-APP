-- =========================================================
-- COMPREHENSIVE FIX: several tables were missing DELETE
-- permissions entirely (policy and/or base grant), causing
-- deletes to silently affect 0 rows with no error shown.
-- Run this once in Supabase Dashboard > SQL Editor.
-- =========================================================

-- tasks — individual task delete (EA/Director) + admin "Clear all"
drop policy if exists "tasks: delete when logged in" on tasks;
create policy "tasks: delete when logged in" on tasks
  for delete using (auth.role() = 'authenticated');
grant delete on tasks to authenticated;

-- notifications — the bell's ✕ remove button + admin "Clear all"
drop policy if exists "notifications: delete when logged in" on notifications;
create policy "notifications: delete when logged in" on notifications
  for delete using (auth.role() = 'authenticated');

-- attendance — admin "Clear all"
drop policy if exists "attendance: delete when logged in" on attendance;
create policy "attendance: delete when logged in" on attendance
  for delete using (auth.role() = 'authenticated');

-- chat_messages — admin "Clear all"
drop policy if exists "chat: delete when logged in" on chat_messages;
create policy "chat: delete when logged in" on chat_messages
  for delete using (auth.role() = 'authenticated');
grant delete on chat_messages to authenticated;

-- profiles — Super Admin "Remove access"
drop policy if exists "profiles: delete when logged in" on profiles;
create policy "profiles: delete when logged in" on profiles
  for delete using (auth.role() = 'authenticated');
grant delete on profiles to authenticated;
