// Shared job runner used by the always-on worker (worker/index.ts) and by the
// serverless tick (/api/cron/tick, triggered every minute by Supabase pg_cron).
import { q, q1 } from "../db";
import { dispatchDue } from "../notify/dispatcher";
import { seedProviders } from "./check";
import { ensureJobs, finishJob, runJob, type JobRow } from "./jobs";

export const LEASE_SECONDS = 600;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[runner]", ...a);

export async function heartbeat(workerId: string, host: string, version: string) {
  await q(
    `insert into worker_heartbeats (worker_id, host, version, started_at, last_seen_at) values ($1,$2,$3, now(), now())
     on conflict (worker_id) do update set last_seen_at = now(), version = excluded.version`,
    [workerId, host, version],
  );
}

/** Claim and run the single highest-priority due job. Returns false when nothing was due. */
export async function runOneJob(workerId: string): Promise<boolean> {
  const job = await q1<JobRow>("select * from claim_monitor_jobs($1, 1, $2)", [workerId, LEASE_SECONDS]);
  if (!job) return false;
  const run = await q1<{ id: number }>("insert into job_runs (job_id, worker_id) values ($1,$2) returning id", [job.id, workerId]);
  const t0 = Date.now();
  try {
    const stats = await runJob(job, run!.id);
    await finishJob(job, run!.id, true, { ...stats, ms: Date.now() - t0 });
    log(`job ${job.id} ok in ${Date.now() - t0}ms`, JSON.stringify(stats).slice(0, 300));
  } catch (e) {
    await finishJob(job, run!.id, false, { ms: Date.now() - t0 }, (e as Error).message);
    log(`job ${job.id} FAILED:`, (e as Error).message);
  }
  // Deliver right away so alerts aren't held behind other jobs.
  await dispatchDue().catch((e) => log("dispatch error", (e as Error).message));
  return true;
}

/**
 * One serverless tick: take the global runner lock (so ticks never overlap and
 * per-site rate limits hold), keep running due jobs until the time budget is
 * used, then deliver pending notifications.
 */
export async function runTick(budgetMs: number, workerId = "cloud-tick") {
  const lockSeconds = Math.ceil(budgetMs / 1000) + 120;
  const got = await q1(
    `insert into runner_locks (name, holder, locked_until) values ('tick', $1, now() + make_interval(secs => $2))
     on conflict (name) do update set holder = excluded.holder, locked_until = excluded.locked_until
       where runner_locks.locked_until < now()
     returning name`,
    [workerId, lockSeconds],
  );
  const t0 = Date.now();
  const cpu0 = process.cpuUsage();
  const logTick = (jobs: number, skipped: boolean) => {
    const cpu = process.cpuUsage(cpu0);
    return q("insert into tick_log (duration_ms, cpu_ms, jobs, skipped) values ($1,$2,$3,$4)", [
      Date.now() - t0,
      Math.round((cpu.user + cpu.system) / 1000),
      jobs,
      skipped,
    ]).catch(() => {});
  };
  if (!got) {
    await logTick(0, true);
    return { skipped: "another tick is running" };
  }
  const deadline = Date.now() + budgetMs;
  let jobs = 0;
  try {
    await heartbeat(workerId, "vercel", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "cloud");
    // Bookkeeping isn't needed every minute (new watchlist entries queue their own check):
    // providers every 30 min, watchlist-driven jobs every 10 min. Saves free-tier CPU.
    const minute = new Date().getUTCMinutes();
    if (minute % 30 === 0) await seedProviders();
    if (minute % 10 === 0) await ensureJobs();
    // Don't start a job that is unlikely to finish inside the budget (~90 s worst case).
    while (Date.now() < deadline - 90_000 && (await runOneJob(workerId))) jobs++;
    await dispatchDue();
    await heartbeat(workerId, "vercel", process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "cloud");
  } finally {
    await q("update runner_locks set locked_until = now() where name = 'tick' and holder = $1", [workerId]);
    await logTick(jobs, false);
  }
  return { jobs };
}
