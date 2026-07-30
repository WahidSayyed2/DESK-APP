-- =========================================================
-- MIGRATION: notification center (bell icon, seen/pending)
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- =========================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_role text not null check (recipient_role in ('director','ea')),
  text text not null,
  task_id uuid references tasks(id) on delete cascade,
  seen boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "notifications: read all when logged in" on notifications
  for select using (auth.role() = 'authenticated');
create policy "notifications: insert when logged in" on notifications
  for insert with check (auth.role() = 'authenticated');
create policy "notifications: update when logged in" on notifications
  for update using (auth.role() = 'authenticated');

alter publication supabase_realtime add table notifications;
