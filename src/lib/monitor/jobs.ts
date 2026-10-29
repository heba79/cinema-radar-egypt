// Durable, database-backed job scheduling. Jobs live in monitor_jobs; workers
// lease them with claim_monitor_jobs() so restarts and multiple replicas are safe.
import { q, q1 } from "../db";
import { env } from "../env";
import { backoffMs } from "../http";
import { ensureMovie } from "../movies";
import { activeAdapters, PROVIDERS, probeProvider } from "../providers/registry";
import { findByImdb } from "../tmdb";
import { checkMovie, fetchMissingDetails, linkMovie, recordProviderResult, syncCatalog } from "./check";

/** Unwatched movies showing in Egypt (Home + Cinema Explorer) — kept slow to stay inside Vercel's free CPU allowance. */
export const BACKGROUND_INTERVAL = 6 * 3600;
/** elCinema's "available for booking" list: 1 request, the earliest advance-booking signal. */
export const BOOKABLE_INDEX_INTERVAL = Number(process.env.BOOKABLE_INDEX_SECONDS ?? 120);

export interface JobRow {
  id: string;
  kind: "catalog" | "bookable_index" | "movie" | "maintenance";
  provider_id: string | null;
  movie_id: string | null;
  interval_seconds: number;
  consecutive_failures: number;
}

/** Interval for per-movie checks: 5 minutes by default, stretched if the watch list outgrows the provider's rate budget. */
export async function movieInterval(): Promise<number> {
  const base = env().MONITOR_INTERVAL_SECONDS;
  const n = Number((await q1<{ n: string }>("select count(distinct movie_id) n from watchlists where not paused"))?.n ?? 0);
  // The slowest provider bounds the cycle: ~2 requests per movie per provider,
  // kept below 50% of that host's request budget.
  const gapS = Math.max(...activeAdapters().map((a) => a.info.minRequestGapMs)) / 1000;
  const needed = Math.ceil((n * 2 * gapS * 2) / 60) * 60;
  return Math.max(base, needed);
}

export async function ensureJobs() {
  const upsert = (id: string, kind: string, interval: number, priority: number, providerId: string | null, movieId: string | null = null) =>
    q(
      `insert into monitor_jobs (id, kind, provider_id, movie_id, interval_seconds, priority, enabled)
       values ($1,$2,$3,$4,$5,$6,true)
       on conflict (id) do update set interval_seconds = excluded.interval_seconds, priority = excluded.priority, enabled = true`,
      [id, kind, providerId, movieId, interval, priority],
    );
  for (const { info, adapter } of activeAdapters()) {
    // elCinema's catalogue feeds movie linking (30 min); Scene/VOX catalogues change slowly and refuse cloud servers (6 h).
    await upsert(`${info.id}:catalog`, "catalog", info.id === "elcinema" ? 1800 : BACKGROUND_INTERVAL, 5, info.id);
    if (adapter.fetchBookableIndex) await upsert(`${info.id}:bookable_index`, "bookable_index", BOOKABLE_INDEX_INTERVAL, 9, info.id);
  }
  await upsert("maintenance", "maintenance", 3600, 1, null);

  // One job per watched movie (deduplicated across users), and disable jobs nobody watches.
  const interval = await movieInterval();
  await q(
    `insert into monitor_jobs (id, kind, movie_id, interval_seconds, priority, enabled)
     select 'movie:' || w.movie_id, 'movie', w.movie_id, $1, 10, true
       from (select distinct movie_id from watchlists where not paused) w
     on conflict (id) do update set interval_seconds = $1, priority = 10, enabled = true`,
    [interval],
  );
  // Unwatched: fall back to background checks if the movie is showing in Egypt, otherwise stop.
  await q(
    `update monitor_jobs set priority = 2, interval_seconds = ${BACKGROUND_INTERVAL}, enabled = movie_id in (${CATALOG_ACTIVE})
      where kind = 'movie' and priority >= 10 and movie_id not in (select movie_id from watchlists where not paused)`,
  );
}

