-- =========================================================
-- CLEAR TASKS ONLY — irreversible, run only when you're sure.
-- Run this in Supabase Dashboard > SQL Editor.
--
-- This deletes every row in `tasks`. Because task_updates and
-- notifications both reference tasks with "on delete cascade",
-- their related rows are automatically removed too.
--
-- NOT touched: attendance, expenses, chat_messages, wishlist_items,
-- cost_tickets, cost_ticket_options, reminders, profiles.
-- =========================================================

delete from tasks;
