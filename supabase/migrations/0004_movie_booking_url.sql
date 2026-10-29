-- Movie-level booking link (provider "tickets" action) for advance booking that is open
-- before dated showtimes appear on the provider's showtimes page.
alter table movie_availability add column if not exists booking_url text;
