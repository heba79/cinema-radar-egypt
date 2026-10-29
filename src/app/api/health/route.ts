import { q1 } from "@/lib/db";

export const dynamic = "force-dynamic";

// Public health check: DB reachable + worker heartbeat freshness + provider status.
export async function GET() {
  try {
    const r = await q1<{ worker_age: number | null; elcinema_ok: boolean | null; overdue_jobs: number }>(
      `select extract(epoch from now() - max(h.last_seen_at))::int as worker_age,
              (select consecutive_failures < 3 from cinema_providers where id = 'elcinema') as elcinema_ok,
              (select count(*)::int from monitor_jobs where enabled and next_run_at < now() - interval '15 minutes') as overdue_jobs
         from worker_heartbeats h`,
    );
    const workerOk = r?.worker_age != null && r.worker_age < 120;
    const ok = workerOk && r?.elcinema_ok !== false;
    return Response.json(
      { ok, db: true, worker: { ok: workerOk, lastHeartbeatSecondsAgo: r?.worker_age }, providers: { elcinema: r?.elcinema_ok }, overdueJobs: r?.overdue_jobs },
      { status: ok ? 200 : 503 },
    );
  } catch (e) {
    return Response.json({ ok: false, db: false, error: (e as Error).message }, { status: 503 });
  }
}