/** Movies the provider currently lists as now playing / bookable in Egypt. */
// distinct: a movie can be linked to several providers/entries (one upsert must not touch a row twice)
const CATALOG_ACTIVE = `select distinct l.movie_id from provider_movie_links l
  join provider_catalog c on c.provider_id = l.provider_id and c.external_id = l.external_id
  where c.in_now_playing or c.in_bookable`;

/** Watched → every 5 min (priority 10); showing in Egypt → every 6 h (2); otherwise one-off and done. */
async function retierMovieJob(movieId: string) {
  const interval = await movieInterval();
  await q(
    `with s as (select exists (select 1 from watchlists where movie_id = $1::uuid and not paused) as watched,
                       $1::uuid in (${CATALOG_ACTIVE}) as active)
     update monitor_jobs j set
       priority = case when s.watched then 10 when s.active then 2 else j.priority end,
       interval_seconds = case when s.watched then $2::int when s.active then $3::int else j.interval_seconds end,
       enabled = s.watched or s.active
     from s where j.id = 'movie:' || $1::text`,
    [movieId, interval, BACKGROUND_INTERVAL],
  );
}

/** Attach TMDB metadata to provider titles via IMDb id, so they can be browsed and checked. */
async function importCatalogMovies(providerId: string, budget = 10) {
  if (!env().TMDB_API_KEY && !env().TMDB_READ_TOKEN) return "no TMDB credentials";
  const rows = await q<{ external_id: string; imdb_id: string }>(
    `select c.external_id, c.imdb_id from provider_catalog c
      where c.provider_id = $1 and c.imdb_id is not null and (c.in_now_playing or c.in_bookable or c.in_coming_soon)
        and not exists (select 1 from provider_movie_links l where l.provider_id = c.provider_id and l.external_id = c.external_id)
      order by c.in_bookable desc, c.in_now_playing desc limit $2`,
    [providerId, budget],
  );
  let n = 0;
  for (const r of rows) {
    const hit = await findByImdb(r.imdb_id);
    if (!hit) continue;
    const movie = await ensureMovie(hit.id);
    await q(
      `insert into provider_movie_links (provider_id, movie_id, external_id, external_url, match_method, confidence)
       values ($1,$2,$3,$4,'imdb',1) on conflict do nothing`,
      [providerId, movie.id, r.external_id, `https://elcinema.com/en/work/${r.external_id}/`],
    );
    n++;
  }
  return n;
}

/** Ask the worker to check a movie ASAP (used by the website for on-demand checks). */
export async function requestMovieCheck(movieId: string) {
  await q(
    `insert into monitor_jobs (id, kind, movie_id, interval_seconds, priority, next_run_at, enabled)
     values ('movie:' || $1::text, 'movie', $1::uuid, $2, 5, now(), true)
     on conflict (id) do update set next_run_at = least(monitor_jobs.next_run_at, now()), enabled = true`,
    [movieId, env().MONITOR_INTERVAL_SECONDS],
  );
}

