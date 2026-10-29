// Pure decision logic: availability status, change detection and movie matching.
import { normalizeTitle, similarity, translitKey } from "./normalize";
import type { AvailabilityStatus } from "./providers/types";

export const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  upcoming: "Upcoming",
  released_not_listed: "Released — no Egyptian cinema listing found",
  listed_not_bookable: "Listed at cinemas — online booking not open",
  advance_booking: "Advance booking available",
  bookable_now: "Tickets available now",
  no_longer_listed: "No longer listed",
  provider_unavailable: "Provider temporarily unavailable",
  unknown: "Availability unknown",
};

export const BOOKABLE: AvailabilityStatus[] = ["advance_booking", "bookable_now"];

export interface StatusInput {
  today: string; // YYYY-MM-DD Cairo
  providerOk: boolean;
  linked: boolean; // the provider knows this movie (matched in its catalog)
  everListed: boolean;
  listings: { isBookable: boolean; showDate: string }[]; // current, future-or-today screenings
  egReleaseDate?: string | null;
  releaseDate?: string | null;
  /** Provider shows a real booking action for the movie, but no dated showtimes yet (advance booking). */
  bookableWithoutShowtimes?: boolean;
}

export function computeStatus(i: StatusInput): AvailabilityStatus {
  if (!i.providerOk) return "provider_unavailable";
  const upcoming = i.listings.filter((l) => l.showDate >= i.today);
  const bookable = upcoming.filter((l) => l.isBookable);
  if (!bookable.length && i.bookableWithoutShowtimes) {
    const release = i.egReleaseDate ?? i.releaseDate;
    return release && release <= i.today ? "bookable_now" : "advance_booking";
  }
  if (bookable.length) {
    const release = i.egReleaseDate ?? i.releaseDate;
    const earliestShow = bookable.reduce((m, l) => (l.showDate < m ? l.showDate : m), bookable[0].showDate);
    // Advance booking: tickets on sale before the movie opens in Egypt.
    if ((release && release > i.today) || earliestShow > i.today) return "advance_booking";
    return "bookable_now";
  }
  if (upcoming.length) return "listed_not_bookable";
  if (i.everListed) return "no_longer_listed";
  const release = i.egReleaseDate ?? i.releaseDate;
  if (release && release > i.today) return "upcoming";
  if (release) return "released_not_listed";
  return i.linked ? "released_not_listed" : "unknown";
}

export type EventType = "advance_booking_opened" | "booking_opened" | "new_branch";

export interface DetectedEvent {
  type: EventType;
  branchExternalIds: string[];
  dedupeKey: string;
}

/**
 * Decide what a check should alert about — at most ONE event per check, listing
 * every branch that newly started selling.
 * - nothing alerted yet for this movie → advance_booking_opened / booking_opened (once per movie+provider)
 * - later branches that start selling → new_branch
 * `notifiedBranches` are branches already alerted about, so flapping never re-alerts.
 */
export function detectEvents(args: {
  movieId: string;
  providerId: string;
  status: AvailabilityStatus;
  notifiedBranches: Set<string>;
  bookableBranchesNow: string[];
  /** Another provider already sent the "opened" alert for this movie. */
  alertedElsewhere?: boolean;
}): DetectedEvent | null {
  if (!BOOKABLE.includes(args.status)) return null;
  const fresh = [...new Set(args.bookableBranchesNow)].filter((b) => !args.notifiedBranches.has(b)).sort();
  if (!fresh.length) return null;
  const base = `${args.providerId}:${args.movieId}`;
  if (!args.notifiedBranches.size && !args.alertedElsewhere) {
    const type: EventType = args.status === "advance_booking" ? "advance_booking_opened" : "booking_opened";
    // One "opened" alert per movie, whichever provider sees it first.
    return { type, branchExternalIds: fresh, dedupeKey: `movie:${args.movieId}:opened` };
  }
  return { type: "new_branch", branchExternalIds: fresh, dedupeKey: `${base}:branches:${fresh.join(",")}` };
}

// --- matching TMDB movie <-> provider catalog entry ----------------------------

export interface MatchCandidate {
  externalId: string;
  titleEn?: string | null;
  titleAr?: string | null;
  imdbId?: string | null;
  year?: number | null;
}

export interface MatchTarget {
  imdbId?: string | null;
  titles: string[]; // all known aliases (en/ar/original)
  year?: number | null;
}

export function matchMovie(target: MatchTarget, candidates: MatchCandidate[]): { candidate: MatchCandidate; method: "imdb" | "title_year"; confidence: number } | null {
  if (target.imdbId) {
    const byImdb = candidates.find((c) => c.imdbId && c.imdbId === target.imdbId);
    if (byImdb) return { candidate: byImdb, method: "imdb", confidence: 1 };
  }
  const scored = candidates
    .map((c) => {
      // If both sides have IMDb ids and they differ, it's a different movie.
      if (target.imdbId && c.imdbId && c.imdbId !== target.imdbId) return { c, score: 0 };
      let best = 0;
      for (const t of target.titles) {
        for (const ct of [c.titleEn, c.titleAr]) {
          if (!ct) continue;
          const exact = normalizeTitle(t) === normalizeTitle(ct) || (translitKey(t).length > 3 && translitKey(t) === translitKey(ct));
          best = Math.max(best, exact ? 1 : similarity(t, ct));
        }
      }
      // Year must agree when both known (remakes share titles: "Sense and Sensibility" 1995 vs 2026).
      if (target.year && c.year && Math.abs(target.year - c.year) > 1) best = 0;
      if (!c.year || !target.year) best *= 0.9;
      return { c, score: best };
    })
    .filter((s) => s.score >= 0.85)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  // Ambiguous: two candidates nearly as good → refuse rather than guess.
  if (scored[1] && scored[0].score - scored[1].score < 0.05) return null;
  return { candidate: scored[0].c, method: "title_year", confidence: Number(scored[0].score.toFixed(3)) };
}
