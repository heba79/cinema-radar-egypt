import { politeFetch, politeFetchText } from "../../http";
import type { CatalogEntry, ProviderAdapter } from "../types";
import {
  ELCINEMA_ORIGIN,
  looksLikeBookingPage,
  parseArabicTitle,
  parseBookableIndex,
  parseTheaterPage,
  parseWorkList,
  parseWorkPage,
  parseWorkTheaters,
} from "./parse";

// robots.txt: "User-agent: * / Allow: /" (checked at runtime too). We still keep
// a 3 s gap between requests to the host, well above bingbot's Crawl-delay: 10
// averaged across a 5-minute polling cycle.
const GAP_MS = Number(process.env.ELCINEMA_MIN_GAP_MS ?? 3000);
const get = (path: string) => politeFetchText(`${ELCINEMA_ORIGIN}${path}`, { minGapMs: GAP_MS });

export const elcinema: ProviderAdapter = {
  id: "elcinema",
  // Exactly the "tickets" href shown on /en/available_for_booking/ (verified before alerting).
  movieBookingUrl: (id) => `${ELCINEMA_ORIGIN}/en/booking/${id}/`,
  onlineBookingName: "elCinema online booking",

  async fetchBookableIndex() {
    return new Set(parseBookableIndex(await get("/en/available_for_booking/")).map((e) => e.externalId));
  },

  async fetchCatalog() {
    const [bookable, now, soon] = [
      parseBookableIndex(await get("/en/available_for_booking/")),
      parseWorkList(await get("/en/now/eg/"), "inNowPlaying"),
      parseWorkList(await get("/en/soon/eg/"), "inComingSoon"),
    ];
    const merged = new Map<string, CatalogEntry>();
    for (const e of [...bookable, ...now, ...soon]) {
      const prev = merged.get(e.externalId);
      merged.set(e.externalId, { ...prev, ...e, titleEn: prev?.titleEn ?? e.titleEn, posterUrl: prev?.posterUrl ?? e.posterUrl });
    }
    return [...merged.values()];
  },

  async fetchWorkDetails(id) {
    const details = parseWorkPage(await get(`/en/work/${id}/`), id);
    details.titleAr = parseArabicTitle(await get(`/work/${id}/`));
    return details;
  },

  async fetchMovieListing(id) {
    const path = `/en/work/${id}/theater/eg`;
    return parseWorkTheaters(await get(path), id, `${ELCINEMA_ORIGIN}${path}`);
  },

  async fetchBranchDetails(id) {
    return parseTheaterPage(await get(`/en/theater/${id}/`), id);
  },

  async probe() {
    try {
      const n = (await this.fetchBookableIndex!()).size;
      return { ok: true, detail: `${n} titles currently bookable on elCinema` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  },

  async verifyBookingUrl(url) {
    const m = url.match(/^https:\/\/elcinema\.com\/en\/booking\/(\d+)(?:\/(\d+))?\/?$/);
    if (!m) return false;
    try {
      const res = await politeFetch(url, { minGapMs: GAP_MS, retries: 1 });
      const html = await res.text();
      // must not have been redirected elsewhere (e.g. a removed booking → home page)
      const sameUrl = new URL(res.url).pathname.replace(/\/$/, "") === new URL(url).pathname.replace(/\/$/, "");
      if (!sameUrl) {
        console.log(`[elcinema] booking link redirected away: ${url} → ${res.url}`);
        return false;
      }
      if (html.includes('id="defaults"')) return looksLikeBookingPage(html, m[1], m[2]);
      // Outside Egypt (our cloud region) elCinema serves a generic page without the booking
      // form, so the content can't be checked from here. The link was taken from elCinema's
      // own "tickets" button in this same check and still opens (HTTP 200, no redirect).
      console.log(`[elcinema] booking page is geo-limited; accepting observed link ${url}`);
      return true;
    } catch (e) {
      console.log(`[elcinema] booking page fetch error: ${(e as Error).message}`);
      return false;
    }
  },
};
