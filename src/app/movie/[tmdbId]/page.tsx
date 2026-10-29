import { CalendarDays, Clock, ExternalLink, MapPin, ShieldCheck, Ticket } from "lucide-react";
import { officialSiteFor } from "@/lib/providers/official";
import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AvailabilityRefresher, NotifyButton } from "@/components/movie-actions";
import { Poster } from "@/components/movie-card";
import { StatusBadge } from "@/components/status";
import { Badge, Card, SectionTitle } from "@/components/ui";
import { BOOKABLE } from "@/lib/availability";
import { currentUser } from "@/lib/auth";
import { requestMovieCheck } from "@/lib/monitor/jobs";
import { ensureMovie } from "@/lib/movies";
import { movieAvailability, movieShowtimes, watchState } from "@/lib/queries";
import { formatCairo } from "@/lib/time";
import { formatDate } from "@/lib/notify/format";

export const dynamic = "force-dynamic";

async function load(id: string) {
  const tmdbId = Number(id);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  return ensureMovie(tmdbId).catch(() => null);
}

export async function generateMetadata({ params }: { params: Promise<{ tmdbId: string }> }): Promise<Metadata> {
  const m = await load((await params).tmdbId);
  return { title: m?.title ?? "Movie" };
}

export default async function MoviePage({ params }: { params: Promise<{ tmdbId: string }> }) {
  const movie = await load((await params).tmdbId);
  if (!movie) notFound();
  const user = await currentUser();
  const [availability, branches, watch] = await Promise.all([movieAvailability(movie.id), movieShowtimes(movie.id), watchState(user?.id, movie.id)]);

  // Stale or never checked → ask the worker for a fresh check (deduplicated via the job table).
  const lastCheck = Math.max(0, ...availability.map((a) => (a.last_checked_at ? new Date(a.last_checked_at).getTime() : 0)));
  const stale = Date.now() - lastCheck > 10 * 60_000;
  if (stale) await requestMovieCheck(movie.id);

  const primary = availability.find((a) => BOOKABLE.includes(a.status)) ?? availability[0];
  const bookable = branches.filter((b) => b.bookable);
  // Advance booking open on a provider but no dated sessions published yet.
  const advanceOnline = availability.filter((a) => a.booking_url);
  const chainListed =branches.filter((b) => !b.bookable && officialSiteFor(b.chain, b.name));
  const listedOnly = branches.filter((b) => !b.bookable && !officialSiteFor(b.chain, b.name));
  const year = movie.release_date?.slice(0, 4);

  return (
    <div className="space-y-10">
      <section className="relative -mx-4 -mt-6 overflow-hidden sm:mx-0 sm:mt-0 sm:rounded-3xl">
        {movie.backdrop_path && (
          <Image src={`https://image.tmdb.org/t/p/w1280${movie.backdrop_path}`} alt="" fill priority className="object-cover opacity-30" sizes="100vw" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/30" />
        <div className="relative flex flex-col gap-6 px-4 pb-8 pt-10 sm:flex-row sm:p-10">
          <div className="w-40 shrink-0 overflow-hidden rounded-2xl border border-border shadow-2xl shadow-black sm:w-56">
            <Poster path={movie.poster_path} alt={movie.title} size="w500" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl">{movie.title}</h1>
            {movie.title_ar && movie.title_ar !== movie.title && (
              <p className="mt-1 text-xl text-muted" dir="rtl">
                {movie.title_ar}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
              {year && <span>{year}</span>}
              {movie.runtime ? <span>· {Math.floor(movie.runtime / 60)}h {movie.runtime % 60}m</span> : null}
              {movie.genres.slice(0, 4).map((g) => (
                <Badge key={g}>{g}</Badge>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {primary && <StatusBadge status={primary.status} />}
              {movie.eg_release_date && (
                <span className="flex items-center gap-1.5 text-sm text-muted">
                  <CalendarDays className="h-4 w-4" /> Egypt release: {formatDate(movie.eg_release_date)} {movie.eg_release_date.slice(0, 4)}
                </span>
              )}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              {(bookable[0]?.booking_url ?? advanceOnline[0]?.booking_url) && (
                <a href={(bookable[0]?.booking_url ?? advanceOnline[0]?.booking_url)!} target="_blank" rel="noopener" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 font-semibold text-white shadow-lg shadow-red-900/40 hover:bg-red-500">
                  <Ticket className="h-5 w-5" /> Book tickets
                </a>
              )}
              <NotifyButton tmdbId={movie.tmdb_id} signedIn={!!user} watching={!!watch && !watch.paused} />
            </div>
            {movie.overview && <p className="mt-6 max-w-3xl leading-relaxed text-zinc-300">{movie.overview}</p>}
            {movie.overview_ar && (
              <p className="mt-3 max-w-3xl leading-relaxed text-zinc-400" dir="rtl">
                {movie.overview_ar}
              </p>
            )}
          </div>
        </div>
      </section>

      <section>
        <SectionTitle action={<AvailabilityRefresher tmdbId={movie.tmdb_id} pending={stale} />}>Booking availability in Egypt</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          {availability.map((a) => (
            <Card key={a.provider_id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{a.provider_name}</p>
                <StatusBadge status={a.status} />
              </div>
              <p className="mt-2 text-sm text-muted">
                {a.status === "provider_unavailable" || a.status === "unknown"
                  ? "Couldn't check this site from our cloud server — see the Scene & VOX showtimes below when listed."
                  : a.booking_url && !a.bookable_branches
                    ? "Advance booking open — cinema & time are chosen on the booking page"
                    : `${a.listed_branches} cinema${a.listed_branches === 1 ? "" : "s"} listing · ${a.bookable_branches} selling online`}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {a.last_success_at ? `Last verified ${formatCairo(a.last_success_at)} (Cairo)` : "Not checked yet — a check has been queued"}
                {a.status === "provider_unavailable" && a.last_error ? ` · ${a.last_error}` : ""}
              </p>
            </Card>
          ))}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          &ldquo;Bookable&rdquo; means we found a working online booking action on a supported provider. Cinemas listed without one may still sell at the box
          office or in their own app — see <a href="/providers" className="underline">coverage</a>.
        </p>
      </section>

      {advanceOnline.length > 0 && (
        <section>
          <SectionTitle>Advance booking is open</SectionTitle>
          <div className="space-y-3">
            {advanceOnline.map((a) => (
              <Card key={a.provider_id} className="flex flex-wrap items-center justify-between gap-3 border-emerald-800/60 p-4 sm:p-5">
                <div>
                  <p className="text-lg font-semibold">{a.provider_name}</p>
                  <p className="text-sm text-muted">Tickets are on sale before showtimes are published. Pick your cinema, date and time on the booking page.</p>
                  {a.last_success_at && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Booking page checked {formatCairo(a.last_success_at)}
                    </p>
                  )}
                </div>
                <a href={a.booking_url!} target="_blank" rel="noopener" className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-white hover:bg-red-500">
                  <Ticket className="h-4 w-4" /> Book now
                </a>
              </Card>
            ))}
          </div>
        </section>
      )}

      {bookable.length > 0 && (
        <section>
          <SectionTitle>Book online</SectionTitle>
          <div className="space-y-4">
            {bookable.map((b) => (
              <Card key={b.branch_id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{b.name}</p>
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <MapPin className="h-4 w-4" />
                      {[b.chain !== "Independent" ? b.chain : null, b.area, b.city].filter(Boolean).join(" · ") || "Egypt"}
                    </p>
                  </div>
                  <a href={b.booking_url!} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white hover:bg-red-500">
                    <Ticket className="h-4 w-4" /> Book now
                  </a>
                </div>
                <div className="scrollbar-none mt-4 flex gap-3 overflow-x-auto">
                  {b.days.map((d) => (
                    <div key={d.date} className="min-w-36 rounded-xl border border-border bg-surface-2/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{formatDate(d.date)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.shows.map((s) => (
                          <span key={s.time + s.experience} className="rounded-md bg-background px-2 py-1 text-xs font-medium">
                            {s.time}
                            {s.experience && s.experience !== "Standard" ? <span className="ml-1 text-accent">{s.experience}</span> : null}
                          </span>
                        ))}
                      </div>
                      {d.shows[0]?.price ? <p className="mt-2 text-xs text-muted">{d.shows[0].price} EGP</p> : null}
                    </div>
                  ))}
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                  {b.verified_at ? `Booking link verified ${formatCairo(b.verified_at)}` : `Seen on provider ${formatCairo(b.last_seen_at)}`}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {chainListed.length > 0 && (
        <section>
          <SectionTitle>Scene &amp; VOX showtimes</SectionTitle>
          <div className="space-y-4">
            {chainListed.map((b) => (
              <Card key={b.branch_id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{b.name}</p>
                    <p className="flex items-center gap-1.5 text-sm text-muted">
                      <MapPin className="h-4 w-4" />
                      {[b.chain, b.area, b.city].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <a href={officialSiteFor(b.chain, b.name)!} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-semibold hover:border-accent">
                    <ExternalLink className="h-4 w-4" /> Book on official site
                  </a>
                </div>
                <div className="scrollbar-none mt-4 flex gap-3 overflow-x-auto">
                  {b.days.map((d) => (
                    <div key={d.date} className="min-w-36 rounded-xl border border-border bg-surface-2/60 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{formatDate(d.date)}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {d.shows.map((s) => (
                          <span key={s.time + s.experience} className="rounded-md bg-background px-2 py-1 text-xs font-medium">
                            {s.time}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  Showtimes from elCinema, seen {formatCairo(b.last_seen_at)}. {b.chain} doesn&apos;t allow our cloud checker to read its booking pages, so
                  book on its website/app.
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {listedOnly.length > 0 && (
        <section>
          <SectionTitle>Also listed (no supported online booking)</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listedOnly.map((b) => (
              <Card key={b.branch_id} className="p-4">
                <p className="font-semibold">{b.name}</p>
                <p className="text-xs text-muted">{[b.chain !== "Independent" ? b.chain : null, b.area, b.city].filter(Boolean).join(" · ")}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-400">
                  <Clock className="h-3.5 w-3.5" />
                  {b.days[0] ? `${formatDate(b.days[0].date)}: ${b.days[0].shows.map((s) => s.time).join(", ")}` : ""}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      {movie.trailer_youtube_key && (
        <section>
          <SectionTitle>Trailer</SectionTitle>
          <div className="aspect-video overflow-hidden rounded-2xl border border-border">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${movie.trailer_youtube_key}`}
              title="Trailer"
              allow="encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </section>
      )}

      {movie.cast_members.length > 0 && (
        <section>
          <SectionTitle>Cast</SectionTitle>
          <div className="scrollbar-none flex gap-4 overflow-x-auto pb-2">
            {movie.cast_members.map((c) => (
              <div key={c.name + c.character} className="w-24 shrink-0 text-center">
                <div className="mx-auto h-24 w-24 overflow-hidden rounded-full border border-border bg-surface-2">
                  {c.profile_path && <Image src={`https://image.tmdb.org/t/p/w185${c.profile_path}`} alt={c.name} width={96} height={96} className="h-full w-full object-cover" />}
                </div>
                <p className="mt-2 text-xs font-semibold leading-tight">{c.name}</p>
                <p className="text-[11px] leading-tight text-muted">{c.character}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
