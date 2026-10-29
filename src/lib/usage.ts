import "server-only";
import { q1 } from "./db";

// Free-tier allowances (checked Oct 2026). Hobby/Free plans pause instead of billing.
export const LIMITS = {
  vercelInvocations: 1_000_000, // per month
  vercelGbHours: 360, // provisioned memory, per month
  vercelCpuHours: 4, // active CPU, per month
  vercelMemoryGb: 2, // Hobby function size (assumed for GB-hour projection)
  supabaseDbMb: 500,
  supabaseEgressGb: 5,
  resendPerDay: 100,
  resendPerMonth: 3000,
};

export interface UsageMeter {
  label: string;
  used: number; // projected for the month (or current, for storage/day caps)
  limit: number;
  unit: string;
  note: string;
}

/** Projections from the last 24 h of measured work (tick_log) and live counters. */
export async function freeTierUsage(): Promise<{ meters: UsageMeter[]; scheduler: { runs: number; ok: number }; latencySec: number | null; lastAdvanceScan: string | null }> {
  const t = await q1<{ n: number; ms: number; cpu: number; hours: number }>(
    `select count(*)::int n, coalesce(sum(duration_ms),0)::float8 ms, coalesce(sum(cpu_ms),0)::float8 cpu,
            greatest(extract(epoch from now() - min(started_at)) / 3600, 0.25)::float8 hours
       from tick_log where started_at > now() - interval '24 hours'`,
  );
  const scale = (30 * 24) / Math.min(24, t!.hours); // extrapolate the observed window to a month
  const db = await q1<{ mb: number }>("select (pg_database_size(current_database()) / 1048576.0)::float8 mb");
  const mail = await q1<{ today: number; month: number }>(
    `select count(*) filter (where sent_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc')::int today,
            count(*) filter (where sent_at >= date_trunc('month', now()))::int month
       from notification_deliveries where channel = 'email' and status = 'sent'`,
  );
  const sched = await q1<{ runs: number; ok: number }>(
    `select count(*)::int runs, count(*) filter (where status = 'succeeded')::int ok from cron.job_run_details where start_time > now() - interval '24 hours'`,
  ).catch(() => ({ runs: 0, ok: 0 }));
  const lat = await q1<{ s: number | null }>(
    `select percentile_cont(0.5) within group (order by extract(epoch from d.sent_at - e.detected_at))::float8 s
       from notification_deliveries d join notification_events e on e.id = d.event_id
      where d.status = 'sent' and d.sent_at > now() - interval '30 days'`,
  );
  const scan = await q1<{ at: string | null }>("select max(last_success_at)::text at from monitor_jobs where kind = 'bookable_index'");

  const gbHours = (t!.ms / 3_600_000) * LIMITS.vercelMemoryGb * scale;
  return {
    meters: [
      { label: "Vercel invocations", used: Math.round(t!.n * scale * 1.1), limit: LIMITS.vercelInvocations, unit: "/mo", note: "scheduler runs (+10% for page views)" },
      { label: "Vercel provisioned memory", used: gbHours, limit: LIMITS.vercelGbHours, unit: "GB-h/mo", note: `run time × ${LIMITS.vercelMemoryGb} GB` },
      { label: "Vercel active CPU", used: (t!.cpu / 3_600_000) * scale, limit: LIMITS.vercelCpuHours, unit: "h/mo", note: "measured CPU per run" },
      { label: "Supabase database", used: db!.mb, limit: LIMITS.supabaseDbMb, unit: "MB", note: "current size" },
      { label: "Resend emails today", used: mail!.today, limit: LIMITS.resendPerDay, unit: "", note: "UTC day" },
      { label: "Resend emails this month", used: mail!.month, limit: LIMITS.resendPerMonth, unit: "", note: "" },
    ],
    scheduler: sched ?? { runs: 0, ok: 0 },
    latencySec: lat?.s ?? null,
    lastAdvanceScan: scan?.at ?? null,
  };
}
