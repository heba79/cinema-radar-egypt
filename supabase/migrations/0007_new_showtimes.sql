-- Per-showtime tracking for Scene/VOX listing alerts ("NEW SHOWTIMES ADDED").
create table if not exists listing_shows_alerted (
  movie_id uuid not null references movies(id) on delete cascade,
  branch_id uuid not null references cinema_branches(id) on delete cascade,
  show_date date not null,
  show_time text not null,
  created_at timestamptz not null default now(),
  primary key (movie_id, branch_id, show_date, show_time)
);
alter table listing_shows_alerted enable row level security;

-- Backfill: showtimes on days already announced count as announced (no re-alert after upgrade).
insert into listing_shows_alerted (movie_id, branch_id, show_date, show_time)
select distinct s.movie_id, s.branch_id, s.show_date, s.show_time
  from screenings s
  join listing_dates_alerted d on d.movie_id = s.movie_id and d.branch_id = s.branch_id and d.show_date = s.show_date
on conflict do nothing;
