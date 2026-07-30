-- =========================================================
-- MIGRATION: attachments (chat/AI) + attendance (punch in/out) + shared wishlist
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- =========================================================

-- ---------- attachments (for chat + AI portal) ----------
alter table chat_messages add column if not exists attachment_url text;
alter table chat_messages add column if not exists attachment_name text;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

drop policy if exists "attachments: read public" on storage.objects;
create policy "attachments: read public" on storage.objects
  for select using (bucket_id = 'attachments');

drop policy if exists "attachments: upload when logged in" on storage.objects;
create policy "attachments: upload when logged in" on storage.objects
  for insert with check (bucket_id = 'attachments' and auth.role() = 'authenticated');

-- ---------- attendance (punch in / punch out) ----------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('director','ea')),
  punch_in timestamptz not null,
  punch_out timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- shared wishlist ----------
create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  added_by text not null check (added_by in ('director','ea')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table attendance enable row level security;
alter table wishlist_items enable row level security;

create policy "attendance: read all when logged in" on attendance
  for select using (auth.role() = 'authenticated');
create policy "attendance: insert when logged in" on attendance
  for insert with check (auth.role() = 'authenticated');
create policy "attendance: update when logged in" on attendance
  for update using (auth.role() = 'authenticated');

create policy "wishlist: read all when logged in" on wishlist_items
  for select using (auth.role() = 'authenticated');
create policy "wishlist: insert when logged in" on wishlist_items
  for insert with check (auth.role() = 'authenticated');
create policy "wishlist: update when logged in" on wishlist_items
  for update using (auth.role() = 'authenticated');
create policy "wishlist: delete when logged in" on wishlist_items
  for delete using (auth.role() = 'authenticated');

-- table-level grants — this step was missed on the notifications table last
-- time and caused "permission denied" errors, included up front here
grant select, insert, update, delete on attendance to authenticated;
grant select, insert, update, delete on wishlist_items to authenticated;

alter publication supabase_realtime add table attendance;
alter publication supabase_realtime add table wishlist_items;
