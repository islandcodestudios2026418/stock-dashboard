-- Migration: Add tables from feature/weekly-ops-conviction-sectors
-- Run this in Supabase SQL editor if you already have the base schema
-- Safe to re-run (uses IF NOT EXISTS)

-- alert_rules: per-symbol custom notification thresholds
create table if not exists alert_rules (
  id bigint generated always as identity primary key,
  symbol text not null unique,
  min_score integer not null default 65,
  notify_on_rise boolean not null default true,
  cooldown_hours integer not null default 24,
  active boolean not null default true,
  updated_at timestamptz default now()
);

alter table alert_rules enable row level security;
do $$ begin
  create policy "anon_read_alerts" on alert_rules for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "service_all_alerts" on alert_rules for all to service_role using (true);
exception when duplicate_object then null;
end $$;

-- trade_decisions: Phase 1 semi-auto journal
create table if not exists trade_decisions (
  id bigint generated always as identity primary key,
  symbol text not null,
  date text not null,
  decision text not null, -- accepted/rejected/deferred
  reason text,
  avg_score numeric,
  conviction_score numeric,
  trade_plan jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_trade_decisions_symbol on trade_decisions(symbol, date desc);
create index if not exists idx_trade_decisions_date on trade_decisions(date desc);

alter table trade_decisions enable row level security;
do $$ begin
  create policy "anon_read_decisions" on trade_decisions for select to anon using (true);
exception when duplicate_object then null;
end $$;
do $$ begin
  create policy "service_all_decisions" on trade_decisions for all to service_role using (true);
exception when duplicate_object then null;
end $$;

-- Verify
select 'alert_rules' as table_name, count(*) as rows from alert_rules
union all
select 'trade_decisions', count(*) from trade_decisions;
