// Core monitoring steps, shared by the worker and admin tools.
import type { PoolClient } from "pg";
import { BOOKABLE, computeStatus, detectEvents, matchMovie } from "../availability";
import { q, q1, tx } from "../db";
import { normalizeTitle } from "../normalize";
import { chainFromBranchName } from "../providers/elcinema/parse";
import { activeAdapters, PROVIDERS } from "../providers/registry";
import type { AvailabilityStatus, MovieListing, ProviderAdapter } from "../providers/types";
import { OFFICIAL_SITE_CHAINS, officialSiteFor } from "../providers/official";
import { baseTitle } from "../providers/vox/parse";
import { cairoToday } from "../time";
import { fanOutEvent } from "../notify/fanout";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[monitor]", ...a);

export async function seedProviders() {
  for (const p of PROVIDERS) {
    await q(
      `insert into cinema_providers (id, name, website, kind, integration_status, poll_interval_seconds, min_request_gap_ms, notes, covered_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,null)
       on conflict (id) do update set name = excluded.name, website = excluded.website, kind = excluded.kind,
         integration_status = excluded.integration_status, poll_interval_seconds = excluded.poll_interval_seconds,
         min_request_gap_ms = excluded.min_request_gap_ms, notes = excluded.notes, updated_at = now()`,
      [p.id, p.name, p.website, p.kind, p.integrationStatus, p.pollIntervalSeconds, p.minRequestGapMs, p.notes],
    );
  }
  for (const p of PROVIDERS.filter((x) => x.coveredBy)) {
    await q("update cinema_providers set covered_by = $2 where id = $1", [p.id, p.coveredBy]);
  }
}

export async function recordProviderResult(providerId: string, ok: boolean, error?: string) {
  if (ok) {
    await q(
      `update cinema_providers set last_attempt_at = now(), last_success_at = now(), consecutive_failures = 0, last_error = null where id = $1`,
      [providerId],
    );
  } else {
    await q(
      `update cinema_providers set last_attempt_at = now(), last_failure_at = now(), consecutive_failures = consecutive_failures + 1, last_error = $2 where id = $1`,
      [providerId, error?.slice(0, 500) ?? "unknown error"],
    );
  }
}

// --- catalog ------------------------------------------------------------------

export async function syncCatalog(adapter: ProviderAdapter, detailBudget = 15) {
  const entries = await adapter.fetchCatalog!();
  await q(`update provider_catalog set in_now_playing = false, in_coming_soon = false, in_bookable = false where provider_id = $1`, [adapter.id]);
  for (const e of entries) {
    const listDetails = !!adapter.catalogHasDetails;
    await q(
      `insert into provider_catalog (provider_id, external_id, title_en, poster_url, in_now_playing, in_coming_soon, in_bookable,
          eg_release_date, year, details_fetched_at, last_seen_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::date, extract(year from $8::date)::int, case when $9 then now() end, now())
       on conflict (provider_id, external_id) do update set title_en = coalesce(excluded.title_en, provider_catalog.title_en),
         poster_url = coalesce(excluded.poster_url, provider_catalog.poster_url), in_now_playing = excluded.in_now_playing,
         in_coming_soon = excluded.in_coming_soon, in_bookable = excluded.in_bookable,
         eg_release_date = coalesce(excluded.eg_release_date, provider_catalog.eg_release_date),
         year = coalesce(excluded.year, provider_catalog.year),
         details_fetched_at = coalesce(provider_catalog.details_fetched_at, excluded.details_fetched_at), last_seen_at = now()`,
      [adapter.id, e.externalId, e.titleEn ?? null, e.posterUrl ?? null, !!e.inNowPlaying, !!e.inComingSoon, !!e.inBookable, e.releaseDate ?? null, listDetails],
    );
  }
  const fetched = adapter.catalogHasDetails ? 0 : await fetchMissingDetails(adapter, detailBudget);
  return { entries: entries.length, detailsFetched: fetched };
}

