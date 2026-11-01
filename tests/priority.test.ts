import { describe, expect, it } from "vitest";
import { monitoringIntervalSeconds } from "../src/lib/monitor/priority";

describe("monitoringIntervalSeconds", () => {
  it("uses tier targets", () => {
    expect(monitoringIntervalSeconds("critical")).toBe(120);
    expect(monitoringIntervalSeconds("high")).toBe(180);
    expect(monitoringIntervalSeconds("normal")).toBe(300);
    expect(monitoringIntervalSeconds("low")).toBe(1800);
  });
  it("never polls faster than the supplied safe floor", () => {
    expect(monitoringIntervalSeconds("critical", 420)).toBe(420);
    expect(monitoringIntervalSeconds("low", 420)).toBe(1800);
  });
  it("rejects invalid floors", () => {
    expect(() => monitoringIntervalSeconds("high", 0)).toThrow(RangeError);
    expect(() => monitoringIntervalSeconds("high", Number.NaN)).toThrow(RangeError);
  });
});
