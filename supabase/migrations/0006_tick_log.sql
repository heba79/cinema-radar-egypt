-- Per-run resource log for the free-tier health dashboard (duration and CPU of each
-- serverless tick → projections against Vercel Hobby's monthly allowances).
create table if not exists tick_log (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  duration_ms integer not null,
  cpu_ms integer not null,
  jobs integer not null default 0,
  skipped boolean not null default false
);
create index if not exists tick_log_started_idx on tick_log(started_at desc);
alter table tick_log enable row level security;
