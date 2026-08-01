-- =========================================================
-- MIGRATION: expenses (EA uploads invoices/bills) + cost
-- comparisons (vendor price comparison / savings tracker)
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- =========================================================

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  uploaded_by text not null check (uploaded_by in ('director','ea')),
  description text,
  amount numeric not null,
  receipt_url text,
  receipt_name text,
  expense_date date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists cost_comparisons (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  quantity numeric not null default 1,
  existing_vendor text,
  existing_rate numeric not null,
  new_vendor text,
  new_rate numeric not null,
  created_by text not null check (created_by in ('director','ea')),
  created_at timestamptz not null default now()
);

alter table expenses enable row level security;
alter table cost_comparisons enable row level security;

create policy "expenses: read all when logged in" on expenses
  for select using (auth.role() = 'authenticated');
create policy "expenses: insert when logged in" on expenses
  for insert with check (auth.role() = 'authenticated');
create policy "expenses: delete when logged in" on expenses
  for delete using (auth.role() = 'authenticated');

create policy "cost_comparisons: read all when logged in" on cost_comparisons
  for select using (auth.role() = 'authenticated');
create policy "cost_comparisons: insert when logged in" on cost_comparisons
  for insert with check (auth.role() = 'authenticated');
create policy "cost_comparisons: delete when logged in" on cost_comparisons
  for delete using (auth.role() = 'authenticated');

grant select, insert, delete on expenses to authenticated;
grant select, insert, delete on cost_comparisons to authenticated;

alter publication supabase_realtime add table expenses;
alter publication supabase_realtime add table cost_comparisons;

-- receipts reuse the same 'attachments' storage bucket + policies
-- created in migration_attendance_wishlist.sql — no new bucket needed
-- as long as that migration has already been run.
