// Pure HTML parsers for elcinema.com pages. Kept free of network code so they
// can be tested against saved fixtures (tests/fixtures/elcinema-*.html).
import * as cheerio from "cheerio";
import { parseShowtime } from "../../time";
import type { BranchDetails, CatalogEntry, MovieListing, ObservedShowtime, WorkDetails } from "../types";

export const ELCINEMA_ORIGIN = "https://elcinema.com";

const abs = (href: string) => new URL(href, ELCINEMA_ORIGIN).toString();
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const workIdFrom = (href: string | undefined) => href?.match(/\/work\/(\d+)/)?.[1];
const theaterIdFrom = (href: string | undefined) => href?.match(/\/theater\/(\d{5,})/)?.[1];

/** A booking href is only accepted when it points at elCinema's own booking flow. */
export function isElcinemaBookingHref(href: string | undefined): href is string {
  return !!href && /^\/(en\/)?booking\/\d+(\/\d+)?\/?$/.test(href);
}

/** /en/available_for_booking/ → set of work ids with an active "tickets" action. */
export function parseBookableIndex(html: string): CatalogEntry[] {
  const $ = cheerio.load(html);
  const out = new Map<string, CatalogEntry>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!isElcinemaBookingHref(href)) return;
    const id = href.match(/booking\/(\d+)/)![1];
    const li = $(a).closest("li").parent().closest("li");
    const title = clean(li.find(`a[href="/en/work/${id}/"]`).last().text());
    const poster = li.find("img").attr("data-src");
    out.set(id, { externalId: id, titleEn: title || undefined, posterUrl: poster, inBookable: true });
  });
  return [...out.values()];
}

/** /en/now/eg/ and /en/soon/eg/ list pages: rows with id="w<workId>". */
export function parseWorkList(html: string, flag: "inNowPlaying" | "inComingSoon"): CatalogEntry[] {
  const $ = cheerio.load(html);
  const out: CatalogEntry[] = [];
  $("div.row[id^=w]").each((_, row) => {
    const id = $(row).attr("id")!.slice(1);
    if (!/^\d+$/.test(id)) return;
    const title = clean($(row).find("h3 a").first().text());
    const poster = $(row).find("img").attr("data-src");
    out.push({ externalId: id, titleEn: title || undefined, posterUrl: poster, [flag]: true });
  });
  return out;
}

/** /en/work/<id>/ — IMDb id, Egyptian release date, title. */
export function parseWorkPage(html: string, externalId: string): WorkDetails {
  const $ = cheerio.load(html);
  const imdbId = html.match(/imdb\.com\/title\/(tt\d+)/)?.[1];
  const ogTitle = $('meta[property="og:title"]').attr("content") ?? $("title").text();
  // "Movie - Sense and Sensibility - 2026 Watch Online..." / "فيلم - X - 2026 مشاهدة..."
  const m = ogTitle.match(/^[^-]+-\s*(.+?)\s*-\s*(\d{4})\b/);
  let egReleaseDate: string | undefined;
  $("li").each((_, li) => {
    const text = clean($(li).text());
    if (egReleaseDate || !/Release Date:/.test(text) || !/\(Egypt\)/.test(text)) return;
    const day = $(li).find('a[href*="release_day/"]').attr("href")?.match(/release_day\/(\d{2})-(\d{2})/);
    const year = $(li).find('a[href*="release_year/"]').attr("href")?.match(/release_year\/(\d{4})/);
    if (day && year) egReleaseDate = `${year[1]}-${day[1]}-${day[2]}`;
  });
  return {
    externalId,
    titleEn: m?.[1],
    imdbId,
    year: m ? Number(m[2]) : undefined,
    egReleaseDate,
  };
}

/** Arabic work page (/work/<id>/) → Arabic title. */
export function parseArabicTitle(html: string): string | undefined {
  const $ = cheerio.load(html);
  const t = $('meta[property="og:title"]').attr("content") ?? $("title").text();
  return t.match(/^[^-]+-\s*(.+?)\s*-\s*\d{4}\b/)?.[1];
}

/**
 * /en/work/<id>/theater/eg — every Egyptian cinema listing the movie, per date
 * tab, with showtimes and (only where elCinema sells tickets) a booking button.
 */
export function parseWorkTheaters(html: string, externalId: string, sourceUrl: string): MovieListing {
  const $ = cheerio.load(html);
  const showtimes: ObservedShowtime[] = [];
  const branches = new Map<string, MovieListing["branches"][number]>();

  $('div.content[id^="wtheater"]').each((_, tab) => {
    const ymd = $(tab).attr("id")!.replace("wtheater", "");
    if (!/^\d{8}$/.test(ymd)) return;
    const businessDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

    $(tab)
      .children("div.row")
      .each((_, row) => {
        const link = $(row).find('a[href*="/theater/"]').filter((_, a) => !!theaterIdFrom($(a).attr("href"))).first();
        const branchId = theaterIdFrom(link.attr("href"));
        if (!branchId) return;
        const branch = { externalId: branchId, name: clean(link.text()), url: abs(`/en/theater/${branchId}/`) };
        const bookingHref = $(row)
          .find("a[href]")
          .map((_, a) => $(a).attr("href"))
          .get()
          .find(isElcinemaBookingHref);
        const bookingUrl = bookingHref ? abs(bookingHref) : undefined;
        const prev = branches.get(branchId);
        branches.set(branchId, { ...branch, bookingUrl: prev?.bookingUrl ?? bookingUrl });

        $(row)
          .find("ul.list-separator > li")
          .each((_, li) => {
            if ($(li).find("a").length) return; // "...More" toggle
            const parsed = parseShowtime(businessDate, clean($(li).text()));
            if (!parsed) return;
            showtimes.push({
              branch,
              businessDate,
              time: parsed.display,
              startsAt: parsed.startsAt,
              experience: "",
              bookingUrl,
            });
          });
      });
  });

  return { externalId, sourceUrl, showtimes, branches: [...branches.values()] };
}