export async function runJob(job: JobRow, runId: number): Promise<Record<string, unknown>> {
  switch (job.kind) {
    case "catalog": {
      const adapter = activeAdapters().find((a) => a.info.id === job.provider_id)!.adapter;
      const stats = await syncCatalog(adapter);
      await recordProviderResult(adapter.id, true);
      const imported = await importCatalogMovies(adapter.id).catch((e) => `skipped: ${(e as Error).message}`);
      // Background checks for everything showing in Egypt (feeds Home + Cinema Explorer).
      await q(
        `insert into monitor_jobs (id, kind, movie_id, interval_seconds, priority, enabled)
         select 'movie:' || a.movie_id, 'movie', a.movie_id, $1, 2, true from (${CATALOG_ACTIVE}) a
         on conflict (id) do update set enabled = true,
           interval_seconds = case when monitor_jobs.priority >= 10 then monitor_jobs.interval_seconds else excluded.interval_seconds end`,
        [BACKGROUND_INTERVAL],
      );
      return { ...stats, imported };
    }
    case "bookable_index": {
      // Cheap global poll (1 request): anything newly bookable fast-tracks the movies people watch.
      const adapter = activeAdapters().find((a) => a.info.id === job.provider_id)!.adapter;
      const ids = [...(await adapter.fetchBookableIndex!())];
      await recordProviderResult(adapter.id, true);
      const before = await q<{ external_id: string }>(
        "select external_id from provider_catalog where provider_id = $1 and in_bookable",
        [adapter.id],
      );
      const newlyBookable = ids.filter((id) => !before.some((b) => b.external_id === id));
      for (const id of ids) {
        await q(
          `insert into provider_catalog (provider_id, external_id, in_bookable, last_seen_at) values ($1,$2,true,now())
           on conflict (provider_id, external_id) do update set in_bookable = true, last_seen_at = now()`,
          [adapter.id, id],
        );
      }
      await q("update provider_catalog set in_bookable = false where provider_id = $1 and in_bookable and not (external_id = any($2))", [adapter.id, ids]);
      // Fetch details for unknown newly-bookable works so unlinked watched movies can match them.
      await fetchMissingDetails(adapter, 5, newlyBookable);
      const unlinked = await q<{ movie_id: string }>(
        `select distinct w.movie_id from watchlists w where not w.paused
           and not exists (select 1 from provider_movie_links l where l.movie_id = w.movie_id and l.provider_id = $1)`,
        [adapter.id],
      );
      for (const u of unlinked) await linkMovie(adapter.id, u.movie_id);
      const fast = await q(
        `update monitor_jobs j set next_run_at = now()
           from provider_movie_links l
          where j.kind = 'movie' and j.enabled and j.movie_id = l.movie_id and l.provider_id = $1
            and l.external_id = any($2) and j.next_run_at > now() + interval '30 seconds'
          returning j.id`,
        [adapter.id, newlyBookable],
      );
      return { bookable: ids.length, newlyBookable: newlyBookable.length, fastTracked: fast.length };
    }
    case "movie": {
      const results = await checkMovie(job.movie_id!, runId);
      await retierMovieJob(job.movie_id!);
      return { results };
    }
    case "maintenance": {
      await q("update screenings set active = false where active and starts_at < now() - interval '6 hours'");
      await q("delete from job_runs where started_at < now() - interval '30 days'");
      await q("delete from availability_observations where observed_at < now() - interval '30 days'");
      await q("delete from tick_log where started_at < now() - interval '30 days'");
      // pg_cron keeps every run forever; keep 3 days (needs the cron schema, present on Supabase)
      await q("delete from cron.job_run_details where end_time < now() - interval '3 days'").catch(() => {});
      const probes: Record<string, string> = {};
      for (const p of PROVIDERS.filter((x) => !x.adapter && x.probeUrl)) {
        const r = await probeProvider(p);
        await recordProviderResult(p.id, r.ok, r.ok ? undefined : r.detail);
        probes[p.id] = r.detail;
      }
      await ensureJobs();
      return { probes };
    }
  }
}

export async function finishJob(job: JobRow, runId: number, ok: boolean, stats: Record<string, unknown>, error?: string) {
  await q(`update job_runs set finished_at = now(), status = $2, error = $3, stats = $4 where id = $1`, [
    runId,
    ok ? "success" : "failed",
    error?.slice(0, 1000) ?? null,
    JSON.stringify(stats),
  ]);
  if (ok) {
    await q(
      `update monitor_jobs set locked_by = null, locked_until = null, last_run_at = now(), last_success_at = now(),
         consecutive_failures = 0, last_error = null, next_run_at = now() + make_interval(secs => interval_seconds) where id = $1`,
      [job.id],
    );
  } else {
    // Exponential backoff. Movie checks are capped at their own interval so watched movies never stall;
    // catalogue syncs of a site that keeps refusing us back off up to 6 h to save free-tier CPU.
    const cap = job.kind === "movie" || job.kind === "bookable_index" ? job.interval_seconds : BACKGROUND_INTERVAL;
    const delay = Math.min(cap, Math.round(backoffMs(job.consecutive_failures, 30_000, BACKGROUND_INTERVAL * 1000) / 1000));
    await q(
      `update monitor_jobs set locked_by = null, locked_until = null, last_run_at = now(), consecutive_failures = consecutive_failures + 1,
         last_error = $2, next_run_at = now() + make_interval(secs => $3) where id = $1`,
      [job.id, error?.slice(0, 500) ?? null, delay],
    );
  }
}
