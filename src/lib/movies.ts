import { q, q1 } from "./db";
import { normalizeTitle } from "./normalize";
import { arabicTranslation, bestTrailer, egyptReleaseDate, getMovie } from "./tmdb";

export interface MovieRow {
  id: string;
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  title_ar: string | null;
  original_title: string | null;
  original_language: string | null;
  overview: string | null;
  overview_ar: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  eg_release_date: string | null;
  genres: string[];
  runtime: number | null;
  trailer_youtube_key: string | null;
  cast_members: { name: string; character: string; profile_path: string | null }[];
  tmdb_synced_at: string;
}

const STALE_MS = 12 * 3600_000;

/** Get (or import/refresh) a movie by TMDB id, storing metadata and aliases. */
export async function ensureMovie(tmdbId: number): Promise<MovieRow> {
  const existing = await q1<MovieRow>("select * from movies where tmdb_id = $1", [tmdbId]);
  if (existing && Date.now() - new Date(existing.tmdb_synced_at).getTime() < STALE_MS) return existing;

  const m = await getMovie(tmdbId);
  const ar = arabicTranslation(m);
  const row = await q1<MovieRow>(
    `insert into movies (tmdb_id, imdb_id, title, title_ar, original_title, original_language, overview, overview_ar,
        poster_path, backdrop_path, release_date, eg_release_date, genres, runtime, trailer_youtube_key, cast_members, popularity, tmdb_synced_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     on conflict (tmdb_id) do update set
        imdb_id = excluded.imdb_id, title = excluded.title, title_ar = coalesce(excluded.title_ar, movies.title_ar),
        original_title = excluded.original_title, original_language = excluded.original_language,
        overview = excluded.overview, overview_ar = excluded.overview_ar, poster_path = excluded.poster_path,
        backdrop_path = excluded.backdrop_path, release_date = excluded.release_date,
        eg_release_date = coalesce(movies.eg_release_date, excluded.eg_release_date),
        genres = excluded.genres, runtime = excluded.runtime, trailer_youtube_key = excluded.trailer_youtube_key,
        cast_members = excluded.cast_members, popularity = excluded.popularity, tmdb_synced_at = now()
     returning *`,
    [
      m.id,
      m.imdb_id || null,
      m.title,
      ar?.title || null,
      m.original_title,
      m.original_language,
      m.overview || null,
      ar?.overview || null,
      m.poster_path ?? null,
      m.backdrop_path ?? null,
      m.release_date || null,
      egyptReleaseDate(m) ?? null,
      m.genres.map((g) => g.name),
      m.runtime ?? null,
      bestTrailer(m) ?? null,
      JSON.stringify(
        (m.credits?.cast ?? []).slice(0, 12).map((c) => ({ name: c.name, character: c.character, profile_path: c.profile_path })),
      ),
      m.popularity ?? null,
    ],
  );

  const aliases = new Map<string, { alias: string; lang: string | null; source: string }>();
  const add = (alias: string | undefined | null, lang: string | null, source: string) => {
    if (!alias) return;
    const n = normalizeTitle(alias);
    if (n && !aliases.has(n)) aliases.set(n, { alias, lang, source });
  };
  add(m.title, "en", "tmdb");
  add(m.original_title, m.original_language, "tmdb");
  add(ar?.title, "ar", "tmdb");
  for (const t of m.alternative_titles?.titles ?? []) if (["EG", "US", "GB", "SA", "AE", ""].includes(t.iso_3166_1)) add(t.title, null, "tmdb_alt");
  for (const [n, a] of aliases) {
    await q(
      `insert into movie_aliases (movie_id, alias, normalized, lang, source) values ($1,$2,$3,$4,$5)
       on conflict (movie_id, normalized) do nothing`,
      [row!.id, a.alias, n, a.lang, a.source],
    );
  }
  return row!;
}

export async function movieByTmdb(tmdbId: number) {
  return q1<MovieRow>("select * from movies where tmdb_id = $1", [tmdbId]);
}
