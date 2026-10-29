import { Ticket } from "lucide-react";
import Link from "next/link";
import { MovieCard, Poster, Rail } from "@/components/movie-card";
import { SearchBox } from "@/components/search-box";
import { Card, Empty, SectionTitle } from "@/components/ui";
import { nowShowingInEgypt, recentOpenings } from "@/lib/queries";
import { formatCairo } from "@/lib/time";
import { trending, upcomingEG } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [trend, soon, now, openings] = await Promise.all([
    trending().catch(() => []),
    upcomingEG().catch(() => []),
    nowShowingInEgypt().catch(() => []),
    recentOpenings(8).catch(() => []),
  ]);

  return (
    <div className="space-y-12">
      {/* no overflow-hidden here: the search suggestions must be able to extend below the hero */}
      <section className="relative z-10 rounded-3xl border border-border bg-gradient-to-br from-zinc-900 via-zinc-950 to-red-950/40 px-5 py-12 sm:px-12 sm:py-20">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">Egyptian cinema tracker</p>
        <h1 className="mt-3 max-w-2xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
          Be first in line when tickets drop.
        </h1>
        <p className="mt-4 max-w-xl text-muted sm:text-lg">
          Search any movie. We watch Egyptian cinema booking sources around the clock and alert you the moment tickets become bookable.
        </p>
        <div className="mt-8 max-w-2xl">
          <SearchBox large />
        </div>
      </section>

      <section>
        <SectionTitle>Recently opened bookings</SectionTitle>
        {openings.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {openings.map((o) => (
              <Card key={o.id} className="flex items-center gap-4 p-3 animate-fade-up">
                <Link href={`/movie/${o.tmdb_id}`} className="w-14 shrink-0 overflow-hidden rounded-lg">
                  <Poster path={o.poster_path} alt={o.title} size="w154" />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/movie/${o.tmdb_id}`} className="block truncate font-semibold hover:text-accent">
                    {o.title}
                  </Link>
                  <p className="truncate text-sm text-muted">
                    {o.first_branch}
                    {o.branches > 1 ? ` +${o.branches - 1} more` : ""}
                  </p>
                  <p className="text-xs text-zinc-500">Detected {formatCairo(o.detected_at)}</p>
                </div>
                {o.booking_url && (
                  <a href={o.booking_url} target="_blank" rel="noopener" className="rounded-full bg-accent p-2.5 text-white hover:bg-red-500" aria-label="Book">
                    <Ticket className="h-4 w-4" />
                  </a>
                )}
              </Card>
            ))}
          </div>
        ) : (
          <Empty title="No new bookings detected yet">The monitor records every time tickets open at a supported cinema.</Empty>
        )}
      </section>

      <section>
        <SectionTitle action={<Link href="/cinemas" className="text-sm text-muted hover:text-foreground">Cinema explorer →</Link>}>
          Now showing in Egypt
        </SectionTitle>
        {now.length ? (
          <Rail>
            {now.map((m) => (
              <MovieCard key={m.tmdb_id} tmdbId={m.tmdb_id} title={m.title} posterPath={m.poster_path} status={m.status} />
            ))}
          </Rail>
        ) : (
          <Empty title="Syncing Egyptian listings…">The monitoring worker imports what&apos;s playing in Egypt every 30 minutes.</Empty>
        )}
      </section>

      <section>
        <SectionTitle>Coming soon</SectionTitle>
        <Rail>
          {soon.map((m) => (
            <MovieCard key={m.id} tmdbId={m.id} title={m.title} posterPath={m.poster_path} subtitle={m.release_date ? `Release ${m.release_date}` : "TBA"} />
          ))}
        </Rail>
      </section>

      <section>
        <SectionTitle>Trending this week</SectionTitle>
        <Rail>
          {trend.map((m) => (
            <MovieCard key={m.id} tmdbId={m.id} title={m.title} posterPath={m.poster_path} subtitle={m.release_date?.slice(0, 4)} />
          ))}
        </Rail>
      </section>
    </div>
  );
}
