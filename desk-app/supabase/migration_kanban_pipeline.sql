-- =========================================================
-- MIGRATION: kanban pipeline stages + per-task reminders
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- Safe to run on your existing live database — it migrates
-- your current tasks into the new stages, nothing is deleted.
-- =========================================================

-- 1. Add a reminder timestamp directly on each task
alter table tasks add column if not exists reminder_at timestamptz;

-- 2. Migrate old 3-stage statuses into the new 6-stage pipeline
--    (captured, progress, followup, update, closure, completed)
alter table tasks drop constraint if exists tasks_status_check;
update tasks set status = 'captured' where status = 'new';
update tasks set status = 'completed' where status = 'done';
-- 'progress' already matches the new pipeline, no change needed

alter table tasks
  add constraint tasks_status_check
  check (status in ('captured','progress','followup','update','closure','completed'));

alter table tasks alter column status set default 'captured';
