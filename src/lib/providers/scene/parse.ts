// Pure parsers for Scene Cinemas (scenecinemas.com). robots.txt: "User-agent: * / Allow: /".
// Each branch has its own subdomain; a movie page server-renders the active day's
// showtimes per screen type with session-level "Buy Tickets" links, and other days
// load from the same URL with ?business_day=DD-MM-YYYY&ajax=1.
import * as cheerio from "cheerio";
import { parseShowtime } from "../../time";

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export const SCENE_BRANCHES = {
  cfc: { name: "Scene Cinemas - Cairo Festival City", city: "Cairo", area: "New Cairo (Cairo Festival City)" },
  district5: { name: "Scene Cinemas - District 5", city: "Cairo", area: "New Cairo (District 5)" },
} as const;
export type SceneBranch = keyof typeof SCENE_BRANCHES;

export const sceneOrigin = (branch: SceneBranch) => `https://${branch}.scenecinemas.com`;

export function isSceneBookingUrl(href: string | undefined): href is string {
  return !!href && /^https:\/\/(cfc|district5)\.scenecinemas\.com\/showtime-[0-9a-f]{24}$/.test(href);
}

/** Branch home page → now-showing movie slugs and titles. */
export function parseHome(html: string, branch: SceneBranch) {
  const $ = cheerio.load(html);
  const out = new Map<string, { slug: string; title: string; posterUrl?: string }>();
  $('a[href*="/movie-details/"]').each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const slug = href.match(new RegExp(`^${sceneOrigin(branch).replace(/\./g, "\\.")}/movie-details/([a-z0-9_-]+)\\.html$`))?.[1];
    if (!slug) return;
    const title = clean($(a).attr("title")) || clean($(a).closest(".card").find(".card-title").text());
    if (!title || out.has(slug)) return;
    out.set(slug, { slug, title, posterUrl: $(a).find("img").attr("data-src") });
  });
  return [...out.values()];
}

export interface SceneShow {
  experience: string;
  time: string;
  startsAt: Date;
  bookingUrl?: string; // absent when the session is box-office only
}

/** "DD-MM-YYYY" → "YYYY-MM-DD" */
export const fromSceneDate = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;
export const toSceneDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** Parses a showtimes block (full movie page or the ?ajax=1 fragment) for one business day. */
export function parseShowtimes(html: string, businessDate: string): SceneShow[] {
  const $ = cheerio.load(html);
  const scope = $("#ShowtimesAjax").length ? "#ShowtimesAjax " : "";
  const shows: SceneShow[] = [];
  $(scope + ".program_item").find("[class*='_content']").each((_, block) => {
    const experience = clean($(block).find("span[class^='ex_']").first().text());
    $(block)
      .find("ul li a")
      .each((_, a) => {
        const href = $(a).attr("href");
        const onclick = $(a).attr("onclick") ?? "";
        const parsed = parseShowtime(businessDate, clean($(a).text()));
        if (!parsed) return;
        const online = isSceneBookingUrl(href) && !onclick.includes("showtime_from_cinema");
        shows.push({ experience, time: parsed.display, startsAt: parsed.startsAt, bookingUrl: online ? href : undefined });
      });
  });
  // de-duplicate in case selectors overlapped
  return shows.filter((s, i) => shows.findIndex((x) => x.experience === s.experience && +x.startsAt === +s.startsAt) === i);
}

/** Movie page: title, available business days, and which one is rendered. */
export function parseMoviePage(html: string) {
  const $ = cheerio.load(html);
  const title = clean($("title").first().text()).replace(/\s*\|.*$/, "");
  const days = $("li.calanderdays[id^='data-']")
    .map((_, li) => ({ date: fromSceneDate($(li).attr("id")!.slice(5)), active: $(li).hasClass("active") }))
    .get();
  const activeDate = days.find((d) => d.active)?.date ?? days[0]?.date;
  return { title, days: days.map((d) => d.date), activeDate };
}

/** Booking page check: a live "Buy Tickets" page whose box-office-only modal isn't triggered. */
export function looksLikeSceneBookingPage(html: string): boolean {
  const $ = cheerio.load(html);
  if (!/^Buy Tickets/i.test(clean($("title").text()))) return false;
  if (!/Choose Seats/i.test(html)) return false;
  // The "can't book online" modal is opened by calling showtime_from_cinema(); ignore the function definition.
  const calls = (html.match(/showtime_from_cinema\(\)/g) ?? []).length - (html.match(/function\s+showtime_from_cinema\(\)/g) ?? []).length;
  return calls <= 0;
}