/** /en/theater/<id>/ — address/city from breadcrumbs, plus today's per-movie experiences & prices. */
export function parseTheaterPage(html: string, externalId: string): BranchDetails {
  const $ = cheerio.load(html);
  const crumbs = $("ul.breadcrumbs li a")
    .map((_, a) => ({ href: $(a).attr("href") ?? "", text: clean($(a).text()) }))
    .get();
  // /en/theater/1 (country) → /en/theater/1/<city> → /en/theater/1/<city>/<area>
  const city = crumbs.find((c) => /^\/en\/theater\/1\/\d+\/?$/.test(c.href))?.text.replace(/\s*Cinemas$/, "");
  const area = crumbs.find((c) => /^\/en\/theater\/1\/\d+\/\d+\/?$/.test(c.href))?.text.replace(/\s*Cinemas$/, "");
  const name = clean($(".panel.jumbo h1 span.left").first().text()) || clean($("ul.breadcrumbs li").last().text());
  const nameAr = $(".intro-box h3.no-margin")
    .map((_, h) => clean($(h).text()))
    .get()
    .find((t) => /[؀-ۿ]/.test(t));
  const infoItems = $(".intro-box ul.unstyled.no-margin > li");
  const address = clean(infoItems.first().clone().children().remove().end().text()) || undefined;
  const phone = clean(infoItems.find(".fa-phone").parent().text()) || undefined;

  const selectedDate = $("#theater-showtimes-date-selector option[selected]").attr("value");
  const todaysShowtimes: BranchDetails["todaysShowtimes"] = [];
  $("table.showtimes").each((_, table) => {
    // nearest ancestor row that holds exactly one movie title
    const block = $(table)
      .parents("div.row")
      .filter((_, r) => $(r).find('h3 a[href*="/work/"]').length === 1)
      .first();
    const workId = workIdFrom(block.find('h3 a[href*="/work/"]').attr("href"));
    if (!workId) return;
    const bookingHref = block
      .find("a[href]")
      .map((_, a) => $(a).attr("href"))
      .get()
      .find(isElcinemaBookingHref);
    const experience = clean($(table).find("h6").first().text()) || clean($(table).prev("h6").text());
    $(table)
      .find("tr")
      .each((_, tr) => {
        const time = clean($(tr).find("td strong").first().text());
        if (!time) return;
        const price = Number(clean($(tr).find(".price").text()).replace(/[^\d.]/g, ""));
        todaysShowtimes.push({
          workId,
          experience,
          time,
          priceEgp: price > 0 ? price : undefined,
          bookingUrl: bookingHref ? abs(bookingHref) : undefined,
        });
      });
  });

  return {
    externalId,
    name,
    nameAr,
    city,
    area,
    address,
    phone: phone?.replace(/[^\d+ ]/g, "").trim() || undefined,
    url: abs(`/en/theater/${externalId}/`),
    todaysShowtimes,
    businessDate: selectedDate,
  };
}

/** Booking page sanity check: elCinema's booking form for that work (and theater). */
export function looksLikeBookingPage(html: string, workId: string, theaterId?: string): boolean {
  const $ = cheerio.load(html);
  const form = $("form#defaults");
  if (!form.length) {
    // Outside Egypt (our cloud region) elCinema serves the booking page without the
    // seat form. Accept it only if it is this movie's "Book your tickets" page.
    return /- Book your tickets\s*$/i.test($("title").text().trim()) && html.includes(`/work/${workId}`);
  }
  if (form.find('input[name="work_id"]').attr("value") !== workId) return false;
  if (theaterId && form.find('input[name="theater_id"]').attr("value") !== theaterId) return false;
  return true;
}

/** Derive a cinema chain name from an elCinema branch name. */
export function chainFromBranchName(name: string): string {
  const n = name.toLowerCase();
  const chains: [RegExp, string][] = [
    [/\bvox\b/, "VOX Cinemas"],
    [/renaissance/, "Renaissance Cinemas"],
    [/galaxy/, "Galaxy Cinemas"],
    [/premiere/, "Premiere Cinemas"],
    [/\bscene\b/, "Scene Cinemas"],
    [/zawya/, "Zawya"],
    [/\bimax\b/, "IMAX"],
    [/cinema ?city|cinemacity/, "Cinema City"],
    [/golden stars/, "Golden Stars"],
    [/sun city/, "Sun City Cinemas"],
    [/stars/, "City Stars Cinemas"],
  ];
  for (const [re, chain] of chains) if (re.test(n)) return chain;
  return "Independent";
}
