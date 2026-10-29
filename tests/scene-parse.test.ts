// Fixtures are real cfc.scenecinemas.com pages captured on 2026-10-29.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSceneBookingUrl, looksLikeSceneBookingPage, parseHome, parseMoviePage, parseShowtimes } from "@/lib/providers/scene/parse";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("Scene Cinemas parsers", () => {
  it("parses the branch home page catalogue", () => {
    const movies = parseHome(fx("scene-home-cfc.html"), "cfc");
    expect(movies.length).toBeGreaterThan(10);
    expect(movies.find((m) => m.slug === "sense-and-sensibility")?.title).toBe("Sense and Sensibility");
  });

  it("parses the movie page days and active day", () => {
    const p = parseMoviePage(fx("scene-movie-sense.html"));
    expect(p.title).toBe("Sense and Sensibility");
    expect(p.activeDate).toBe("2026-10-29");
    expect(p.days).toHaveLength(7);
  });

  it("parses showtimes per screen type with session booking links", () => {
    const shows = parseShowtimes(fx("scene-movie-sense.html"), "2026-10-29");
    const premiere = shows.filter((s) => s.experience === "Premiere");
    expect(premiere.map((s) => s.time)).toEqual(["10:30 AM", "01:15 PM", "04:00 PM", "07:00 PM"]);
    expect(premiere[0].bookingUrl).toBe("https://cfc.scenecinemas.com/showtime-6ae10c3b93ab5e6f3c44fc38");
    expect(shows.some((s) => s.experience === "Standard")).toBe(true);
  });

  it("parses the ajax fragment for another day", () => {
    const shows = parseShowtimes(fx("scene-day-ajax.html"), "2026-10-31");
    expect(shows.length).toBeGreaterThan(0);
    expect(shows.every((s) => isSceneBookingUrl(s.bookingUrl))).toBe(true);
  });

  it("treats box-office-only sessions as not bookable", () => {
    const html = `<div id="ShowtimesAjax"><div class="program_item"><div class="ex_stand_content"><span class="ex_stand">Standard</span>
      <ul><li><a href="javascript:void(0)" onclick="showtime_from_cinema()">10:30 AM</a></li></ul></div></div></div>`;
    expect(parseShowtimes(html, "2026-10-29")[0].bookingUrl).toBeUndefined();
  });

  it("verifies the booking page", () => {
    expect(looksLikeSceneBookingPage(fx("scene-showtime.html"))).toBe(true);
    expect(looksLikeSceneBookingPage(fx("scene-showtime.html") + "<script>showtime_from_cinema();</script>")).toBe(false);
    expect(looksLikeSceneBookingPage("<title>Home</title>")).toBe(false);
  });
});
