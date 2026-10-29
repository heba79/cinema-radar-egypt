// Fixtures are real egy.voxcinemas.com pages captured on 2026-10-29.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseTitle, isVoxBookingUrl, parseMovieList, parseMoviePage, resolveDateLabel } from "@/lib/providers/vox/parse";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const today = "2026-10-29";

describe("VOX parsers", () => {
  it("parses what's on and coming soon lists", () => {
    const now = parseMovieList(fx("vox-whatson.html"), "inNowPlaying");
    expect(now.length).toBeGreaterThan(10);
    expect(now.find((m) => m.externalId === "sense-and-sensibility")?.titleEn).toBe("Sense and Sensibility");
    const soon = parseMovieList(fx("vox-comingsoon.html"), "inComingSoon");
    const bts = soon.find((m) => m.externalId === "bts-world-tour-arirang-in-s-o-paulo-live");
    expect(bts?.releaseDate).toBe("2026-10-31");
    expect(bts?.titleEn).toContain("BTS WORLD TOUR 'ARIRANG'");
  });

  it("parses today's sessions with session-level booking links", () => {
    const p = parseMoviePage(fx("vox-movie-sense.html"), "sense-and-sensibility", today);
    expect(p.details.titleEn).toBe("Sense and Sensibility");
    expect(p.listing.branches.map((b) => b.name).sort()).toContain("City Centre Alexandria");
    const alex = p.listing.showtimes.filter((s) => s.branch.name === "City Centre Alexandria");
    expect(alex[0]).toMatchObject({ businessDate: today, time: "11:45 AM", experience: "Standard", bookingUrl: "https://egy.voxcinemas.com/booking/0032-169515" });
    expect(p.otherDates[0]).toBe("2026-10-30");
  });

  it("detects advance booking: default page jumps to the first bookable date", () => {
    const p = parseMoviePage(fx("vox-movie-dune.html"), "dune-part-three", today);
    expect(p.details.egReleaseDate).toBe("2026-12-17");
    expect(p.listing.showtimes.length).toBeGreaterThan(0);
    expect(p.listing.showtimes.every((s) => s.businessDate === "2026-12-17")).toBe(true);
    expect(p.listing.showtimes.every((s) => isVoxBookingUrl(s.bookingUrl))).toBe(true);
  });

  it("resolves date labels", () => {
    expect(resolveDateLabel("Today", today)).toBe(today);
    expect(resolveDateLabel("Tomorrow", today)).toBe("2026-10-30");
    expect(resolveDateLabel("Thu 17 Dec", today)).toBe("2026-12-17");
    expect(resolveDateLabel("Fri 08 Jan", "2026-12-20")).toBe("2027-01-08");
  });

  it("strips format/language suffixes for matching", () => {
    expect(baseTitle("Avengers: Doomsday (Infinity Vision)")).toBe("Avengers: Doomsday");
    expect(baseTitle("Hope (Korean)")).toBe("Hope");
  });

  it("only accepts VOX session booking URLs", () => {
    expect(isVoxBookingUrl("https://egy.voxcinemas.com/booking/0032-169515")).toBe(true);
    expect(isVoxBookingUrl("https://uae.voxcinemas.com/booking/0032-169515")).toBe(false);
    expect(isVoxBookingUrl("https://egy.voxcinemas.com/booking/0032-169515?x=1")).toBe(false);
  });
});
