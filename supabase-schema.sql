-- Supabase schema for stock-dashboard persistent storage
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor > New query)

-- 1. Analysis results (replaces .analysis-cache/)
create table if not exists analysis_results (
  id bigint generated always as identity primary key,
  symbol text not null,
  date text not null, -- YYYY-MM-DD
  scoring jsonb not null, -- { consensus, avgScore, agents[], recommendation }
  indicators jsonb,
  trade_plan jsonb,
  analysis text,
  ts bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique(symbol, date)
);

create index idx_analysis_date on analysis_results(date desc);
create index idx_analysis_symbol on analysis_results(symbol, date desc);

-- 2. Run summary (replaces _last_run.json)
create table if not exists analysis_runs (
  id bigint generated always as identity primary key,
  date text not null,
  ts bigint not null default (extract(epoch from now()) * 1000)::bigint,
  results jsonb not null, -- [{ symbol, status, consensus, avgScore }]
  unique(date)
);

-- 3. Watchlist (replaces WATCHLIST env var)
create table if not exists watchlists (
  id bigint generated always as identity primary key,
  symbol text not null unique,
  name text,
  added_at timestamptz default now(),
  active boolean default true
);

-- Seed default watchlist
insert into watchlists (symbol, name) values
  ('NASDAQ:TSLA', 'Tesla'),
  ('NASDAQ:NVDA', 'NVIDIA'),
  ('NASDAQ:AAPL', 'Apple'),
  ('TWSE:2330', '台積電'),
  ('TWSE:2454', '聯發科')
on conflict (symbol) do nothing;

-- Enable RLS (Row Level Security) - allow service role full access
alter table analysis_results enable row level security;
alter table analysis_runs enable row level security;
alter table watchlists enable row level security;

-- Policies: service role bypasses RLS; anon can read
create policy "anon_read_results" on analysis_results for select to anon using (true);
create policy "anon_read_runs" on analysis_runs for select to anon using (true);
create policy "anon_read_watchlists" on watchlists for select to anon using (true);
create policy "service_all_results" on analysis_results for all to service_role using (true);
create policy "service_all_runs" on analysis_runs for all to service_role using (true);
create policy "service_all_watchlists" on watchlists for all to service_role using (true);


-- 4. Backtest results (walk-forward simulation output)
create table if not exists backtest_results (
  id bigint generated always as identity primary key,
  symbol text not null,
  run_date text not null, -- date the backtest was run
  config jsonb not null,
  picks jsonb not null,
  summary jsonb not null,
  unique(symbol, run_date)
);

create index idx_backtest_symbol on backtest_results(symbol, run_date desc);

alter table backtest_results enable row level security;
create policy "anon_read_backtest" on backtest_results for select to anon using (true);
create policy "service_all_backtest" on backtest_results for all to service_role using (true);



-- 5. Portfolio positions (track entries, exits, P&L)
create table if not exists portfolio_positions (
  id bigint generated always as identity primary key,
  symbol text not null,
  side text not null default 'long', -- long/short
  entry_date text not null,
  entry_price numeric not null,
  shares numeric not null,
  stop_loss numeric,
  target numeric,
  exit_date text,
  exit_price numeric,
  status text not null default 'open', -- open/closed/stopped
  notes text,
  created_at timestamptz default now()
);

create index idx_portfolio_status on portfolio_positions(status, symbol);

alter table portfolio_positions enable row level security;
create policy "anon_read_portfolio" on portfolio_positions for select to anon using (true);
create policy "service_all_portfolio" on portfolio_positions for all to service_role using (true);



-- 6. Migration: add peak_price and closed_at for position monitor (2026-06-24)
alter table portfolio_positions add column if not exists peak_price numeric;
alter table portfolio_positions add column if not exists closed_at timestamptz;



-- 7. Alert rules: per-symbol custom notification thresholds (2026-06-24)
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
create policy "anon_read_alerts" on alert_rules for select to anon using (true);
create policy "service_all_alerts" on alert_rules for all to service_role using (true);


-- 8. Trade decisions: Phase 1 semi-auto journal (2026-06-24)
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

create index idx_trade_decisions_symbol on trade_decisions(symbol, date desc);
create index idx_trade_decisions_date on trade_decisions(date desc);

alter table trade_decisions enable row level security;
create policy "anon_read_decisions" on trade_decisions for select to anon using (true);
create policy "service_all_decisions" on trade_decisions for all to service_role using (true);
