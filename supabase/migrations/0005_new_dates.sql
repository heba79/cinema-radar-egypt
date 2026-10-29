-- Per-day tracking for Scene/VOX listing alerts: alert on the first listing AND
-- whenever new dates are added at a branch for a watched movie.
create table if not exists listing_dates_alerted (
  movie_id uuid not null references movies(id) on delete cascade,
  branch_id uuid not null references cinema_branches(id) on delete cascade,
  show_date date not null,
  event_id uuid not null references notification_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (movie_id, branch_id, show_date)
);
alter table listing_dates_alerted enable row level security;
