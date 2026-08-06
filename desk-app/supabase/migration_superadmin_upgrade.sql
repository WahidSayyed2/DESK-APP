-- =========================================================
-- MIGRATION: super admin upgrade
--   1. Personal reminders get a specific date/time (remind_at)
--   2. Guarantees every DELETE policy + grant exists, so the
--      Admin Console "Clear all" and "Remove access" can never
--      silently fail again.
-- Run this once in Supabase Dashboard > SQL Editor > New query.
-- Safe to run more than once.
-- =========================================================

-- ---------- 1. reminders: add a scheduled time ----------
alter table reminders add column if not exists remind_at timestamptz;

-- push reminder changes over realtime too (ignore if already added)
do $$
begin
  alter publication supabase_realtime add table reminders;
exception when duplicate_object then null;
end $$;

-- ---------- 2. make destructive actions reliable ----------
-- These are the same fixes used by the Admin Console. The console now
-- also runs privileged actions through a server-side service-role API
-- (/api/admin/action) which bypasses RLS entirely, but keeping these in
-- place means normal client-side deletes work correctly as well.

-- tasks (cascades to task_updates + notifications)
drop policy if exists "tasks: delete when logged in" on tasks;
create policy "tasks: delete when logged in" on tasks
  for delete using (auth.role() = 'authenticated');
grant delete on tasks to authenticated;

-- task_updates
drop policy if exists "task_updates: delete when logged in" on task_updates;
create policy "task_updates: delete when logged in" on task_updates
  for delete using (auth.role() = 'authenticated');
grant delete on task_updates to authenticated;

-- chat_messages
drop policy if exists "chat: delete when logged in" on chat_messages;
create policy "chat: delete when logged in" on chat_messages
  for delete using (auth.role() = 'authenticated');
grant delete on chat_messages to authenticated;

-- attendance
drop policy if exists "attendance: delete when logged in" on attendance;
create policy "attendance: delete when logged in" on attendance
  for delete using (auth.role() = 'authenticated');
grant select, insert, update, delete on attendance to authenticated;

-- notifications
drop policy if exists "notifications: delete when logged in" on notifications;
create policy "notifications: delete when logged in" on notifications
  for delete using (auth.role() = 'authenticated');
grant select, insert, update, delete on notifications to authenticated;

-- expenses
drop policy if exists "expenses: delete when logged in" on expenses;
create policy "expenses: delete when logged in" on expenses
  for delete using (auth.role() = 'authenticated');
grant delete on expenses to authenticated;

-- cost_tickets (cascades to cost_ticket_options)
drop policy if exists "cost_tickets: delete when logged in" on cost_tickets;
create policy "cost_tickets: delete when logged in" on cost_tickets
  for delete using (auth.role() = 'authenticated');
grant delete on cost_tickets to authenticated;

-- cost_ticket_options
drop policy if exists "cost_ticket_options: delete when logged in" on cost_ticket_options;
create policy "cost_ticket_options: delete when logged in" on cost_ticket_options
  for delete using (auth.role() = 'authenticated');
grant delete on cost_ticket_options to authenticated;

-- wishlist_items
drop policy if exists "wishlist: delete when logged in" on wishlist_items;
create policy "wishlist: delete when logged in" on wishlist_items
  for delete using (auth.role() = 'authenticated');
grant delete on wishlist_items to authenticated;

-- reminders (own already exists; keep it)
drop policy if exists "reminders: delete own" on reminders;
create policy "reminders: delete own" on reminders
  for delete using (
    owner_role = (select role from profiles where id = auth.uid())
  );
grant select, insert, update, delete on reminders to authenticated;

-- profiles — Super Admin "Remove access"
drop policy if exists "profiles: delete when logged in" on profiles;
create policy "profiles: delete when logged in" on profiles
  for delete using (auth.role() = 'authenticated');
grant delete on profiles to authenticated;

-- =========================================================
-- Reminder: the Admin Console's full power (clearing tables,
-- fully deleting a user's login, editing attendance) depends on
-- SUPABASE_SERVICE_ROLE_KEY being set in your Vercel project's
-- Environment Variables. It is server-side only and never exposed
-- to the browser.
-- =========================================================
