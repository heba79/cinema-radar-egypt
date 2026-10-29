// TMDB is used ONLY for metadata (titles, posters, cast, trailers, release
// dates). It is never used to decide whether tickets can be booked in Egypt.
import { env } from "./env";
import { hasArabic } from "./normalize";

const BASE = "https://api.themoviedb.org/3";
export const TMDB_IMG = "https://image.tmdb.org/t/p";

export interface TmdbSearchItem {
  id: number;
  title: string;
  original_title: string;
  original_language: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  popularity?: number;
}

export interface TmdbMovie extends TmdbSearchItem {
  imdb_id?: string | null;
  runtime?: number | null;
  genres: { id: number; name: string }[];
  credits?: { cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[] };
  videos?: { results: { key: string; site: string; type: string; official: boolean; iso_639_1: string }[] };
  release_dates?: { results: { iso_3166_1: string; release_dates: { release_date: string; type: number }[] }[] };
  alternative_titles?: { titles: { iso_3166_1: string; title: string }[] };
  translations?: { translations: { iso_639_1: string; data: { title?: string; overview?: string } }[] };
}

async function tmdb<T>(path: string, params: Record<string, string> = {}, revalidate = 3600): Promise<T> {
  const e = env();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: "application/json" };
  if (e.TMDB_READ_TOKEN) headers.authorization = `Bearer ${e.TMDB_READ_TOKEN}`;
  else if (e.TMDB_API_KEY) url.searchParams.set("api_key", e.TMDB_API_KEY);
  else throw new Error("TMDB credentials missing (TMDB_READ_TOKEN or TMDB_API_KEY)");

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers, next: { revalidate } } as RequestInit);
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    throw new Error(`TMDB ${res.status} ${path}`);
  }
}

/** Search in both languages; Arabic queries search ar-EG first. Deduplicated by TMDB id. */
export async function searchMovies(query: string): Promise<TmdbSearchItem[]> {
  const langs = hasArabic(query) ? ["ar-EG", "en-US"] : ["en-US", "ar-EG"];
  const results = await Promise.all(
    langs.map((language) =>
      tmdb<{ results: TmdbSearchItem[] }>("/search/movie", { query, language, include_adult: "false", region: "EG" }, 600),
    ),
  );
  const byId = new Map<number, TmdbSearchItem>();
  for (const item of results.flatMap((r) => r.results)) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0)).slice(0, 12);
}

export async function getMovie(id: number): Promise<TmdbMovie> {
  return tmdb<TmdbMovie>(`/movie/${id}`, {
    language: "en-US",
    append_to_response: "credits,videos,release_dates,alternative_titles,translations",
    include_video_language: "en,ar,null",
  });
}

export const trending = () => tmdb<{ results: TmdbSearchItem[] }>("/trending/movie/week", { language: "en-US" }).then((r) => r.results);
export const upcomingEG = () =>
  tmdb<{ results: TmdbSearchItem[] }>("/movie/upcoming", { language: "en-US", region: "EG" }).then((r) => r.results);
export const nowPlayingEG = () =>
  tmdb<{ results: TmdbSearchItem[] }>("/movie/now_playing", { language: "en-US", region: "EG" }).then((r) => r.results);

/** Lookup by IMDb id — used to attach TMDB metadata to provider listings. */
export async function findByImdb(imdbId: string): Promise<TmdbSearchItem | null> {
  const r = await tmdb<{ movie_results: TmdbSearchItem[] }>(`/find/${imdbId}`, { external_source: "imdb_id" }, 86400);
  return r.movie_results[0] ?? null;
}

export function egyptReleaseDate(m: TmdbMovie): string | undefined {
  const eg = m.release_dates?.results.find((r) => r.iso_3166_1 === "EG");
  const theatrical = eg?.release_dates.filter((d) => d.type === 3 || d.type === 2) ?? [];
  return (theatrical[0] ?? eg?.release_dates[0])?.release_date?.slice(0, 10);
}

export function arabicTranslation(m: TmdbMovie) {
  return m.translations?.translations.find((t) => t.iso_639_1 === "ar")?.data;
}

export function bestTrailer(m: TmdbMovie): string | undefined {
  const vids = (m.videos?.results ?? []).filter((v) => v.site === "YouTube");
  return (vids.find((v) => v.type === "Trailer" && v.official) ?? vids.find((v) => v.type === "Trailer") ?? vids[0])?.key;
}

export const poster = (path?: string | null, size = "w500") => (path ? `${TMDB_IMG}/${size}${path}` : null);
