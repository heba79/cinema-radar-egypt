import Link from "next/link";
import { redirect } from "next/navigation";
import { Poster } from "@/components/movie-card";
import { StatusBadge } from "@/components/status";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { WatchControls } from "@/components/watch-controls";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import type { AvailabilityStatus } from "@/lib/providers/types";
import { formatCairo } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "My Watchlist" };

export default async function WatchlistPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/watchlist");
  const rows = await q<{
    tmdb_id: number;
    title: string;
    poster_path: string | null;
    eg_release_date: string | null;
    paused: boolean;
    created_at: string;
    status: AvailabilityStatus | null;
    bookable_branches: number | null;
    last_checked_at: string | null;
    next_run_at: string | null;
  }>(
    `select m.tmdb_id, m.title, m.poster_path, m.eg_release_date::text, w.paused, w.created_at,
            a.status, a.bookable_branches, a.last_checked_at, j.next_run_at
       from watchlists w join movies m on m.id = w.movie_id
       left join movie_availability a on a.movie_id = m.id and a.provider_id = 'elcinema'
       left join monitor_jobs j on j.id = 'movie:' || m.id::text
      where w.user_id = $1 order by w.paused, w.created_at desc`,
    [user.id],
  );

  const devices = await q<{ n: number }>("select count(*)::int n from push_subscriptions where user_id = $1 and disabled_at is null", [user.id]);
  return (
    <div>
      {devices[0].n === 0 && (
        <Link href="/settings" className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-sky-900/60 bg-sky-950/30 p-4 text-sm hover:border-sky-700">
          <span>
            📱 <b>Turn on phone alerts</b> — get advance-booking alerts with the booking link the moment they&apos;re detected (free).
          </span>
          <span className="shrink-0 text-sky-300">Set up →</span>
        </Link>
      )}
      <SectionTitle action={<Link href="/settings" className="text-sm text-muted hover:text-foreground">Notification settings →</Link>}>My watchlist</SectionTitle>
      {rows.length === 0 ? (
        <Empty title="You're not tracking any movies yet">
          Search for a movie and tap <b>Notify me</b>. We check supported Egyptian cinemas every few minutes, even when your device is off.
        </Empty>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.tmdb_id} className={`flex items-center gap-4 p-3 sm:p-4 ${r.paused ? "opacity-60" : ""}`}>
              <Link href={`/movie/${r.tmdb_id}`} className="w-16 shrink-0 overflow-hidden rounded-lg sm:w-20">
                <Poster path={r.poster_path} alt={r.title} size="w154" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/movie/${r.tmdb_id}`} className="block truncate font-semibold hover:text-accent">
                  {r.title}
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <StatusBadge status={r.paused ? "unknown" : (r.status ?? "unknown")} />
                  {r.paused && <span className="text-xs text-amber-400">Paused</span>}
                  {r.bookable_branches ? <span className="text-xs text-muted">{r.bookable_branches} cinema(s) selling</span> : null}
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">
                  {r.last_checked_at ? `Checked ${formatCairo(r.last_checked_at)}` : "First check queued"}
                  {!r.paused && r.next_run_at ? ` · next ${formatCairo(r.next_run_at, { timeStyle: "short" })}` : ""}
                </p>
              </div>
              <WatchControls tmdbId={r.tmdb_id} paused={r.paused} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