export async function fetchMissingDetails(adapter: ProviderAdapter, budget: number, onlyIds?: string[]) {
  const rows = await q<{ external_id: string }>(
    `select external_id from provider_catalog
      where provider_id = $1 and details_fetched_at is null ${onlyIds ? "and external_id = any($3)" : ""}
      order by in_bookable desc, in_coming_soon desc, in_now_playing desc, last_seen_at desc limit $2`,
    onlyIds ? [adapter.id, budget, onlyIds] : [adapter.id, budget],
  );
  for (const r of rows) {
    const d = await adapter.fetchWorkDetails!(r.external_id);
    await q(
      `update provider_catalog set title_en = coalesce($3, title_en), title_ar = $4, imdb_id = $5, year = $6, eg_release_date = $7,
         details_fetched_at = now() where provider_id = $1 and external_id = $2`,
      [adapter.id, r.external_id, d.titleEn ?? null, d.titleAr ?? null, d.imdbId ?? null, d.year ?? null, d.egReleaseDate ?? null],
    );
  }
  return rows.length;
}

/** Pseudo-branch for movie-level online booking (cinema & time chosen on the provider's booking page). */
export const ONLINE_BRANCH = "online";

const EXTERNAL_URL: Record<string, (id: string) => string> = {
  elcinema: (id) => `https://elcinema.com/en/work/${id}/`,
  "vox-egypt": (id) => `https://egy.voxcinemas.com/movies/${id}`,
  scene: (id) => `https://cfc.scenecinemas.com/movie-details/${id}.html`,
};

/**
 * Link a movie to the provider's catalog entries (IMDb id first, then title+year).
 * Returns every linked external id — a provider may list format variants separately.
 */
