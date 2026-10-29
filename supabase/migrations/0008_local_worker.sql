-- Laptop worker status (per-provider access state, last run summary) for the admin dashboard.
alter table worker_heartbeats add column if not exists details jsonb;
