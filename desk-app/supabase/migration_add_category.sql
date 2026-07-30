-- =========================================================
-- MIGRATION: add task categories + a "critical" priority tier
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- Safe to run on your existing live database — it will not
-- delete or reset any current tasks.
-- =========================================================

-- 1. Add the category column (existing tasks default to 'Tasks')
alter table tasks
  add column if not exists category text not null default 'Tasks'
  check (category in ('Tasks','Operations','Development','Cost Improvement'));

-- 2. Widen the priority check to allow 'critical'
alter table tasks drop constraint if exists tasks_priority_check;
alter table tasks
  add constraint tasks_priority_check
  check (priority in ('low','medium','high','critical'));
