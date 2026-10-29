-- "Showtimes are out" alerts for chains (Scene, VOX) whose showtimes come from
-- elCinema listings but whose booking links can't be verified from the cloud.
alter table notification_events drop constraint if exists notification_events_event_type_check;
alter table notification_events add constraint notification_events_event_type_check
  check (event_type in ('advance_booking_opened', 'booking_opened', 'new_branch', 'showtimes_listed'));

alter table notification_preferences add column if not exists notify_showtimes_listed boolean not null default true;

-- branches already announced as "showtimes listed" for a movie (never re-announced)
create table if not exists listing_alerted (
  movie_id uuid not null references movies(id) on delete cascade,
  branch_id uuid not null references cinema_branches(id) on delete cascade,
  event_id uuid not null references notification_events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (movie_id, branch_id)
);
alter table listing_alerted enable row level security;
