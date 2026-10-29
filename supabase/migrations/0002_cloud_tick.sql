-- Free hosting mode: Supabase pg_cron calls the website's /api/cron/tick every
-- minute. This lock guarantees only one tick runs at a time.
create table if not exists runner_locks (
  name text primary key,
  holder text,
  locked_until timestamptz not null default now()
);
alter table runner_locks enable row level security;

-- Needed to schedule the tick (enabled from the app by scripts/schedule-cron.ts).
create extension if not exists pg_net;
create extension if not exists pg_cron;
