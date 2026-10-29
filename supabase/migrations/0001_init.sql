-- Cinema Radar Egypt — initial schema
-- Run with `supabase db push` or paste into the Supabase SQL editor.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type availability_status as enum (
    'upcoming',               -- not released in Egypt yet, no listing
    'released_not_listed',    -- released, but no Egyptian cinema listing found
    'listed_not_bookable',    -- listed at a cinema, no supported online booking action
    'advance_booking',        -- bookable, before the Egyptian release date
    'bookable_now',           -- bookable, released
    'no_longer_listed',       -- was listed/bookable before, now gone
    'provider_unavailable',   -- provider check failed; we do NOT know
    'unknown'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type integration_status as enum ('working', 'partial', 'unavailable', 'not_integrated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_channel as enum ('email', 'push', 'telegram');
exception when duplicate_object then null; end $$;

do $$ begin
  create type delivery_status as enum ('pending', 'sending', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  is_admin boolean not null default false,
  preferred_cities text[] not null default '{}',
  favorite_chains text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_enabled boolean not null default true,
  email_address text,
  push_enabled boolean not null default false,
  telegram_enabled boolean not null default false,
  telegram_chat_id text,
  telegram_link_code text unique,
  notify_advance_booking boolean not null default true,
  notify_booking_opened boolean not null default true,
  notify_new_branch boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  disabled_at timestamptz
);
create index if not exists push_subscriptions_user_idx on push_subscriptions(user_id) where disabled_at is null;

-- Create profile + default preferences for every new auth user.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email) values (new.id, new.email) on conflict do nothing;
  insert into notification_preferences (user_id, email_address) values (new.id, new.email) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Movies
-- ---------------------------------------------------------------------------
create table if not exists movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer not null unique,
  imdb_id text,
  title text not null,
  title_ar text,
  original_title text,
  original_language text,
  overview text,
  overview_ar text,
  poster_path text,
  backdrop_path text,
  release_date date,             -- TMDB primary release date
  eg_release_date date,          -- Egyptian release date (TMDB EG release or provider)
  genres text[] not null default '{}',
  runtime integer,
  trailer_youtube_key text,
  cast_members jsonb not null default '[]',
  popularity real,
  tmdb_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists movies_imdb_idx on movies(imdb_id);

create table if not exists movie_aliases (
  id bigserial primary key,
  movie_id uuid not null references movies(id) on delete cascade,
  alias text not null,
  normalized text not null,
  lang text,
  source text not null,
  unique (movie_id, normalized)
);
create index if not exists movie_aliases_trgm on movie_aliases using gin (normalized gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Providers, branches, catalog
-- ---------------------------------------------------------------------------
create table if not exists cinema_providers (
  id text primary key,                     -- e.g. 'elcinema'
  name text not null,
  website text,
  kind text not null,                      -- 'ticketing_platform' | 'chain' | 'independent'
  integration_status integration_status not null default 'not_integrated',
  poll_interval_seconds integer not null default 300,
  min_request_gap_ms integer not null default 3000,
  notes text,
  covered_by text references cinema_providers(id), -- e.g. zawya -> elcinema
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Every work the provider lists (now playing / coming soon / bookable), used for matching.
create table if not exists provider_catalog (
  provider_id text not null references cinema_providers(id),
  external_id text not null,
  title_en text,
  title_ar text,
  imdb_id text,
  year integer,
  eg_release_date date,
  poster_url text,
  in_now_playing boolean not null default false,
  in_coming_soon boolean not null default false,
  in_bookable boolean not null default false,
  details_fetched_at timestamptz,
  last_seen_at timestamptz not null default now(),
  primary key (provider_id, external_id)
);
create index if not exists provider_catalog_imdb_idx on provider_catalog(imdb_id);

create table if not exists provider_movie_links (
  provider_id text not null references cinema_providers(id),
  movie_id uuid not null references movies(id) on delete cascade,
  external_id text not null,
  external_url text not null,
  match_method text not null,              -- 'imdb' | 'title_year' | 'manual'
  confidence real not null,
  created_at timestamptz not null default now(),
  -- a movie can map to several provider entries (e.g. VOX lists "X" and "X (Infinity Vision)")
  primary key (provider_id, external_id)
);
create index if not exists provider_movie_links_movie_idx on provider_movie_links(provider_id, movie_id);

create table if not exists cinema_branches (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references cinema_providers(id),
  external_id text not null,
  name text not null,
  chain text,
  city text,
  area text,
  address text,
  phone text,
  external_url text,
  online_booking_via_provider boolean not null default false,
  details_fetched_at timestamptz,
  last_seen_at timestamptz not null default now(),
  unique (provider_id, external_id)
);
create index if not exists cinema_branches_city_idx on cinema_branches(city);
create index if not exists cinema_branches_chain_idx on cinema_branches(chain);

create table if not exists screenings (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references cinema_providers(id),
  movie_id uuid not null references movies(id) on delete cascade,
  branch_id uuid not null references cinema_branches(id) on delete cascade,
  show_date date not null,                 -- cinema "business day" (Cairo)
  show_time text not null,                 -- as printed, e.g. '12:15 AM'
  starts_at timestamptz not null,
  experience text not null default '',     -- IMAX / 4DX / VIP / Standard (when provided)
  price_egp numeric(10,2),
  is_bookable boolean not null,
  booking_url text,                        -- only ever a URL observed on the provider
  booking_url_verified_at timestamptz,
  booking_url_broken_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  active boolean not null default true,
  unique (provider_id, movie_id, branch_id, starts_at)
);
create index if not exists screenings_movie_idx on screenings(movie_id, active, show_date);
create index if not exists screenings_branch_idx on screenings(branch_id, active, show_date);

-- Current state per (movie, provider) and append-only observations.
create table if not exists movie_availability (
  movie_id uuid not null references movies(id) on delete cascade,
  provider_id text not null references cinema_providers(id),
  status availability_status not null default 'unknown',
  listed_branches integer not null default 0,
  bookable_branches integer not null default 0,
  earliest_bookable_date date,
  first_listed_at timestamptz,
  first_bookable_at timestamptz,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  primary key (movie_id, provider_id)
);

create table if not exists availability_observations (
  id bigserial primary key,
  movie_id uuid not null references movies(id) on delete cascade,
  provider_id text not null references cinema_providers(id),
  status availability_status not null,
  listed_branches integer not null default 0,
  bookable_branches integer not null default 0,
  observed_at timestamptz not null default now(),
  job_run_id bigint
);
create index if not exists availability_observations_movie_idx on availability_observations(movie_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- Watchlists & notifications
-- ---------------------------------------------------------------------------
create table if not exists watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  movie_id uuid not null references movies(id) on delete cascade,
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, movie_id)
);
create index if not exists watchlists_movie_idx on watchlists(movie_id) where not paused;

create table if not exists notification_events (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references movies(id) on delete cascade,
  provider_id text not null references cinema_providers(id),
  branch_id uuid references cinema_branches(id) on delete set null,
  event_type text not null check (event_type in ('advance_booking_opened', 'booking_opened', 'new_branch')),
  dedupe_key text not null unique,         -- guarantees one event per real-world change
  payload jsonb not null,
  detected_at timestamptz not null default now(),
  fanned_out_at timestamptz
);
create index if not exists notification_events_recent_idx on notification_events(detected_at desc);

-- Branches we've already alerted about per movie: a branch that stops and
-- restarts selling never triggers a second alert.
create table if not exists notified_branches (
  movie_id uuid not null references movies(id) on delete cascade,
  provider_id text not null references cinema_providers(id),
  branch_id uuid not null references cinema_branches(id) on delete cascade,
  event_id uuid not null references notification_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (movie_id, provider_id, branch_id)
);

create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel notification_channel not null,
  status delivery_status not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, user_id, channel)
);
create index if not exists notification_deliveries_due_idx on notification_deliveries(next_attempt_at) where status in ('pending', 'sending');
create index if not exists notification_deliveries_user_idx on notification_deliveries(user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Monitoring jobs
-- ---------------------------------------------------------------------------
create table if not exists monitor_jobs (
  id text primary key,                     -- 'elcinema:catalog', 'elcinema:movie:<uuid>', ...
  kind text not null,
  provider_id text references cinema_providers(id),
  movie_id uuid references movies(id) on delete cascade,
  priority integer not null default 0,
  interval_seconds integer not null,
  next_run_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  consecutive_failures integer not null default 0,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists monitor_jobs_due_idx on monitor_jobs(next_run_at) where enabled;

create table if not exists job_runs (
  id bigserial primary key,
  job_id text not null,
  worker_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  error text,
  stats jsonb not null default '{}'
);
create index if not exists job_runs_recent_idx on job_runs(started_at desc);
create index if not exists job_runs_job_idx on job_runs(job_id, started_at desc);

create table if not exists worker_heartbeats (
  worker_id text primary key,
  host text,
  version text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Atomically lease due jobs (safe with several worker replicas).
create or replace function claim_monitor_jobs(p_worker text, p_limit integer, p_lease_seconds integer)
returns setof monitor_jobs language sql as $$
  update monitor_jobs j
     set locked_by = p_worker,
         locked_until = now() + make_interval(secs => p_lease_seconds)
   where j.id in (
     select id from monitor_jobs
      where enabled and next_run_at <= now()
        and (locked_until is null or locked_until < now())
      order by priority desc, next_run_at
      limit p_limit
      for update skip locked)
  returning j.*;
$$;

create or replace function claim_deliveries(p_limit integer, p_lease_seconds integer)
returns setof notification_deliveries language sql as $$
  update notification_deliveries d
     set status = 'sending',
         locked_until = now() + make_interval(secs => p_lease_seconds),
         attempts = d.attempts + 1
   where d.id in (
     select id from notification_deliveries
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and locked_until < now())
      order by next_attempt_at
      limit p_limit
      for update skip locked)
  returning d.*;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- The web server and worker connect with a privileged role (DATABASE_URL) and
-- enforce ownership in code. RLS protects everything reachable with the public
-- anon key through the Supabase REST API.
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table notification_preferences enable row level security;
alter table push_subscriptions enable row level security;
alter table watchlists enable row level security;
alter table notification_deliveries enable row level security;
alter table notification_events enable row level security;
alter table movies enable row level security;
alter table movie_aliases enable row level security;
alter table cinema_providers enable row level security;
alter table provider_catalog enable row level security;
alter table provider_movie_links enable row level security;
alter table cinema_branches enable row level security;
alter table screenings enable row level security;
alter table movie_availability enable row level security;
alter table availability_observations enable row level security;
alter table notified_branches enable row level security;
alter table monitor_jobs enable row level security;
alter table job_runs enable row level security;
alter table worker_heartbeats enable row level security;

-- Own rows only
drop policy if exists "own profile" on profiles;
create policy "own profile" on profiles for select using (auth.uid() = id);
-- Profile updates go through the server (so is_admin can never be self-granted).

drop policy if exists "own prefs" on notification_preferences;
create policy "own prefs" on notification_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own push" on push_subscriptions;
create policy "own push" on push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own watchlist" on watchlists;
create policy "own watchlist" on watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own deliveries" on notification_deliveries;
create policy "own deliveries" on notification_deliveries for select using (auth.uid() = user_id);

-- Public, read-only catalog data
do $$
declare t text;
begin
  foreach t in array array['movies','movie_aliases','cinema_providers','cinema_branches','screenings',
                           'movie_availability','notification_events','provider_movie_links'] loop
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select using (true)', t);
  end loop;
end $$;
-- provider_catalog, availability_observations, monitor_jobs, job_runs, worker_heartbeats:
-- no policies => no anon/authenticated access at all (admin pages read them server-side).
