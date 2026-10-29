// Fixtures are real elcinema.com pages captured on 2026-10-29.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chainFromBranchName,
  isElcinemaBookingHref,
  looksLikeBookingPage,
  parseBookableIndex,
  parseTheaterPage,
  parseWorkList,
  parseWorkPage,
  parseWorkTheaters,
} from "@/lib/providers/elcinema/parse";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("elCinema parsers", () => {
  it("parses the bookable index", () => {
    const items = parseBookableIndex(fx("elcinema-available-for-booking.html"));
    expect(items.length).toBeGreaterThan(5);
    const sense = items.find((i) => i.externalId === "2099119");
    expect(sense?.titleEn).toBe("Sense and Sensibility");
    expect(sense?.inBookable).toBe(true);
  });

  it("parses now-playing list rows", () => {
    const items = parseWorkList(fx("elcinema-now-eg.html"), "inNowPlaying");
    expect(items.length).toBeGreaterThan(5);
    expect(items.find((i) => i.externalId === "2099119")?.titleEn).toBe("Sense and Sensibility");
    expect(items.every((i) => /^\d+$/.test(i.externalId))).toBe(true);
  });

  it("parses a work page: IMDb id, Egyptian release date, title", () => {
    const w = parseWorkPage(fx("elcinema-work.html"), "2099119");
    expect(w).toMatchObject({ imdbId: "tt13609648", egReleaseDate: "2026-10-29", titleEn: "Sense and Sensibility", year: 2026 });
  });

  it("parses per-date theater listings with booking only where elCinema sells tickets", () => {
    const listing = parseWorkTheaters(fx("elcinema-work-theater.html"), "2099119", "https://elcinema.com/en/work/2099119/theater/eg");
    expect(listing.branches.length).toBeGreaterThan(10);

    const zawya = listing.branches.find((b) => b.name === "Zawya Cinema");
    expect(zawya?.bookingUrl).toBe("https://elcinema.com/en/booking/2099119/3101183");
    const dandy = listing.branches.find((b) => b.name === "Dandy Mall Cinema");
    expect(dandy).toBeDefined();
    expect(dandy?.bookingUrl).toBeUndefined();

    const zawyaToday = listing.showtimes.filter((s) => s.branch.externalId === "3101183" && s.businessDate === "2026-10-29");
    expect(zawyaToday.map((s) => s.time)).toEqual(["01:30 PM", "09:30 PM"]);
    // every bookable showtime must carry a real elCinema booking URL
    for (const s of listing.showtimes) if (s.bookingUrl) expect(s.bookingUrl).toMatch(/^https:\/\/elcinema\.com\/en\/booking\/2099119\/\d+$/);

    // after-midnight shows roll to the next calendar day (Cairo)
    const tahrirLate = listing.showtimes.find((s) => s.branch.externalId === "3101618" && s.businessDate === "2026-10-29" && s.time === "12:15 AM");
    expect(tahrirLate).toBeDefined();
    expect(tahrirLate!.startsAt.toISOString()).toBe("2026-10-29T22:15:00.000Z"); // Egypt returns to UTC+2 on 30 Oct
  });

  it("parses a theater page: city, area, prices, experiences", () => {
    const t = parseTheaterPage(fx("elcinema-theater-zawya.html"), "3101183");
    expect(t).toMatchObject({ name: "Zawya Cinema", nameAr: "سينما زاوية", city: "Cairo", area: "Downtown", businessDate: "2026-10-29" });
    expect(t.phone).toContain("01014331779");
    const wildwood = t.todaysShowtimes.filter((s) => s.workId === "2088495");
    expect(wildwood.length).toBe(3);
    expect(wildwood[0]).toMatchObject({ experience: "Standard", priceEgp: 150, bookingUrl: "https://elcinema.com/en/booking/2088495/3101183" });
  });

  it("only accepts elCinema booking hrefs", () => {
    expect(isElcinemaBookingHref("/en/booking/2099119/3101183")).toBe(true);
    expect(isElcinemaBookingHref("/en/booking/2099119/")).toBe(true);
    expect(isElcinemaBookingHref("https://evil.example/booking/1")).toBe(false);
    expect(isElcinemaBookingHref("/en/work/2099119/")).toBe(false);
  });

  it("recognizes the booking form", () => {
    const html = `<form id="defaults"><input name="work_id" value="2099119"><input name="theater_id" value="3101183"></form>`;
    expect(looksLikeBookingPage(html, "2099119", "3101183")).toBe(true);
    expect(looksLikeBookingPage(html, "2099119", "999")).toBe(false);
    expect(looksLikeBookingPage("<html></html>", "2099119")).toBe(false);
    // booking page as served outside Egypt (no seat form): accepted only for the same movie
    const noForm = `<title>Movie: Avengers: Doomsday - Book your tickets</title><a href="/en/work/2097036/">x</a>`;
    expect(looksLikeBookingPage(noForm, "2097036")).toBe(true);
    expect(looksLikeBookingPage(noForm, "2099119")).toBe(false);
    expect(looksLikeBookingPage(`<title>elCinema</title><a href="/en/work/2097036/">x</a>`, "2097036")).toBe(false);
  });

  it("maps branch names to chains", () => {
    expect(chainFromBranchName("Galaxy El Maadi  Cinema")).toBe("Galaxy Cinemas");
    expect(chainFromBranchName("Cairo Festival Scene Cinema")).toBe("Scene Cinemas");
    expect(chainFromBranchName("Premiere Point 90 Cinema")).toBe("Premiere Cinemas");
    expect(chainFromBranchName("El Tahrir Cinema")).toBe("Independent");
  });
});
