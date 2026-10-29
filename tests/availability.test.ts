import { describe, expect, it } from "vitest";
import { computeStatus, detectEvents, matchMovie } from "@/lib/availability";

const today = "2026-10-29";
const base = { today, providerOk: true, linked: true, everListed: false, listings: [] };

describe("computeStatus", () => {
  it("never reports 'no tickets' when the provider failed", () => {
    expect(computeStatus({ ...base, providerOk: false, listings: [{ isBookable: true, showDate: today }] })).toBe("provider_unavailable");
  });
  it("bookable today after release → bookable_now", () => {
    expect(computeStatus({ ...base, egReleaseDate: "2026-10-29", listings: [{ isBookable: true, showDate: today }] })).toBe("bookable_now");
  });
  it("bookable before Egyptian release → advance_booking", () => {
    expect(computeStatus({ ...base, egReleaseDate: "2026-11-05", listings: [{ isBookable: true, showDate: "2026-11-05" }] })).toBe("advance_booking");
  });
  it("provider 'tickets' action before any dated showtimes → advance_booking", () => {
    expect(computeStatus({ ...base, releaseDate: "2026-12-16", bookableWithoutShowtimes: true })).toBe("advance_booking");
    expect(computeStatus({ ...base, releaseDate: "2026-10-01", bookableWithoutShowtimes: true })).toBe("bookable_now");
  });
  it("listed but no booking action → listed_not_bookable", () => {
    expect(computeStatus({ ...base, listings: [{ isBookable: false, showDate: today }] })).toBe("listed_not_bookable");
  });
  it("past screenings are ignored", () => {
    expect(computeStatus({ ...base, everListed: true, listings: [{ isBookable: true, showDate: "2026-10-01" }] })).toBe("no_longer_listed");
  });
  it("upcoming vs released-not-listed vs unknown", () => {
    expect(computeStatus({ ...base, egReleaseDate: "2026-12-01" })).toBe("upcoming");
    expect(computeStatus({ ...base, releaseDate: "2026-01-01" })).toBe("released_not_listed");
    expect(computeStatus({ ...base, linked: false })).toBe("unknown");
  });
});

describe("detectEvents", () => {
  const args = { movieId: "m1", providerId: "elcinema", notifiedBranches: new Set<string>() };
  it("first booking → ONE event listing every branch", () => {
    expect(detectEvents({ ...args, status: "bookable_now", bookableBranchesNow: ["b", "a", "a"] })).toEqual({
      type: "booking_opened",
      branchExternalIds: ["a", "b"],
      dedupeKey: "movie:m1:opened",
    });
  });
  it("a second provider opening the same movie is a new_branch, not another 'opened'", () => {
    expect(detectEvents({ ...args, providerId: "vox-egypt", alertedElsewhere: true, status: "bookable_now", bookableBranchesNow: ["0032"] })?.type).toBe("new_branch");
  });
  it("advance booking event type", () => {
    expect(detectEvents({ ...args, status: "advance_booking", bookableBranchesNow: ["a"] })?.type).toBe("advance_booking_opened");
  });
  it("no event for branches already alerted (even if they flapped)", () => {
    expect(detectEvents({ ...args, notifiedBranches: new Set(["a"]), status: "bookable_now", bookableBranchesNow: ["a"] })).toBeNull();
  });
  it("new branch after opening", () => {
    expect(detectEvents({ ...args, notifiedBranches: new Set(["a"]), status: "bookable_now", bookableBranchesNow: ["a", "c"] })).toEqual({
      type: "new_branch",
      branchExternalIds: ["c"],
      dedupeKey: "elcinema:m1:branches:c",
    });
  });
  it("nothing when not bookable", () => {
    expect(detectEvents({ ...args, status: "listed_not_bookable", bookableBranchesNow: ["a"] })).toBeNull();
  });
});

describe("matchMovie", () => {
  const cands = [
    { externalId: "1", titleEn: "Sense and Sensibility", year: 1995 },
    { externalId: "2", titleEn: "Sense and Sensibility", year: 2026, imdbId: "tt13609648" },
    { externalId: "3", titleEn: "Matloub Aaeleyan", titleAr: "مطلوب عائلياً", year: 2026 },
  ];
  it("prefers IMDb id", () => {
    expect(matchMovie({ imdbId: "tt13609648", titles: ["x"] }, cands)?.candidate.externalId).toBe("2");
  });
  it("distinguishes remakes by year", () => {
    expect(matchMovie({ titles: ["Sense and Sensibility"], year: 1995 }, cands)?.candidate.externalId).toBe("1");
  });
  it("matches Arabic titles ignoring diacritics/hamza forms", () => {
    expect(matchMovie({ titles: ["مطلوب عائليا"], year: 2026 }, cands)?.candidate.externalId).toBe("3");
  });
  it("refuses ambiguous matches", () => {
    expect(matchMovie({ titles: ["Sense and Sensibility"] }, cands)).toBeNull();
  });
  it("rejects different IMDb ids even with identical titles", () => {
    expect(matchMovie({ imdbId: "tt0114388", titles: ["Sense and Sensibility"], year: 2026 }, [cands[1]])).toBeNull();
  });
});
