import { politeFetchText } from "../../http";
import type { CatalogEntry, ProviderAdapter } from "../types";
import { isVoxBookingUrl, parseMovieList, parseMoviePage, VOX_BRANCHES, VOX_ORIGIN } from "./parse";

// 10 s between requests: VOX has no published crawl-delay, so be conservative.
const GAP_MS = Number(process.env.VOX_MIN_GAP_MS ?? 10_000);
// VOX is often unreachable for minutes at a time: fail fast (≤ ~45 s) and let the job's
// backoff retry later, so one outage can't eat a whole serverless tick.
const get = (path: string) => politeFetchText(`${VOX_ORIGIN}${path}`, { minGapMs: GAP_MS, timeoutMs: 20_000, retries: 1 });

export const vox: ProviderAdapter = {
  id: "vox-egypt",
  defaultChain: "VOX Cinemas",
  catalogHasDetails: true, // titles (+ release dates for coming soon) come from the list pages
  branchLocation: (name) => VOX_BRANCHES[name],

  async fetchCatalog() {
    const now = parseMovieList(await get("/movies/whatson"), "inNowPlaying");
    const soon = parseMovieList(await get("/movies/comingsoon"), "inComingSoon");
    const merged = new Map<string, CatalogEntry>();
    for (const e of [...now, ...soon]) merged.set(e.externalId, { ...merged.get(e.externalId), ...e });
    return [...merged.values()];
  },

  async fetchWorkDetails(slug) {
    return parseMoviePage(await get(`/movies/${slug}`), slug).details;
  },

  async fetchMovieListing(slug) {
    return parseMoviePage(await get(`/movies/${slug}`), slug).listing;
  },

  async probe() {
    try {
      const n = parseMovieList(await get("/movies/whatson"), "inNowPlaying").length;
      return { ok: true, detail: `${n} titles on VOX Egypt what's on` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },

  // robots.txt disallows */booking/, so the link is never fetched. It is only
  // accepted when it was observed on the official movie page in this same check
  // and matches VOX's session URL format.
  async verifyBookingUrl(url) {
    return isVoxBookingUrl(url);
  },
};
