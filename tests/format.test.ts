import { describe, expect, it } from "vitest";
import type { EventPayload } from "@/lib/monitor/check";
import { formatEmail, formatText } from "@/lib/notify/format";

const payload: EventPayload = {
  movieTitle: "Sense and Sensibility",
  movieTitleAr: null,
  tmdbId: 123,
  posterPath: null,
  branches: [
    {
      cinema: "Zawya Cinema",
      branch: "Zawya Cinema — Downtown",
      city: "Cairo",
      screenings: [
        { date: "2026-10-29", time: "01:30 PM", experience: "Standard", price: 150 },
        { date: "2026-10-29", time: "09:30 PM", experience: "Standard", price: 150 },
        { date: "2026-10-30", time: "04:15 PM", experience: "Standard", price: 150 },
      ],
      bookingUrl: "https://elcinema.com/en/booking/2099119/3101183",
    },
  ],
  bookingUrl: "https://elcinema.com/en/booking/2099119/3101183",
  detectedAt: "2026-10-29T10:00:00Z",
  advance: false,
};

describe("listing alert formatting (Scene/VOX via elCinema)", () => {
  const listing: EventPayload = {
    ...payload,
    kind: "listing",
    branches: [{ ...payload.branches[0], cinema: "Scene Cinemas", branch: "District 5 Scene Cinema", bookingUrl: "https://district5.scenecinemas.com/" }],
    bookingUrl: "https://district5.scenecinemas.com/",
  };
  it("lists every day, links the official site, and says booking isn't verified", () => {
    const t = formatText("showtimes_listed", listing, "https://radar.example");
    expect(t).toContain("🎬 SHOWTIMES ARE OUT!");
    expect(t).toContain("Thu 29 Oct: 01:30 PM, 09:30 PM");
    expect(t).toContain("Fri 30 Oct: 04:15 PM");
    expect(t).toContain("🔗 OFFICIAL SITE: https://district5.scenecinemas.com/");
    expect(t).not.toContain("BOOK NOW:");
    expect(t).toContain("couldn't be verified");
    expect(formatEmail("showtimes_listed", listing, "https://radar.example").html).toContain("BOOK ON OFFICIAL SITE");
  });
  it("says NEW DATES ADDED when a branch already announced gets more days", () => {
    const t = formatText("showtimes_listed", { ...listing, newDates: true }, "https://radar.example");
    expect(t.startsWith("🎬 NEW DATES ADDED!")).toBe(true);
    expect(formatEmail("showtimes_listed", { ...listing, newDates: true }, "https://radar.example").subject).toContain("NEW DATES ADDED!");
  });
  it("says NEW SHOWTIMES ADDED when only extra times appear on known days", () => {
    expect(formatText("showtimes_listed", { ...listing, newDates: true, update: "showtimes" }, "https://radar.example").startsWith("🎬 NEW SHOWTIMES ADDED!")).toBe(true);
  });
});

describe("alert formatting", () => {
  it("text alert follows the required template", () => {
    const t = formatText("booking_opened", payload, "https://radar.example");
    expect(t).toContain("🎬 TICKETS ARE LIVE!");
    expect(t).toContain("Movie: Sense and Sensibility");
    expect(t).toContain("Cinema: Zawya Cinema");
    expect(t).toContain("Branch: Zawya Cinema — Downtown, Cairo");
    expect(t).toContain("Date: Thu 29 Oct");
    expect(t).toContain("Time: 01:30 PM, 09:30 PM");
    expect(t).toContain("🎟 BOOK NOW: https://elcinema.com/en/booking/2099119/3101183");
    expect(t).toMatch(/Detected: .*2026.*\(Cairo time\)/);
  });
  it("email escapes HTML and links the verified booking URL", () => {
    const e = formatEmail("advance_booking_opened", { ...payload, movieTitle: "<script>x</script>" }, "https://radar.example");
    expect(e.subject).toContain("ADVANCE BOOKING IS OPEN!");
    expect(e.html).not.toContain("<script>x</script>");
    expect(e.html).toContain('href="https://elcinema.com/en/booking/2099119/3101183"');
  });
});
