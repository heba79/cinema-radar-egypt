import "server-only";
import { q, q1 } from "./db";
import type { AvailabilityStatus } from "./providers/types";
import { cairoToday } from "./time";

export interface AvailabilityRow {
  provider_id: string;
  provider_name: string;
  integration_status: string;
  status: AvailabilityStatus;
  listed_branches: number;
  bookable_branches: number;
  earliest_bookable_date: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  external_url: string | null;
  booking_url: string | null;
}

export async function movieAvailability(movieId: string) {
  return q<AvailabilityRow>(
    `select p.id as provider_id, p.name as provider_name, p.integration_status, coalesce(a.status, 'unknown') as status,
            coalesce(a.listed_branches, 0) as listed_branches, coalesce(a.bookable_branches, 0) as bookable_branches,
            a.earliest_bookable_date::text, a.last_checked_at, a.last_success_at, a.last_error, l.external_url,
            case when a.status in ('advance_booking', 'bookable_now') then a.booking_url end as booking_url
       from cinema_providers p
       left join movie_availability a on a.provider_id = p.id and a.movie_id = $1
       left join lateral (select external_url from provider_movie_links where provider_id = p.id and movie_id = $1 limit 1) l on true
      where p.integration_status in ('working', 'partial') and p.covered_by is null
      order by p.name`,
    [movieId],
  );
}

export interface BranchShowtimes {
  branch_id: string;
  name: string;
  chain: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  bookable: boolean;
  booking_url: string | null;
  verified_at: string | null;
  last_seen_at: string;
  days: { date: string; shows: { time: string; experience: string; price: number | null; bookable: boolean }[] }[];
}

/** Current showtimes grouped by branch → day. Booking URLs come only from stored provider observations. */
export async function movieShowtimes(movieId: string): Promise<BranchShowtimes[]> {
  const rows = await q<{
    branch_id: string;
    name: string;
    chain: string | null;
    city: string | null;
    area: string | null;
    address: string | null;
    show_date: string;
    show_time: string;
    experience: string;
    price_egp: string | null;
    is_bookable: boolean;
    booking_url: string | null;
    booking_url_verified_at: string | null;
    booking_url_broken_at: string | null;
    last_seen_at: string;
  }>(
    `select b.id as branch_id, b.name, b.chain, b.city, b.area, b.address, s.show_date::text, s.show_time, s.experience,
            s.price_egp, s.is_bookable, s.booking_url, s.booking_url_verified_at, s.booking_url_broken_at, s.last_seen_at
       from screenings s join cinema_branches b on b.id = s.branch_id
      where s.movie_id = $1 and s.active and s.show_date >= $2
        -- a chain monitored directly supersedes elCinema's listing-only rows for that chain
        and not (s.provider_id = 'elcinema' and not s.is_bookable and exists (
              select 1 from screenings d join cinema_branches db on db.id = d.branch_id
               where d.movie_id = s.movie_id and d.active and d.provider_id <> 'elcinema' and db.chain = b.chain))
      order by s.is_bookable desc, b.name, s.starts_at`,
    [movieId, cairoToday()],
  );
  const map = new Map<string, BranchShowtimes>();
  for (const r of rows) {
    let b = map.get(r.branch_id);
    if (!b) {
      b = {
        branch_id: r.branch_id,
        name: r.name,
        chain: r.chain,
        city: r.city,
        area: r.area,
        address: r.address,
        bookable: false,
        booking_url: null,
        verified_at: null,
        last_seen_at: r.last_seen_at,
        days: [],
      };
      map.set(r.branch_id, b);
    }
    // A link flagged broken is never offered as a booking button.
    if (r.is_bookable && r.booking_url && !r.booking_url_broken_at) {
      b.bookable = true;
      b.booking_url ??= r.booking_url;
      b.verified_at ??= r.booking_url_verified_at;
    }
    let day = b.days.find((d) => d.date === r.show_date);
    if (!day) b.days.push((day = { date: r.show_date, shows: [] }));
    day.shows.push({ time: r.show_time, experience: r.experience, price: r.price_egp ? Number(r.price_egp) : null, bookable: r.is_bookable });
  }
  return [...map.values()].sort((a, b) => Number(b.bookable) - Number(a.bookable));
}

export async function recentOpenings(limit = 12) {
  return q<{
    id: string;
    event_type: string;
    detected_at: string;
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    branches: number;
    first_branch: string | null;
    booking_url: string | null;
  }>(
    `select e.id, e.event_type, e.detected_at, m.tmdb_id, m.title, m.poster_path,
            jsonb_array_length(e.payload->'branches') as branches, e.payload->'branches'->0->>'branch' as first_branch,
            e.payload->>'bookingUrl' as booking_url
       from notification_events e join movies m on m.id = e.movie_id
      where m.tmdb_id > 0 order by e.detected_at desc limit $1`,
    [limit],
  );
}

/** Movies elCinema lists as showing in Egypt (imported to TMDB) with their current availability. */
export async function nowShowingInEgypt(limit = 24) {
  return q<{ tmdb_id: number; title: string; poster_path: string | null; release_date: string | null; status: AvailabilityStatus | null; bookable_branches: number | null }>(
    `select distinct on (m.id) m.tmdb_id, m.title, m.poster_path, m.release_date::text, a.status, a.bookable_branches
       from provider_catalog c
       join provider_movie_links l on l.provider_id = c.provider_id and l.external_id = c.external_id
       join movies m on m.id = l.movie_id
       left join movie_availability a on a.movie_id = m.id and a.provider_id = c.provider_id
      where (c.in_now_playing or c.in_bookable) and m.tmdb_id > 0
      order by m.id, c.in_bookable desc
      limit $1`,
    [limit],
  );
}

export async function watchState(userId: string | undefined, movieId: string) {
  if (!userId) return null;
  return q1<{ id: string; paused: boolean }>("select id, paused from watchlists where user_id = $1 and movie_id = $2", [userId, movieId]);
}

export async function providerCoverage() {
  return q<{
    id: string;
    name: string;
    website: string | null;
    kind: string;
    integration_status: string;
    poll_interval_seconds: number;
    notes: string | null;
    covered_by: string | null;
    last_attempt_at: string | null;
    last_success_at: string | null;
    last_failure_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
    branches: number;
    bookable_branches: number;
  }>(
    `select p.*, (select count(*)::int from cinema_branches b where b.provider_id = coalesce(p.covered_by, p.id)
                    and (p.covered_by is null or b.chain ilike '%' || split_part(p.name, ' ', 1) || '%')) as branches,
            (select count(*)::int from cinema_branches b where b.provider_id = coalesce(p.covered_by, p.id) and b.online_booking_via_provider
                    and (p.covered_by is null or b.chain ilike '%' || split_part(p.name, ' ', 1) || '%')) as bookable_branches
       from cinema_providers p
      order by case p.integration_status when 'working' then 0 when 'partial' then 1 when 'unavailable' then 2 else 3 end,
               p.covered_by is not null, p.name`,
  );
}