export async function linkMovie(providerId: string, movieId: string): Promise<string[]> {
  const movie = await q1<{ imdb_id: string | null; release_date: string | null; eg_release_date: string | null }>(
    "select imdb_id, release_date::text, eg_release_date::text from movies where id = $1",
    [movieId],
  );
  if (!movie) return [];
  const aliases = await q<{ alias: string }>("select alias from movie_aliases where movie_id = $1", [movieId]);
  const candidates = await q<{ external_id: string; title_en: string | null; title_ar: string | null; imdb_id: string | null; year: number | null; in_now_playing: boolean }>(
    `select external_id, title_en, title_ar, imdb_id, year, in_now_playing from provider_catalog
      where provider_id = $1 and details_fetched_at is not null
        and external_id not in (select external_id from provider_movie_links where provider_id = $1)`,
    [providerId],
  );
  const year = Number((movie.eg_release_date ?? movie.release_date ?? "").slice(0, 4)) || null;
  const thisYear = Number(cairoToday().slice(0, 4));
  const cands = candidates.map((c) => ({
    externalId: c.external_id,
    titleEn: c.title_en ? baseTitle(c.title_en) : null,
    titleAr: c.title_ar,
    imdbId: c.imdb_id,
    // A title playing right now is a current release even when the list gives no date.
    year: c.year ?? (c.in_now_playing ? thisYear : null),
  }));

  // Format variants ("X" and "X (Infinity Vision)") share a base title, so they would look
  // "ambiguous" to the matcher: match against one representative per base title.
  const byBase = new Map<string, typeof cands>();
  for (const c of cands) {
    const k = `${normalizeTitle(c.titleEn ?? c.externalId)}|${c.imdbId ?? ""}`;
    byBase.set(k, [...(byBase.get(k) ?? []), c]);
  }
  const reps = [...byBase.values()].map((g) => g[0]);
  const match = matchMovie({ imdbId: movie.imdb_id, titles: aliases.map((a) => a.alias), year }, reps);
  if (match) {
    const group = [...byBase.values()].find((g) => g[0] === match.candidate)!;
    for (const v of group) {
      await q(
        `insert into provider_movie_links (provider_id, movie_id, external_id, external_url, match_method, confidence)
         values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
        [providerId, movieId, v.externalId, (EXTERNAL_URL[providerId] ?? ((x: string) => x))(v.externalId), match.method, match.confidence],
      );
      log(`linked movie ${movieId} -> ${providerId}:${v.externalId} (${match.method}, ${match.confidence})`);
    }
    const eg = await q1<{ eg_release_date: string | null }>(
      `select min(c.eg_release_date)::text as eg_release_date from provider_catalog c join provider_movie_links l
          on l.provider_id = c.provider_id and l.external_id = c.external_id where l.provider_id = $1 and l.movie_id = $2`,
      [providerId, movieId],
    );
    // Provider's Egyptian release date is more authoritative than TMDB's.
    if (eg?.eg_release_date) await q("update movies set eg_release_date = $2 where id = $1", [movieId, eg.eg_release_date]);
  }
  const links = await q<{ external_id: string }>("select external_id from provider_movie_links where provider_id = $1 and movie_id = $2", [providerId, movieId]);
  return links.map((l) => l.external_id);
}

// --- branches -----------------------------------------------------------------

async function upsertBranch(c: PoolClient, adapter: ProviderAdapter, b: { externalId: string; name: string; url: string }, bookable: boolean) {
  const loc = adapter.branchLocation?.(b.name);
  const row = await c.query<{ id: string }>(
    `insert into cinema_branches (provider_id, external_id, name, chain, city, area, external_url, online_booking_via_provider, last_seen_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8, now())
     on conflict (provider_id, external_id) do update set name = excluded.name, external_url = excluded.external_url,
       city = coalesce(cinema_branches.city, excluded.city), area = coalesce(cinema_branches.area, excluded.area),
       online_booking_via_provider = cinema_branches.online_booking_via_provider or excluded.online_booking_via_provider, last_seen_at = now()
     returning id`,
    [adapter.id, b.externalId, b.name, adapter.defaultChain ?? chainFromBranchName(b.name), loc?.city ?? null, loc?.area ?? null, b.url, bookable],
  );
  return row.rows[0].id;
}

/** Fetch city/address and today's prices/experiences for branches that need it (bounded). */
export async function enrichBranches(adapter: ProviderAdapter, movieId: string, budget = 3) {
  if (!adapter.fetchBranchDetails) return 0;
  // Bookable branches of this movie first (they need city + today's prices for alerts), then any branch lacking details.
  const branches = await q<{ id: string; external_id: string }>(
    `select b.id, b.external_id from cinema_branches b
       left join lateral (select 1 as bookable from screenings s
                           where s.branch_id = b.id and s.movie_id = $2 and s.active and s.is_bookable limit 1) s on true
      where b.provider_id = $1 and b.external_id <> 'online'
        and (b.details_fetched_at is null or (s.bookable is not null and b.details_fetched_at < now() - interval '30 minutes'))
      order by s.bookable is null, b.details_fetched_at nulls first limit $3`,
    [adapter.id, movieId, budget],
  );
  for (const b of branches) {
    const d = await adapter.fetchBranchDetails(b.external_id);
    await q(
      `update cinema_branches set city = coalesce($2, city), area = coalesce($3, area), address = coalesce($4, address),
         phone = coalesce($5, phone), details_fetched_at = now() where id = $1`,
      [b.id, d.city ?? null, d.area ?? null, d.address ?? null, d.phone ?? null],
    );
    if (!d.businessDate) continue;
    const works = await q<{ movie_id: string; external_id: string }>(
      "select movie_id, external_id from provider_movie_links where provider_id = $1 and external_id = any($2)",
      [adapter.id, [...new Set(d.todaysShowtimes.map((s) => s.workId))]],
    );
    for (const s of d.todaysShowtimes) {
      const w = works.find((x) => x.external_id === s.workId);
      if (!w) continue;
      await q(
        `update screenings set experience = $5, price_egp = coalesce($6, price_egp)
          where branch_id = $1 and movie_id = $2 and show_date = $3 and lower(replace(show_time,' ','')) = lower(replace($4,' ',''))`,
        [b.id, w.movie_id, d.businessDate, s.time, s.experience, s.priceEgp ?? null],
      );
    }
  }
  return branches.length;
}

// --- per-movie check ----------------------------------------------------------

export interface CheckResult {
  status: AvailabilityStatus;
  listed: number;
  bookable: number;
  events: number;
  error?: string;
}

/**
 * Checks every provider independently: one site being down never hides results
 * from the others (the failed one is stored as provider_unavailable). The job only
 * fails when every provider failed.
 */
export async function checkMovie(movieId: string, jobRunId?: number): Promise<(CheckResult & { provider: string })[]> {
  const results: (CheckResult & { provider: string })[] = [];
  // Circuit breaker: a site that failed 3+ times in a row is only re-tried every 30 min
  // (by whichever check comes first); meanwhile it stays "provider_unavailable", never "no tickets".
  const tripped = new Set(
    (
      await q<{ id: string }>(
        `select id from cinema_providers where consecutive_failures >= 3 and last_attempt_at > now() - interval '30 minutes'`,
      )
    ).map((r) => r.id),
  );
  for (const { adapter } of activeAdapters()) {
    if (tripped.has(adapter.id)) {
      results.push({ provider: adapter.id, status: "provider_unavailable", listed: 0, bookable: 0, events: 0, error: "skipped: site refusing requests, retry in ≤30 min" });
      continue;
    }
    try {
      results.push({ provider: adapter.id, ...(await checkMovieWithProvider(adapter, movieId, jobRunId)) });
    } catch (e) {
      results.push({ provider: adapter.id, status: "provider_unavailable", listed: 0, bookable: 0, events: 0, error: (e as Error).message.slice(0, 120) });
    }
  }
  if (results.every((r) => r.error) && results.some((r) => !r.error?.startsWith("skipped"))) throw new Error(`all providers failed: ${results.map((r) => `${r.provider}: ${r.error}`).join("; ")}`);
  return results;
}

async function checkMovieWithProvider(adapter: ProviderAdapter, movieId: string, jobRunId?: number): Promise<CheckResult> {
  const today = cairoToday();
  const movie = await q1<{ release_date: string | null; eg_release_date: string | null }>(
    "select release_date::text, eg_release_date::text from movies where id = $1",
    [movieId],
  );
  if (!movie) throw new Error(`movie ${movieId} not found`);
  const prevState = await q1<{ first_listed_at: string | null; first_bookable_at: string | null; status: string; listed_branches: number; bookable_branches: number }>(
    "select first_listed_at, first_bookable_at, status, listed_branches, bookable_branches from movie_availability where movie_id = $1 and provider_id = $2",
    [movieId, adapter.id],
  );

  try {
    const externalIds = await linkMovie(adapter.id, movieId);
    const externalId = externalIds[0] ?? null;
    // Merge listings of all linked entries (format variants), deduplicating sessions.
    let listing: MovieListing | null = null;
    for (const id of externalIds) {
      const l = await adapter.fetchMovieListing(id);
      if (!listing) listing = l;
      else {
        for (const b of l.branches) if (!listing.branches.some((x) => x.externalId === b.externalId)) listing.branches.push(b);
        for (const s of l.showtimes)
          if (!listing.showtimes.some((x) => x.branch.externalId === s.branch.externalId && +x.startsAt === +s.startsAt)) listing.showtimes.push(s);
      }
    }
    await recordProviderResult(adapter.id, true);

    // Advance booking beyond the showtimes page's ~7-day window: the provider's own
    // bookable index shows a "tickets" action for this movie. Record it as a movie-level
    // online booking (pick cinema/date on the provider's booking page).
    let movieLevelBooking = false;
    if (adapter.movieBookingUrl && externalIds.length && !(listing?.showtimes ?? []).some((s) => s.bookingUrl && s.businessDate >= today)) {
      const hit = await q1<{ external_id: string }>(
        "select external_id from provider_catalog where provider_id = $1 and external_id = any($2) and in_bookable limit 1",
        [adapter.id, externalIds],
      );
      if (hit) {
        movieLevelBooking = true;
        listing ??= { externalId: hit.external_id, sourceUrl: "", showtimes: [], branches: [] };
        listing.branches.push({ externalId: ONLINE_BRANCH, name: `${adapter.onlineBookingName ?? "Online booking"} (choose cinema & time)`, url: adapter.movieBookingUrl(hit.external_id), bookingUrl: adapter.movieBookingUrl(hit.external_id) });
      }
    }

    const notified = new Set(
      (
        await q<{ external_id: string }>(
          `select b.external_id from notified_branches n join cinema_branches b on b.id = n.branch_id
            where n.movie_id = $1 and n.provider_id = $2`,
          [movieId, adapter.id],
        )
      ).map((r) => r.external_id),
    );

    // Persist screenings for this check atomically; anything not seen again is deactivated.
    const branchIds = new Map<string, string>();
    await tx(async (c) => {
      const seen: string[] = [];
      for (const b of listing?.branches ?? []) branchIds.set(b.externalId, await upsertBranch(c, adapter, b, !!b.bookingUrl));
      for (const s of listing?.showtimes ?? []) {
        const r = await c.query<{ id: string }>(
          `insert into screenings (provider_id, movie_id, branch_id, show_date, show_time, starts_at, experience, is_bookable, booking_url, last_seen_at, active)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), true)
           on conflict (provider_id, movie_id, branch_id, starts_at) do update set is_bookable = excluded.is_bookable,
             booking_url = excluded.booking_url, show_date = excluded.show_date, show_time = excluded.show_time,
             experience = case when excluded.experience <> '' then excluded.experience else screenings.experience end,
             last_seen_at = now(), active = true
           returning id`,
          [adapter.id, movieId, branchIds.get(s.branch.externalId), s.businessDate, s.time, s.startsAt, s.experience, !!s.bookingUrl, s.bookingUrl ?? null],
        );
        seen.push(r.rows[0].id);
      }
      await c.query(
        `update screenings set active = false where movie_id = $1 and provider_id = $2 and active and not (id = any($3::uuid[]))`,
        [movieId, adapter.id, seen],
      );
    });

    const showtimes = listing?.showtimes ?? [];
    // Before the provider's catalogue has ever synced, "not found" means "don't know yet", not "not listed".
    const catalogReady = !!externalId || !!(await q1("select 1 from provider_catalog where provider_id = $1 limit 1", [adapter.id]));
    const status: AvailabilityStatus = !catalogReady ? "unknown" : computeStatus({
      today,
      providerOk: true,
      linked: !!externalId,
      everListed: !!prevState?.first_listed_at,
      listings: showtimes.map((s) => ({ isBookable: !!s.bookingUrl, showDate: s.businessDate })),
      egReleaseDate: movie.eg_release_date,
      releaseDate: movie.release_date,
      bookableWithoutShowtimes: movieLevelBooking,
    });
    const listedBranches = listing?.branches.filter((b) => b.externalId !== ONLINE_BRANCH).length ?? 0;
    const bookableNow = [
      ...new Set([...showtimes.filter((s) => s.bookingUrl && s.businessDate >= today).map((s) => s.branch.externalId), ...(movieLevelBooking ? [ONLINE_BRANCH] : [])]),
    ];
    const earliestBookable = showtimes.filter((s) => s.bookingUrl && s.businessDate >= today).map((s) => s.businessDate).sort()[0] ?? null;

    const alertedElsewhere = !!(await q1("select 1 from notified_branches where movie_id = $1 and provider_id <> $2 limit 1", [movieId, adapter.id]));
    // Verify the booking link of every branch that just started selling before alerting anyone.
    const detected = detectEvents({ movieId, providerId: adapter.id, status, notifiedBranches: notified, bookableBranchesNow: bookableNow, alertedElsewhere });
    const verified: string[] = [];
    for (const ext of detected?.branchExternalIds ?? []) {
      const url = listing!.branches.find((b) => b.externalId === ext)?.bookingUrl;
      const ok = url && adapter.verifyBookingUrl ? await adapter.verifyBookingUrl(url) : !!url;
      await q(
        `update screenings set ${ok ? "booking_url_verified_at = now(), booking_url_broken_at = null" : "booking_url_broken_at = now()"}
          where movie_id = $1 and branch_id = $2 and active and is_bookable`,
        [movieId, branchIds.get(ext)],
      );
      if (ok) verified.push(ext);
      else log(`booking URL failed verification, will retry next cycle: ${url}`);
    }
    // Re-derive with only verified branches (keeps "opened" vs "new_branch" and the dedupe key consistent).
    const event = verified.length
      ? detectEvents({ movieId, providerId: adapter.id, status, notifiedBranches: notified, bookableBranchesNow: verified, alertedElsewhere })
      : null;
    // Already-alerted branches keep their verification fresh too (shown as "verified" in the UI).
    await q(
      `update screenings s set booking_url_verified_at = now() from notified_branches n
        where n.movie_id = s.movie_id and n.branch_id = s.branch_id and s.movie_id = $1 and s.active and s.is_bookable
          and s.booking_url_broken_at is null`,
      [movieId],
    );

    await q(
      `insert into movie_availability (movie_id, provider_id, status, listed_branches, bookable_branches, earliest_bookable_date,
          first_listed_at, first_bookable_at, last_checked_at, last_success_at, last_error, booking_url)
       values ($1,$2,$3,$4,$5,$6, case when $4 > 0 then now() end, case when $7 then now() end, now(), now(), null, $8)
       on conflict (movie_id, provider_id) do update set status = excluded.status, listed_branches = excluded.listed_branches,
         bookable_branches = excluded.bookable_branches, earliest_bookable_date = excluded.earliest_bookable_date,
         first_listed_at = coalesce(movie_availability.first_listed_at, excluded.first_listed_at),
         first_bookable_at = coalesce(movie_availability.first_bookable_at, excluded.first_bookable_at),
         last_checked_at = now(), last_success_at = now(), last_error = null, booking_url = excluded.booking_url`,
      // first_bookable_at is only stamped once a booking link verified, so a failed
      // verification still yields a "booking opened" alert on the next cycle.
      [
        movieId,
        adapter.id,
        status,
        listedBranches,
        bookableNow.length,
        earliestBookable,
        BOOKABLE.includes(status) && (verified.length > 0 || notified.size > 0),
        movieLevelBooking ? listing!.branches.find((b) => b.externalId === ONLINE_BRANCH)?.bookingUrl ?? null : null,
      ],
    );
    await q(
      // history only when something changed (keeps the free 500 MB database small)
      `insert into availability_observations (movie_id, provider_id, status, listed_branches, bookable_branches, job_run_id)
       select $1,$2,$3,$4,$5,$6 where $7`,
      [
        movieId,
        adapter.id,
        status,
        listedBranches,
        bookableNow.length,
        jobRunId ?? null,
        !prevState || prevState.status !== status || prevState.listed_branches !== listedBranches || prevState.bookable_branches !== bookableNow.length,
      ],
    );

    if (externalId) await enrichBranches(adapter, movieId).catch((e) => log("branch enrichment failed", e.message));

    let created = 0;
    if (event) {
      const ids = event.branchExternalIds.map((x) => branchIds.get(x)!);
      const payload = await buildEventPayload(movieId, ids, event.type);
      const eventId = await tx(async (c) => {
        const row = await c.query<{ id: string }>(
          `insert into notification_events (movie_id, provider_id, branch_id, event_type, dedupe_key, payload)
           values ($1,$2,$3,$4,$5,$6) on conflict (dedupe_key) do nothing returning id`,
          [movieId, adapter.id, ids[0], event.type, event.dedupeKey, JSON.stringify(payload)],
        );
        const id = row.rows[0]?.id;
        if (id) {
          for (const b of ids) {
            await c.query(
              `insert into notified_branches (movie_id, provider_id, branch_id, event_id) values ($1,$2,$3,$4) on conflict do nothing`,
              [movieId, adapter.id, b, id],
            );
          }
        }
        return id;
      });
      if (eventId) {
        created = 1;
        await fanOutEvent(eventId);
      }
    }
    if (listing) created += await listingAlert(adapter.id, movieId, listing, branchIds, today);
    return { status, listed: listedBranches, bookable: bookableNow.length, events: created };
  } catch (e) {
    const msg = (e as Error).message;
    await recordProviderResult(adapter.id, false, msg);
    // Failure never downgrades to "no tickets": mark provider_unavailable, keep screenings as last seen.
    await q(
      `insert into movie_availability (movie_id, provider_id, status, last_checked_at, last_error)
       values ($1,$2,'provider_unavailable', now(), $3)
       on conflict (movie_id, provider_id) do update set status = 'provider_unavailable', last_checked_at = now(), last_error = $3`,
      [movieId, adapter.id, msg.slice(0, 500)],
    );
    await q(
      `insert into availability_observations (movie_id, provider_id, status, job_run_id) select $1,$2,'provider_unavailable',$3 where $4`,
      [movieId, adapter.id, jobRunId ?? null, prevState?.status !== "provider_unavailable"],
    );
    throw e;
  }
}

/**
 * "Showtimes are out" alert: a watched movie newly listed (with dates & times) at a
 * Scene/VOX branch on elCinema. Their booking links can't be verified from the cloud,
 * so the alert links to the chain's official site instead of a booking page.
 */
async function listingAlert(providerId: string, movieId: string, listing: MovieListing, branchIds: Map<string, string>, today: string) {
  // showtimes listed now at Scene/VOX branches, keyed "YYYY-MM-DD|hh:mm AM"
  const now = new Map<string, Set<string>>();
  for (const s of listing.showtimes) {
    if (s.businessDate < today || s.bookingUrl) continue;
    const id = branchIds.get(s.branch.externalId);
    if (!id) continue;
    now.set(id, (now.get(id) ?? new Set()).add(`${s.businessDate}|${s.time}`));
  }
  if (!now.size) return 0;
  const branches = await q<{ id: string; announced: boolean; dates: string[]; shows: string[] }>(
    `select b.id, exists (select 1 from listing_alerted a where a.movie_id = $3 and a.branch_id = b.id) as announced,
            coalesce((select array_agg(d.show_date::text) from listing_dates_alerted d where d.movie_id = $3 and d.branch_id = b.id), '{}') as dates,
            coalesce((select array_agg(x.show_date::text || '|' || x.show_time) from listing_shows_alerted x where x.movie_id = $3 and x.branch_id = b.id), '{}') as shows
       from cinema_branches b where b.id = any($1::uuid[]) and b.chain = any($2::text[]) order by b.id`,
    [[...now.keys()], [...OFFICIAL_SITE_CHAINS], movieId],
  );
  const fresh = new Map<string, Set<string>>();
  let anyFirst = false;
  let anyNewDate = false;
  for (const b of branches) {
    const newShows = [...now.get(b.id)!].filter((k) => !b.shows.includes(k));
    if (!newShows.length) continue;
    fresh.set(b.id, new Set(newShows));
    if (!b.announced) anyFirst = true;
    if (newShows.some((k) => !b.dates.includes(k.split("|")[0]))) anyNewDate = true;
  }
  if (!fresh.size) return 0;
  const payload = await buildEventPayload(movieId, [...fresh.keys()], "showtimes_listed", fresh);
  if (!payload.branches.length) return 0;
  // first listing → "SHOWTIMES ARE OUT", extra days → "NEW DATES ADDED", extra times on known days → "NEW SHOWTIMES ADDED"
  payload.newDates = !anyFirst;
  payload.update = anyFirst ? undefined : anyNewDate ? "dates" : "showtimes";
  const key = [...fresh].map(([b, ks]) => `${b}=${[...ks].sort().join("+")}`).join(",");
  const eventId = await tx(async (c) => {
    const row = await c.query<{ id: string }>(
      `insert into notification_events (movie_id, provider_id, branch_id, event_type, dedupe_key, payload)
       values ($1,$2,$3,'showtimes_listed',$4,$5) on conflict (dedupe_key) do nothing returning id`,
      [movieId, providerId, [...fresh.keys()][0], `movie:${movieId}:listed:${key}`.slice(0, 2000), JSON.stringify(payload)],
    );
    const id = row.rows[0]?.id;
    if (id) {
      for (const [b, ks] of fresh) {
        await c.query(`insert into listing_alerted (movie_id, branch_id, event_id) values ($1,$2,$3) on conflict do nothing`, [movieId, b, id]);
        for (const k of ks) {
          const [d, tm] = k.split("|");
          await c.query(`insert into listing_dates_alerted (movie_id, branch_id, show_date, event_id) values ($1,$2,$3,$4) on conflict do nothing`, [movieId, b, d, id]);
          await c.query(`insert into listing_shows_alerted (movie_id, branch_id, show_date, show_time) values ($1,$2,$3,$4) on conflict do nothing`, [movieId, b, d, tm]);
        }
      }
    }
    return id;
  });
  if (!eventId) return 0;
  await fanOutEvent(eventId);
  return 1;
}

export interface BranchPayload {
  cinema: string; // chain, or the branch name for independents
  branch: string;
  city: string | null;
  screenings: { date: string; time: string; experience: string; price: number | null }[];
  bookingUrl: string; // verified elCinema booking URL for this movie at this branch
}

export interface EventPayload {
  movieTitle: string;
  movieTitleAr: string | null;
  tmdbId: number;
  posterPath: string | null;
  branches: BranchPayload[];
  bookingUrl: string; // first branch's link
  detectedAt: string;
  advance: boolean;
  /** "listing": showtimes only — branch links are the chain's official site, not verified booking pages. */
  kind?: "booking" | "listing";
  /** listing alert for branches already announced */
  newDates?: boolean;
  /** what a follow-up listing alert adds */
  update?: "dates" | "showtimes";
}

async function buildEventPayload(movieId: string, branchIds: string[], type: string, onlyShows?: Map<string, Set<string>>): Promise<EventPayload> {
  const m = await q1<{ title: string; title_ar: string | null; tmdb_id: number; poster_path: string | null }>(
    "select title, title_ar, tmdb_id, poster_path from movies where id = $1",
    [movieId],
  );
  const listingOnly = type === "showtimes_listed";
  const branches: BranchPayload[] = [];
  for (const branchId of branchIds) {
    const b = await q1<{ name: string; chain: string | null; city: string | null; area: string | null; external_id: string; provider_id: string }>(
      "select name, chain, city, area, external_id, provider_id from cinema_branches where id = $1",
      [branchId],
    );
    if (b?.external_id === ONLINE_BRANCH && !listingOnly) {
      // movie-level advance booking: no dated sessions yet, link is the verified provider booking page
      const a = await q1<{ booking_url: string | null }>("select booking_url from movie_availability where movie_id = $1 and provider_id = $2", [movieId, b.provider_id]);
      if (a?.booking_url) branches.push({ cinema: b.name, branch: b.name, city: null, screenings: [], bookingUrl: a.booking_url });
      continue;
    }
    const shows = await q<{ show_date: string; show_time: string; experience: string; price_egp: string | null; booking_url: string | null }>(
      `select show_date::text, show_time, experience, price_egp, booking_url from screenings
        where movie_id = $1 and branch_id = $2 and active and starts_at > now()
          and ${listingOnly ? "true" : "is_bookable and booking_url_verified_at is not null"}
        order by starts_at limit ${listingOnly ? 60 : 6}`,
      [movieId, branchId],
    );
    const allowed = onlyShows?.get(branchId);
    if (allowed) shows.splice(0, shows.length, ...shows.filter((s) => allowed.has(`${s.show_date}|${s.show_time}`)));
    if (!shows.length || !b) continue;
    const link = listingOnly ? officialSiteFor(b.chain, b.name) : shows[0].booking_url;
    if (!link) continue;
    branches.push({
      cinema: b.chain && b.chain !== "Independent" ? b.chain : b.name,
      branch: [b.name, b.area].filter(Boolean).join(" — "),
      city: b.city,
      screenings: shows.map((s) => ({ date: s.show_date, time: s.show_time, experience: s.experience, price: s.price_egp ? Number(s.price_egp) : null })),
      bookingUrl: link,
    });
  }
  return {
    movieTitle: m!.title,
    movieTitleAr: m!.title_ar,
    tmdbId: m!.tmdb_id,
    posterPath: m!.poster_path,
    branches,
    bookingUrl: branches[0]?.bookingUrl ?? "",
    detectedAt: new Date().toISOString(),
    advance: type === "advance_booking_opened",
    kind: listingOnly ? "listing" : "booking",
  };
}
