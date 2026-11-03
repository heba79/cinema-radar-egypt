"use client";

import { useMemo, useState } from "react";
import { MovieCard } from "@/components/movie-card";
import type { AvailabilityStatus } from "@/lib/providers/types";

type Film = {
  id: number;
  title: string;
  posterPath: string | null;
  releaseDate?: string | null;
  status?: AvailabilityStatus | null;
};
type Tab = "showing" | "soon";

export function DiscoverMovies({ showing, upcoming }: { showing: Film[]; upcoming: Film[] }) {
  const [tab, setTab] = useState<Tab>("showing");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"default" | "title" | "date">("default");
  const visible = useMemo(() => {
    const source = tab === "showing" ? showing : upcoming;
    const normalized = query.trim().toLocaleLowerCase();
    const items = source.filter((m) => m.title.toLocaleLowerCase().includes(normalized));
    if (sort === "title") items.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "date") items.sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
    return items;
  }, [tab, query, sort, showing, upcoming]);

  return (
    <section id="discover" aria-labelledby="discover-title" className="space-y-5 scroll-mt-24">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">Explore Egyptian cinema</p>
        <h2 id="discover-title" className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Find your next movie</h2>
        <p className="mt-2 text-sm text-muted">Browse releases, open a movie, and set up a booking alert.</p>
      </div>
      <label className="block">
        <span className="sr-only">Filter movies by title</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter movies by title…" autoComplete="off"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Release category" className="flex gap-2">
          {(["showing", "soon"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}
              className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${tab === value ? "border-accent bg-accent text-white" : "border-border bg-surface text-muted hover:text-foreground"}`}>
              {value === "showing" ? "Now showing" : "Coming soon"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-foreground">
            <option value="default">Featured</option>
            <option value="title">Title A–Z</option>
            <option value="date">Release date</option>
          </select>
        </label>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted">{visible.length} movie{visible.length === 1 ? "" : "s"} found</p>
      {visible.length ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {visible.map((m) => (
            <div key={m.id} className="min-w-0 [&>a]:w-full">
              <MovieCard tmdbId={m.id} title={m.title} posterPath={m.posterPath} status={m.status}
                subtitle={tab === "soon" ? (m.releaseDate ? `Release ${m.releaseDate}` : "Date TBA") : undefined} />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="font-semibold">No matching movies</p>
          <p className="mt-1 text-sm text-muted">Try a different title or switch categories.</p>
          <button type="button" onClick={() => { setQuery(""); setSort("default"); }} className="mt-4 text-sm font-semibold text-accent hover:underline">Clear filters</button>
        </div>
      )}
      <p className="text-xs text-muted">Cinema, hall, and format availability depends on verified provider data; unavailable sources are not shown as bookable.</p>
    </section>
  );
}
