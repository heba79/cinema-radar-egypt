// Pure parsers for egy.voxcinemas.com. robots.txt allows /movies/* but disallows
// */booking/ and any URL with a query string, so we only read the default movie
// page — which shows the FIRST date that has sessions (today, or the first
// advance-booking date) — and never request booking pages.
import * as cheerio from "cheerio";
import { addDays, cairoToday, parseShowtime } from "../../time";
import type { CatalogEntry, MovieListing, ObservedShowtime, WorkDetails } from "../types";

export const VOX_ORIGIN = "https://egy.voxcinemas.com";
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// The three VOX Egypt sites; city/area are not on the page.
export const VOX_BRANCHES: Record<string, { city: string; area: string }> = {
  "City Centre Alexandria": { city: "Alexandria", area: "Alexandria" },
  "City Centre Almaza": { city: "Cairo", area: "Heliopolis" },
  "Mall of Egypt": { city: "Giza", area: "6th of October" },
};

export function isVoxBookingUrl(href: string | undefined): href is string {
  return !!href && /^https:\/\/egy\.voxcinemas\.com\/booking\/\d{4}-\d+$/.test(href);
}

/** Title without VOX's format/language suffixes, for matching. "Hope (Korean)" → "Hope". */
export function baseTitle(title: string) {
  return title.replace(/\s*\((arabic|korean|hindi|tamil|malayalam|infinity vision|imax|3d|4dx|encore|re-?release)\)\s*/gi, " ").trim();
}

/** /movies/whatson and /movies/comingsoon: article.movie-summary cards. */
export function parseMovieList(html: string, flag: "inNowPlaying" | "inComingSoon"): (CatalogEntry & { releaseDate?: string })[] {
  const $ = cheerio.load(html);
  const out = new Map<string, CatalogEntry & { releaseDate?: string }>();
  $("article.movie-summary[data-slug]").each((_, a) => {
    const slug = $(a).attr("data-slug")!;
    const title = clean($(a).attr("data-title")) || clean($(a).find("h3 a").clone().children().remove().end().text());
    const rel = clean($(a).find("p").text()).match(/Release Date:\s*(\d{1,2}) (\w+) (\d{4})/);
    out.set(slug, {
      externalId: slug,
      titleEn: title,
      posterUrl: $(a).find("img").attr("data-src") ?? $(a).find("img").attr("src"),
      releaseDate: rel ? toIso(rel[1], rel[2], rel[3]) : undefined,
      [flag]: true,
    });
  });
  return [...out.values()];
}

function toIso(d: string, mon: string, y: string) {
  const m = MONTHS[mon.slice(0, 3).toLowerCase()];
  return m ? `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}` : undefined;
}

/** "Today" / "Tomorrow" / "Thu 17 Dec" → ISO date, relative to Cairo today. */
export function resolveDateLabel(label: string, today = cairoToday()): string | undefined {
  const l = clean(label).toLowerCase();
  if (l === "today") return today;
  if (l === "tomorrow") return addDays(today, 1);
  const m = l.match(/(\d{1,2})\s+([a-z]{3})/);
  if (!m) return undefined;
  const month = MONTHS[m[2]];
  if (!month) return undefined;
  let year = Number(today.slice(0, 4));
  // Dates roll into next year (e.g. viewing in December, showing in January).
  if (month < Number(today.slice(5, 7)) - 1) year++;
  return `${year}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export interface VoxMoviePage {
  details: WorkDetails;
  listing: MovieListing;
  /** Other dates offered in the date picker (sessions exist, times not fetched — query URLs are disallowed). */
  otherDates: string[];
}

export function parseMoviePage(html: string, slug: string, today = cairoToday()): VoxMoviePage {
  const $ = cheerio.load(html);
  const sourceUrl = `${VOX_ORIGIN}/movies/${slug}`;
  const title = clean($("img.poster").attr("alt")) || clean($("h1").first().text());
  const rel = clean($("aside").text()).match(/Release Date:\s*(\d{1,2}) (\w+) (\d{4})/);
  const egReleaseDate = rel ? toIso(rel[1], rel[2], rel[3]) : undefined;

  const dateItems = $("#showtimes nav.date-filter li");
  const currentLabel = clean(dateItems.find("span").first().text());
  const businessDate = resolveDateLabel(currentLabel, today);
  const otherDates = dateItems
    .find("a")
    .map((_, a) => $(a).attr("href")?.match(/d(?:=|&#x3D;)(\d{8})/)?.[1])
    .get()
    .filter(Boolean)
    .map((d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`);

  const showtimes: ObservedShowtime[] = [];
  const branches = new Map<string, MovieListing["branches"][number]>();
  if (businessDate) {
    $("#showtimes .dates h3").each((_, h3) => {
      const name = clean($(h3).text());
      const list = $(h3).nextAll("ol.showtimes").first();
      list.children("li").each((_, expLi) => {
        const experience = clean($(expLi).children("strong").first().text());
        $(expLi)
          .find("a.showtime")
          .each((_, a) => {
            const href = $(a).attr("href");
            const sessionId = $(a).attr("data-id") ?? "";
            const cinemaCode = sessionId.split("-")[0];
            if (!cinemaCode) return;
            const branch = { externalId: cinemaCode, name, url: `${VOX_ORIGIN}/` };
            const bookingUrl = isVoxBookingUrl(href) ? href : undefined;
            const prev = branches.get(cinemaCode);
            branches.set(cinemaCode, { ...branch, bookingUrl: prev?.bookingUrl ?? bookingUrl });
            const parsed = parseShowtime(businessDate, clean($(a).text()).replace(/(am|pm)$/i, " $1"));
            if (!parsed) return;
            showtimes.push({ branch, businessDate, time: parsed.display, startsAt: parsed.startsAt, experience, bookingUrl });
          });
      });
    });
  }
  return {
    details: { externalId: slug, titleEn: title, year: egReleaseDate ? Number(egReleaseDate.slice(0, 4)) : undefined, egReleaseDate },
    listing: { externalId: slug, sourceUrl, showtimes, branches: [...branches.values()] },
    otherDates,
  };
}
