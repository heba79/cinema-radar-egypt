import { redirect } from "next/navigation";
import { AdminActions } from "@/components/admin-actions";
import { IntegrationBadge } from "@/components/status";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { formatCairo } from "@/lib/time";
import { freeTierUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

const ago = (d: string | null) => (d ? `${Math.round((Date.now() - new Date(d).getTime()) / 1000)}s ago` : "never");

export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.isAdmin) redirect("/");

  const [workers, providers, jobs, failedRuns, deliveries, stats] = await Promise.all([
    q<{ worker_id: string; version: string; started_at: string; last_seen_at: string }>("select * from worker_heartbeats order by last_seen_at desc limit 10"),
    q<{ id: string; name: string; integration_status: string; last_success_at: string | null; last_failure_at: string | null; last_error: string | null; consecutive_failures: number }>(
      "select * from cinema_providers order by name",
    ),
    q<{ id: string; kind: string; title: string | null; priority: number; interval_seconds: number; next_run_at: string; last_success_at: string | null; consecutive_failures: number; last_error: string | null; enabled: boolean; locked_by: string | null }>(
      `select j.*, m.title from monitor_jobs j left join movies m on m.id = j.movie_id
        where j.enabled order by j.priority desc, j.next_run_at limit 60`,
    ),
    q<{ id: number; job_id: string; started_at: string; error: string | null }>(
      "select id, job_id, started_at, error from job_runs where status = 'failed' order by started_at desc limit 20",
    ),
    q<{ id: string; channel: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; email: string | null; title: string }>(
      `select d.id, d.channel, d.status, d.attempts, d.last_error, d.created_at, d.sent_at, pr.email, m.title
         from notification_deliveries d join profiles pr on pr.id = d.user_id
         join notification_events e on e.id = d.event_id join movies m on m.id = e.movie_id
        order by d.created_at desc limit 30`,
    ),
    q<{ k: string; v: string }>(
      `select 'Users' k, count(*)::text v from profiles
       union all select 'Watched movies', count(distinct movie_id)::text from watchlists where not paused
       union all select 'Active screenings', count(*)::text from screenings where active
       union all select 'Branches', count(*)::text from cinema_branches
       union all select 'Runs (24h)', count(*)::text from job_runs where started_at > now() - interval '24 hours'
       union all select 'Failed runs (24h)', count(*)::text from job_runs where status = 'failed' and started_at > now() - interval '24 hours'
       union all select 'Alerts sent (24h)', count(*)::text from notification_deliveries where status = 'sent' and sent_at > now() - interval '24 hours'
       union all select 'Pending deliveries', count(*)::text from notification_deliveries where status in ('pending','sending')`,
    ),
  ]);
  const usage = await freeTierUsage().catch(() => null);
  const laptops = await q<{ worker_id: string; version: string; last_seen_at: string; details: { detail?: Record<string, { state: string; detail?: string }>; lastRun?: Record<string, unknown> } | null }>(
    "select worker_id, version, last_seen_at, details from worker_heartbeats where worker_id like 'laptop-%' order by last_seen_at desc",
  );
  const workerAlive = workers.some((w) => Date.now() - new Date(w.last_seen_at).getTime() < 90_000);

  return (
    <div className="space-y-8">
      <SectionTitle action={<AdminActions />}>Admin dashboard</SectionTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted">Worker</p>
          <p className={`mt-1 text-lg font-bold ${workerAlive ? "text-emerald-400" : "text-red-400"}`}>{workerAlive ? "● Running" : "● Down"}</p>
          <p className="text-[11px] text-zinc-500">{workers[0] ? `heartbeat ${ago(workers[0].last_seen_at)}` : "no heartbeat"}</p>
        </Card>
        {stats.map((s) => (
          <Card key={s.k} className="p-4">
            <p className="text-xs text-muted">{s.k}</p>
            <p className="mt-1 text-lg font-bold">{s.v}</p>
          </Card>
        ))}
      </div>

      {usage && (
        <section>
          <h3 className="mb-1 font-semibold">Free-tier usage ($0 plan)</h3>
          <p className="mb-3 text-xs text-muted">
            Projected for a full month from the last 24 h of measured runs. Free plans pause (never bill) if a limit is reached — keep every bar under 80%.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {usage.meters.map((m) => {
              const pct = Math.min(100, (m.used / m.limit) * 100);
              const tone = pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-400" : "bg-emerald-500";
              return (
                <Card key={m.label} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className="text-xs text-muted">{pct.toFixed(pct < 1 ? 2 : 0)}%</p>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(pct, 1)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">
                    {m.used < 10 ? m.used.toFixed(2) : Math.round(m.used).toLocaleString()} / {m.limit.toLocaleString()} {m.unit}
                    {m.note ? <span className="text-zinc-500"> · {m.note}</span> : null}
                  </p>
                </Card>
              );
            })}
            <Card className="p-4">
              <p className="text-sm font-medium">Scheduler (Supabase pg_cron, 24 h)</p>
              <p className="mt-2 text-lg font-bold">
                {usage.scheduler.ok}/{usage.scheduler.runs} <span className="text-xs font-normal text-muted">runs succeeded</span>
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-sm font-medium">Advance-booking detection</p>
              <p className="mt-2 text-xs text-zinc-400">
                Last elCinema bookable-list scan: {usage.lastAdvanceScan ? formatCairo(usage.lastAdvanceScan, { timeStyle: "medium" }) : "never"}
                <br />
                Median detection → alert sent: {usage.latencySec != null ? `${Math.round(usage.latencySec)} s` : "no alerts yet"}
              </p>
            </Card>
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1 font-semibold">Laptop worker (Scene &amp; VOX)</h3>
        <p className="mb-3 text-xs text-muted">Reads Scene/VOX from your home connection (they refuse cloud servers). Offline when the laptop is off or asleep — the cloud then covers what it can.</p>
        {laptops.length === 0 ? (
          <Card className="p-4 text-sm text-muted">No laptop worker has reported yet.</Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {laptops.map((l) => {
              const ageMin = Math.round((Date.now() - new Date(l.last_seen_at).getTime()) / 60000);
              const online = ageMin <= 15;
              return (
                <Card key={l.worker_id} className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{l.worker_id}</p>
                    <Badge tone={online ? "green" : "zinc"}>{online ? "● Online" : "○ Offline"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">Last report {formatCairo(l.last_seen_at)} ({ageMin} min ago) · {l.version}</p>
                  <div className="mt-2 space-y-1">
                    {Object.entries(l.details?.detail ?? {}).map(([p, s]) => (
                      <p key={p} className="text-xs">
                        <Badge tone={s.state === "ok" ? "green" : s.state === "blocked" ? "red" : s.state === "disabled" ? "zinc" : "amber"}>{p}: {s.state}</Badge>
                        {s.detail ? <span className="ml-2 text-zinc-500">{s.detail}</span> : null}
                      </p>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Provider health</h3>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="p-3">Provider</th>
                <th className="p-3">Integration</th>
                <th className="p-3">Last success</th>
                <th className="p-3">Failures</th>
                <th className="p-3">Last error</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="p-3 font-medium">{p.name}</td>
                  <td className="p-3"><IntegrationBadge status={p.integration_status} /></td>
                  <td className="p-3 text-xs">{p.last_success_at ? formatCairo(p.last_success_at) : "—"}</td>
                  <td className="p-3">{p.consecutive_failures ? <Badge tone="red">{p.consecutive_failures}</Badge> : "0"}</td>
                  <td className="max-w-xs truncate p-3 text-xs text-red-300" title={p.last_error ?? ""}>{p.last_error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section>
        <h3 className="mb-3 font-semibold">Monitoring jobs ({jobs.length})</h3>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-border">
                <th className="p-3">Job</th>
                <th className="p-3">Every</th>
                <th className="p-3">Next run</th>
                <th className="p-3">Last success</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-border/50">
                  <td className="p-3">
                    <span className="font-medium">{j.title ?? j.id}</span>
                    <span className="ml-2 text-xs text-zinc-500">{j.kind}{j.priority >= 10 ? " · watched" : ""}</span>
                  </td>
                  <td className="p-3 text-xs">{Math.round(j.interval_seconds / 60)}m</td>
                  <td className="p-3 text-xs">{formatCairo(j.next_run_at, { timeStyle: "medium" })}</td>
                  <td className="p-3 text-xs">{j.last_success_at ? formatCairo(j.last_success_at, { timeStyle: "medium" }) : "—"}</td>
                  <td className="p-3">
                    {j.locked_by ? <Badge tone="blue">running</Badge> : j.consecutive_failures ? <Badge tone="red" >{`failing ×${j.consecutive_failures}`}</Badge> : <Badge tone="green">ok</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 font-semibold">Failed checks</h3>
          <Card className="divide-y divide-border/60">
            {failedRuns.length ? (
              failedRuns.map((r) => (
                <div key={r.id} className="p-3 text-xs">
                  <p className="font-medium">{r.job_id} <span className="text-zinc-500">· {formatCairo(r.started_at)}</span></p>
                  <p className="mt-0.5 text-red-300">{r.error}</p>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-muted">No failed runs. 🎉</p>
            )}
          </Card>
        </section>
        <section>
          <h3 className="mb-3 font-semibold">Notification delivery log</h3>
          <Card className="divide-y divide-border/60">
            {deliveries.length ? (
              deliveries.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-2 p-3 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{d.title} → {d.email}</p>
                    <p className="text-zinc-500">{formatCairo(d.created_at)} · attempts {d.attempts}</p>
                    {d.last_error && <p className="truncate text-red-300" title={d.last_error}>{d.last_error}</p>}
                  </div>
                  <Badge tone={d.status === "sent" ? "green" : d.status === "failed" ? "red" : "amber"}>{d.channel}: {d.status}</Badge>
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-muted">No deliveries yet.</p>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
