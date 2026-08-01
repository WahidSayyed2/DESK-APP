-- =========================================================
-- MIGRATION: multi-vendor cost comparison tickets
-- Replaces the simple "existing vs one new vendor" comparison
-- with a proper ticket: one existing vendor + several alternative
-- vendor quotes, then pick the final winner.
-- Run this once in Supabase Dashboard > SQL Editor > New query
-- =========================================================

create table if not exists cost_tickets (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  quantity numeric not null default 1,
  existing_vendor text,
  existing_rate numeric not null,
  selected_option_id uuid,
  created_by text not null check (created_by in ('director','ea')),
  created_at timestamptz not null default now()
);

create table if not exists cost_ticket_options (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references cost_tickets(id) on delete cascade,
  vendor_name text not null,
  rate numeric not null,
  created_at timestamptz not null default now()
);

alter table cost_tickets
  add constraint fk_selected_option foreign key (selected_option_id)
  references cost_ticket_options(id) on delete set null;

alter table cost_tickets enable row level security;
alter table cost_ticket_options enable row level security;

create policy "cost_tickets: read all when logged in" on cost_tickets
  for select using (auth.role() = 'authenticated');
create policy "cost_tickets: insert when logged in" on cost_tickets
  for insert with check (auth.role() = 'authenticated');
create policy "cost_tickets: update when logged in" on cost_tickets
  for update using (auth.role() = 'authenticated');
create policy "cost_tickets: delete when logged in" on cost_tickets
  for delete using (auth.role() = 'authenticated');

create policy "cost_ticket_options: read all when logged in" on cost_ticket_options
  for select using (auth.role() = 'authenticated');
create policy "cost_ticket_options: insert when logged in" on cost_ticket_options
  for insert with check (auth.role() = 'authenticated');
create policy "cost_ticket_options: delete when logged in" on cost_ticket_options
  for delete using (auth.role() = 'authenticated');

grant select, insert, update, delete on cost_tickets to authenticated;
grant select, insert, update, delete on cost_ticket_options to authenticated;

alter publication supabase_realtime add table cost_tickets;
alter publication supabase_realtime add table cost_ticket_options;

-- the old single-comparison table from migration_expenses.sql is no
-- longer used by the app and can be left in place or dropped:
-- drop table if exists cost_comparisons;
