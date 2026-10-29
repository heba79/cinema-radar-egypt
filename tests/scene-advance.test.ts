// Real pages captured 29 Oct 2026 from
// https://cfc.scenecinemas.com/movie-details/avengers-doomsday-infinity-vision-sx-4dx.html
// (date picker 17–23 Dec, nothing rendered for today) and its ?business_day=17-12-2026&ajax=1 fragment.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBranchDays } from "@/lib/providers/scene/adapter";
import { parseMoviePage, parseShowtimes } from "@/lib/providers/scene/parse";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const page = fx("scene-movie-avengers-advance.html");
const dec17 = fx("scene-day-avengers-17-12.html");

describe("Scene advance booking (Avengers: Doomsday, Cairo Festival City)", () => {
  it("date picker lists the movie's own future days, but the page itself has no sessions", () => {
    const p = parseMoviePage(page);
    expect(p.days).toEqual(["2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20", "2026-12-21", "2026-12-22", "2026-12-23"]);
    expect(parseShowtimes(page, "2026-12-17")).toEqual([]); // listed dates alone are NOT bookable sessions
  });

  it("reads every listed day, including the first, and only counts days whose sessions have booking links", async () => {
    const asked: string[] = [];
    const days = await readBranchDays(page, async (d) => {
      asked.push(d);
      return d === "2026-12-17" ? dec17 : "<div></div>"; // other days: no sessions published
    });
    expect(asked).toEqual(["2026-12-17", "2026-12-18", "2026-12-19", "2026-12-20", "2026-12-21", "2026-12-22", "2026-12-23"]);
    const first = days.find((d) => d.date === "2026-12-17")!;
    expect(first.shows.map((s) => `${s.experience} ${s.time}`)).toEqual(["ScreenX 12:00 PM", "ScreenX 04:00 PM", "ScreenX 08:00 PM", "ScreenX 12:00 AM"]);
    expect(first.shows.every((s) => /^https:\/\/cfc\.scenecinemas\.com\/showtime-[0-9a-f]{24}$/.test(s.bookingUrl ?? ""))).toBe(true);
    expect(days.filter((d) => d.date !== "2026-12-17").every((d) => d.shows.length === 0)).toBe(true);
  });

  it("uses sessions already rendered for the active day without an extra request", async () => {
    const asked: string[] = [];
    const days = await readBranchDays(fx("scene-movie-sense.html"), async (d) => {
      asked.push(d);
      return "<div></div>";
    });
    expect(asked).not.toContain("2026-10-29");
    expect(days[0].shows.length).toBeGreaterThan(0);
  });
});
