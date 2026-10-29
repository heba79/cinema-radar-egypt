// End-to-end monitor run against LIVE elCinema data and a database
// (local PGlite or a real Supabase project). It creates a test user watching a
// movie that elCinema currently sells tickets for, runs the same jobs the worker
// runs, and prints the resulting availability, screenings, events and deliveries.
//
//   DATABASE_URL=... npx tsx scripts/integration-monitor.ts [imdbId] [title] [email]
import { q, q1, pool } from "../src/lib/db";
import { seedProviders } from "../src/lib/monitor/check";
import { ensureJobs, finishJob, runJob, type JobRow } from "../src/lib/monitor/jobs";
import { dispatchDue } from "../src/lib/notify/dispatcher";
import { normalizeTitle } from "../src/lib/normalize";

const imdbId = process.argv[2] ?? "tt13609648";
const title = process.argv[3] ?? "Sense and Sensibility";
const email = process.argv[4] ?? "integration-test@example.com";

async function run(jobId: string) {
  const job = await q1<JobRow>("select * from monitor_jobs where id = $1", [jobId]);
  const r = await q1<{ id: number }>("insert into job_runs (job_id, worker_id) values ($1,'integration') returning id", [jobId]);
  const t0 = Date.now();
  try {
    const stats = await runJob(job!, r!.id);
    await finishJob(job!, r!.id, true, stats);
    console.log(`✔ ${jobId} (${Date.now() - t0}ms)`, JSON.stringify(stats).slice(0, 400));
  } catch (e) {
    await finishJob(job!, r!.id, false, {}, (e as Error).message);
    console.log(`✘ ${jobId}`, (e as Error).message);
  }
}

async function main() {
  await seedProviders();
  const user = await q1<{ id: string }>(
    `insert into auth.users (email) values ($1) returning id`,
    [email],
  ).catch(async () => q1<{ id: string }>("select id from auth.users where email = $1", [email]));
  await q(`insert into profiles (id, email) values ($1,$2) on conflict do nothing`, [user!.id, email]);
  await q(`insert into notification_preferences (user_id, email_address) values ($1,$2) on conflict do nothing`, [user!.id, email]);

  // Minimal movie row (the website fills this from TMDB; this script avoids needing a TMDB key).
  const movie = await q1<{ id: string }>(
    `insert into movies (tmdb_id, imdb_id, title, release_date) values ($1,$2,$3, current_date)
     on conflict (tmdb_id) do update set imdb_id = excluded.imdb_id returning id`,
    [-Math.abs(hash(imdbId)), imdbId, title],
  );
  await q(`insert into movie_aliases (movie_id, alias, normalized, source) values ($1,$2,$3,'test') on conflict do nothing`, [
    movie!.id,
    title,
    normalizeTitle(title),
  ]);
  await q(`insert into watchlists (user_id, movie_id) values ($1,$2) on conflict do nothing`, [user!.id, movie!.id]);

  await ensureJobs();
  await run("elcinema:catalog");
  await run("vox-egypt:catalog");
  await run("elcinema:bookable_index");
  await run(`movie:${movie!.id}`);

  console.table(
    await q(
      "select provider_id, status, listed_branches, bookable_branches, earliest_bookable_date::text, last_error from movie_availability where movie_id = $1",
      [movie!.id],
    ),
  );
  console.table(await q("select provider_id, external_id, match_method, confidence from provider_movie_links where movie_id = $1", [movie!.id]));
  const shows = await q(
    `select distinct on (s.provider_id, b.name) s.provider_id, b.name, b.city, b.area, s.show_date::text, s.show_time, s.experience, s.price_egp,
            s.booking_url, s.booking_url_verified_at is not null as verified
       from screenings s join cinema_branches b on b.id = s.branch_id
      where s.movie_id = $1 and s.active and s.is_bookable order by s.provider_id, b.name, s.starts_at`,
    [movie!.id],
  );
  console.table(shows);
  const events = await q<{ event_type: string; payload: { branches: unknown[] } }>(
    "select event_type, dedupe_key, payload from notification_events where movie_id = $1",
    [movie!.id],
  );
  for (const e of events) console.log(`event ${e.event_type}:`, JSON.stringify(e.payload, null, 1).slice(0, 1500));
  console.log("dispatch:", await dispatchDue());
  console.table(await q("select channel, status, attempts, last_error from notification_deliveries where user_id = $1", [user!.id]));

  // Second run must not create duplicate events.
  await q("update monitor_jobs set next_run_at = now() where id = $1", [`movie:${movie!.id}`]);
  await run(`movie:${movie!.id}`);
  const n = await q1<{ n: string }>("select count(*) n from notification_events where movie_id = $1", [movie!.id]);
  console.log(`events after second check: ${n!.n} (should equal ${events.length})`);
  await pool().end();
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
