// Schedules the free 24/7 monitor: Supabase pg_cron POSTs APP_URL/api/cron/tick every minute.
//   APP_URL=https://your-app.vercel.app npx tsx --env-file=.env.local scripts/schedule-cron.ts
//   ... scripts/schedule-cron.ts --off     # unschedule
// The secret is stored only inside the cron job definition (visible to the postgres role).
import { Client } from "pg";

async function main() {
  const url = process.env.DATABASE_URL!;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET ?? "";
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("create extension if not exists pg_net");
  await c.query("create extension if not exists pg_cron");
  await c.query("select cron.unschedule(jobid) from cron.job where jobname = 'cinema-radar-tick'");
  if (process.argv.includes("--off")) {
    console.log("unscheduled");
    return c.end();
  }
  if (!/^https:\/\//.test(appUrl) || /localhost/.test(appUrl)) throw new Error("APP_URL must be the public https URL of the deployed site");
  if (secret.length < 24) throw new Error("CRON_SECRET missing or too short");
  const cmd = `select net.http_post(
      url := '${appUrl}/api/cron/tick',
      headers := jsonb_build_object('authorization', 'Bearer ${secret.replace(/'/g, "''")}', 'content-type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000)`;
  await c.query("select cron.schedule('cinema-radar-tick', '* * * * *', $1)", [cmd]);
  const j = await c.query("select jobname, schedule, active from cron.job where jobname = 'cinema-radar-tick'");
  console.log("scheduled:", j.rows[0], "→", `${appUrl}/api/cron/tick`);
  await c.end();
}

main().catch((e) => {
  console.error("✘", (e as Error).message);
  process.exit(1);
});
