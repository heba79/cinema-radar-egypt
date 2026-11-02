import { describe, expect, it } from "vitest";
import { providerRetryDelayMs } from "../local-worker/retry";

describe("providerRetryDelayMs", () => {
  it("backs off 5, 10, 20, 40 then 60 minutes", () => {
    expect([1, 2, 3, 4, 5, 6].map(providerRetryDelayMs))
      .toEqual([5, 10, 20, 40, 60, 60].map((m) => m * 60_000));
  });
  it("caps even after many failures", () => {
    expect(providerRetryDelayMs(1000)).toBe(60 * 60_000);
  });
  it("rejects invalid failure counts", () => {
    for (const n of [0, -1, NaN, Infinity, 1.5]) {
      expect(() => providerRetryDelayMs(n)).toThrow(RangeError);
    }
  });
});
