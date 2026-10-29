import { Mail, MessageCircle, Smartphone, Ticket } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, Empty, SectionTitle, type Tone } from "@/components/ui";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { headline } from "@/lib/notify/format";
import { formatCairo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notification history" };

const ICON = { email: Mail, push: Smartphone, telegram: MessageCircle };
const TONE: Record<string, Tone> = { sent: "green", pending: "amber", sending: "amber", failed: "red", skipped: "zinc" };

export default async function NotificationsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/notifications");
  const rows = await q<{
    event_id: string;
    event_type: string;
    detected_at: string;
    tmdb_id: number;
    title: string;
    branches: { branch: string; bookingUrl: string }[];
    deliveries: { channel: keyof typeof ICON; status: string; sent_at: string | null; last_error: string | null; attempts: number }[];
  }>(
    `select e.id as event_id, e.event_type, e.detected_at, m.tmdb_id, m.title, e.payload->'branches' as branches,
            json_agg(json_build_object('channel', d.channel, 'status', d.status, 'sent_at', d.sent_at, 'last_error', d.last_error, 'attempts', d.attempts)
                     order by d.channel) as deliveries
       from notification_deliveries d
       join notification_events e on e.id = d.event_id
       join movies m on m.id = e.movie_id
      where d.user_id = $1
      group by e.id, m.id order by e.detected_at desc limit 100`,
    [user.id],
  );

  return (
    <div>
      <SectionTitle>Notification history</SectionTitle>
      {rows.length === 0 ? (
        <Empty title="No alerts yet">When tickets open for a movie on your watchlist, every alert we send shows up here with its delivery status.</Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.event_id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-accent">{headline(r.event_type).replace("🎬 ", "")}</p>
                  <Link href={`/movie/${r.tmdb_id}`} className="text-lg font-semibold hover:text-accent">
                    {r.title}
                  </Link>
                  <p className="text-xs text-zinc-500">Detected {formatCairo(r.detected_at)} (Cairo)</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.deliveries.map((d) => {
                    const Icon = ICON[d.channel];
                    return (
                      <Badge key={d.channel} tone={TONE[d.status] ?? "zinc"}>
                        <Icon className="h-3 w-3" /> {d.channel}: {d.status}
                        {d.status === "failed" && d.last_error ? <span className="opacity-70" title={d.last_error}> ⓘ</span> : null}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.branches.map((b) => (
                  <a key={b.bookingUrl} href={b.bookingUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:border-accent">
                    <Ticket className="h-3.5 w-3.5 text-accent" /> {b.branch}
                  </a>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
