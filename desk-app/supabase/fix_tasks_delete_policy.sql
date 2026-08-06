-- =========================================================
-- FIX: task deletion silently does nothing
-- Run this in Supabase Dashboard > SQL Editor
--
-- The tasks table was missing a DELETE policy entirely. In
-- Postgres RLS, a delete with no matching policy doesn't
-- error — it just deletes 0 rows silently. That's exactly
-- why "Task deleted" showed up but the task stayed in the list.
-- =========================================================

drop policy if exists "tasks: delete when logged in" on tasks;
create policy "tasks: delete when logged in" on tasks
  for delete using (auth.role() = 'authenticated');
