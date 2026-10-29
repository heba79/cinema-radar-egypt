// Cinema Radar Egypt — always-on monitoring worker (optional hosting mode).
// The default free deployment uses Supabase pg_cron → /api/cron/tick instead;
// both run the same runner, and all state is in Postgres, so the worker can be
// restarted (or scaled to several replicas) without losing schedules or
// double-sending notifications.
import { hostname } from "node:os";
import { createServer } from "node:http";
import { pool } from "../src/lib/db";
import { seedProviders } from "../src/lib/monitor/check";
import { ensureJobs } from "../src/lib/monitor/jobs";
import { heartbeat, LEASE_SECONDS, runOneJob } from "../src/lib/monitor/runner";
import { dispatchDue } from "../src/lib/notify/dispatcher";
import { sleep } from "../src/lib/http";

const WORKER_ID = `${hostname()}-${process.pid}`;
const VERSION = process.env.npm_package_version ?? "1.0.0";
const TICK_MS = 5_000;
let stopping = false;
let lastLoopAt = Date.now();

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[worker]", ...a);
const beat = () => heartbeat(WORKER_ID, hostname(), VERSION);

async function main() {
  log(`starting ${WORKER_ID} v${VERSION}`);
  await seedProviders();
  await ensureJobs();
  let lastEnsure = Date.now();

  // Heartbeat on its own timer so long jobs (catalogue syncs) don't look like an outage.
  setInterval(() => beat().catch((e) => log("heartbeat failed:", e.message)), 30_000).unref();

  // Health endpoint for the hosting platform (Fly/Railway/Render/Docker healthcheck).
  const port = Number(process.env.PORT ?? 8080);
  createServer((req, res) => {
    // A stuck loop is one that hasn't completed within a job lease.
    const healthy = Date.now() - lastLoopAt < LEASE_SECONDS * 1000;
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: healthy, worker: WORKER_ID, lastLoopAt: new Date(lastLoopAt).toISOString() }));
  }).listen(port, () => log(`health server on :${port}`));

  while (!stopping) {
    try {
      await beat();
      if (Date.now() - lastEnsure > 60_000) {
        await ensureJobs(); // picks up new watchlist entries within a minute
        lastEnsure = Date.now();
      }
      // Drain due jobs one by one: each claim re-sorts by priority, so watched movies go first.
      for (let i = 0; i < 20 && !stopping; i++) {
        const ran = await runOneJob(WORKER_ID);
        lastLoopAt = Date.now();
        if (!ran) break;
      }
      await dispatchDue();
      lastLoopAt = Date.now();
    } catch (e) {
      // DB/network blip: log and keep looping; leases expire so nothing is lost.
      log("loop error:", (e as Error).message);
      await sleep(15_000);
    }
    await sleep(TICK_MS);
  }
  await pool().end();
  log("stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`${sig} received, finishing current job…`);
    stopping = true;
    setTimeout(() => process.exit(0), 30_000).unref();
  });
}
process.on("unhandledRejection", (e) => log("unhandledRejection", e));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
