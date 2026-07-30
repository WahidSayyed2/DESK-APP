-- =========================================================
-- THE DESK — Supabase schema
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- profiles (maps auth users to a role) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('director','ea')),
  name text not null default ''
);

-- ---------- tasks ----------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text default '',
  category text not null default 'Tasks' check (category in ('Tasks','Operations','Development','Cost Improvement')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  due_date date,
  status text not null default 'new' check (status in ('new','progress','done')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- task updates (the EA's running commentary) ----------
create table if not exists task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  by_role text not null check (by_role in ('director','ea')),
  text text not null,
  created_at timestamptz not null default now()
);

-- ---------- reminders (private per role) ----------
create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  owner_role text not null check (owner_role in ('director','ea')),
  text text not null,
  freq text not null check (freq in ('day','week','month')),
  created_at timestamptz not null default now()
);

-- ---------- chat between director and ea ----------
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  from_role text not null check (from_role in ('director','ea')),
  text text not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- Row Level Security
-- Both accounts are trusted internal users, so the rule is simply
-- "must be logged in" for shared data, and "must own this role" for reminders.
-- =========================================================

alter table profiles enable row level security;
alter table tasks enable row level security;
alter table task_updates enable row level security;
alter table reminders enable row level security;
alter table chat_messages enable row level security;

create policy "read own profile" on profiles
  for select using (auth.uid() = id);

create policy "tasks: read all when logged in" on tasks
  for select using (auth.role() = 'authenticated');
create policy "tasks: insert when logged in" on tasks
  for insert with check (auth.role() = 'authenticated');
create policy "tasks: update when logged in" on tasks
  for update using (auth.role() = 'authenticated');

create policy "task_updates: read all when logged in" on task_updates
  for select using (auth.role() = 'authenticated');
create policy "task_updates: insert when logged in" on task_updates
  for insert with check (auth.role() = 'authenticated');

create policy "chat: read all when logged in" on chat_messages
  for select using (auth.role() = 'authenticated');
create policy "chat: insert when logged in" on chat_messages
  for insert with check (auth.role() = 'authenticated');

create policy "reminders: read own" on reminders
  for select using (
    owner_role = (select role from profiles where id = auth.uid())
  );
create policy "reminders: insert own" on reminders
  for insert with check (
    owner_role = (select role from profiles where id = auth.uid())
  );
create policy "reminders: delete own" on reminders
  for delete using (
    owner_role = (select role from profiles where id = auth.uid())
  );

-- =========================================================
-- Realtime — so both desks see changes instantly, no polling
-- =========================================================
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table task_updates;
alter publication supabase_realtime add table chat_messages;

-- =========================================================
-- After running this file:
-- 1. Go to Authentication > Users > Add user, create the Director account
--    (email + password), then again for the EA account.
-- 2. Copy each user's UID (shown in the Users table).
-- 3. Run this, filling in the real UIDs:
--
--    insert into profiles (id, role, name) values
--      ('director-user-uid-here', 'director', 'Director Name'),
--      ('ea-user-uid-here', 'ea', 'EA Name');
-- =========================================================
