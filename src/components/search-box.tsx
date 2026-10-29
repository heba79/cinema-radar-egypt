"use client";
import { Loader2, Search } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "./ui";

interface Hit {
  id: number;
  title: string;
  original_title: string;
  release_date?: string;
  poster_path?: string | null;
}

export function SearchBox({ autoFocus, large }: { autoFocus?: boolean; large?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Search failed");
        setHits(data.results);
        setOpen(true);
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const go = (h: Hit) => {
    setOpen(false);
    router.push(`/movie/${h.id}`);
  };

  return (
    <div ref={boxRef} className="relative w-full">
      <div className="relative">
        <Search className={cn("pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500", large ? "h-5 w-5" : "h-4 w-4")} />
        <input
          autoFocus={autoFocus}
          value={query}
          dir="auto"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && hits.length) go(hits[Math.max(active, 0)]);
            else if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Search a movie · ابحث عن فيلم"
          aria-label="Search movies"
          role="combobox"
          aria-expanded={open}
          aria-controls="movie-search-results"
          className={cn(
            "w-full rounded-full border border-border bg-surface-2/90 pl-12 pr-12 text-foreground shadow-xl shadow-black/30 placeholder:text-zinc-500 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20",
            large ? "h-14 text-base sm:h-16 sm:text-lg" : "h-11 text-sm",
          )}
        />
        {loading && <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-zinc-500" />}
      </div>
      {open && (hits.length > 0 || error) && (
        <ul id="movie-search-results" role="listbox" className="absolute z-50 mt-2 max-h-[60vh] w-full overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-2xl shadow-black/60">
          {error && <li className="p-3 text-sm text-red-400">{error}</li>}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cn("flex w-full items-center gap-3 rounded-xl p-2 text-left transition", i === active ? "bg-surface-2" : "hover:bg-surface-2")}
              >
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-2">
                  {h.poster_path && <Image src={`https://image.tmdb.org/t/p/w92${h.poster_path}`} alt="" width={40} height={56} className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-medium" dir="auto">
                    {h.title}
                  </p>
                  <p className="truncate text-xs text-muted" dir="auto">
                    {h.release_date?.slice(0, 4) || "TBA"}
                    {h.original_title !== h.title ? ` · ${h.original_title}` : ""}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
