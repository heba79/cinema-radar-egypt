import { politeFetch, politeFetchText, ProviderHttpError } from "../../http";
import type { CatalogEntry, MovieListing, ProviderAdapter } from "../types";
import {
  isSceneBookingUrl,
  looksLikeSceneBookingPage,
  parseHome,
  parseMoviePage,
  parseShowtimes,
  SCENE_BRANCHES,
  sceneOrigin,
  toSceneDate,
  type SceneBranch,
} from "./parse";

const GAP_MS = Number(process.env.SCENE_MIN_GAP_MS ?? 5000);
const get = (url: string) => politeFetchText(url, { minGapMs: GAP_MS, timeoutMs: 30_000 });
const BRANCHES = Object.keys(SCENE_BRANCHES) as SceneBranch[];

const MAX_DAYS = Number(process.env.SCENE_MAX_DAYS ?? 7);

/**
 * Every day in the movie page's date picker, with its sessions. The picker lists only
 * the days this movie plays at this branch (e.g. 17–23 Dec for an advance release), but
 * a listed day counts for nothing until its own request returns sessions with
 * "Buy Tickets" links. The page's "There is no showtimes available" heading is a hidden
 * template and is ignored.
 */
export async function readBranchDays(html: string, fetchDay: (date: string) => Promise<string>) {
  const page = parseMoviePage(html);
  const out: { date: string; shows: ReturnType<typeof parseShowtimes> }[] = [];
  for (const date of page.days.slice(0, MAX_DAYS)) {
    // the day rendered in the page itself needs no extra request
    let shows = date === page.activeDate && /calanderdays\s+active/.test(html) ? parseShowtimes(html, date) : [];
    if (!shows.length) shows = parseShowtimes(await fetchDay(date), date);
    out.push({ date, shows });
  }
  return out;
}

// External id = movie slug. Branch sites share slugs, and a branch may sell a film
// (e.g. advance booking) before listing it on its home page, so every check looks
// the slug up at every branch.
export const scene: ProviderAdapter = {
  id: "scene",
  defaultChain: "Scene Cinemas",
  catalogHasDetails: true,
  branchLocation: (name) => Object.values(SCENE_BRANCHES).find((b) => b.name === name),

  async fetchCatalog() {
    const out = new Map<string, CatalogEntry>();
    for (const branch of BRANCHES) {
      for (const m of parseHome(await get(`${sceneOrigin(branch)}/`), branch)) {
        if (!out.has(m.slug)) out.set(m.slug, { externalId: m.slug, titleEn: m.title, posterUrl: m.posterUrl, inNowPlaying: true });
      }
    }
    return [...out.values()];
  },

  async fetchMovieListing(slug) {
    if (!/^[a-z0-9_-]+$/.test(slug)) throw new Error(`bad Scene slug ${slug}`);
    const listing: MovieListing = { externalId: slug, sourceUrl: `${sceneOrigin("cfc")}/movie-details/${slug}.html`, branches: [], showtimes: [] };
    for (const branch of BRANCHES) {
      const url = `${sceneOrigin(branch)}/movie-details/${slug}.html`;
      let html: string;
      try {
        html = await get(url);
      } catch (e) {
        if (e instanceof ProviderHttpError && e.status === 404) continue; // not shown at this branch
        if (e instanceof ProviderHttpError && e.status === 403)
          throw new ProviderHttpError(`blocked by Scene's Cloudflare firewall (HTTP 403) — this server's network is refused`, 403, false);
        throw e;
      }
      const days = await readBranchDays(html, (date) => get(`${url}?business_day=${toSceneDate(date)}&ajax=1`));
      const shows = days.flatMap((d) => d.shows.map((s) => ({ ...s, date: d.date })));
      if (!shows.length) continue;
      const b = { externalId: branch, name: SCENE_BRANCHES[branch].name, url: `${sceneOrigin(branch)}/` };
      listing.branches.push({ ...b, bookingUrl: shows.find((s) => s.bookingUrl)?.bookingUrl });
      for (const s of shows)
        listing.showtimes.push({ branch: b, businessDate: s.date, time: s.time, startsAt: s.startsAt, experience: s.experience, bookingUrl: s.bookingUrl });
    }
    return listing;
  },

  async probe() {
    try {
      const n = parseHome(await get(`${sceneOrigin("cfc")}/`), "cfc").length;
      return { ok: true, detail: `${n} titles at Scene Cairo Festival City` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },

  // Opening the session page is read-only (seat selection needs a further click).
  async verifyBookingUrl(url) {
    if (!isSceneBookingUrl(url)) return false;
    try {
      const res = await politeFetch(url, { minGapMs: GAP_MS, retries: 1 });
      return looksLikeSceneBookingPage(await res.text());
    } catch {
      return false;
    }
  },
};
