import { describe, it, expect } from "vitest";
import {
  berlinTime,
  monthlyCosts,
  budgetLevel,
  forecastCash,
  type CostEntry,
} from "./business-report";
describe("business reporting", () => {
  it("uses German calendar days and DST", () => {
    expect(berlinTime(new Date("2026-10-24T18:00:00Z"))).toEqual({
      day: "2026-10-24",
      time: "20:00",
      hour: 20,
    });
    expect(berlinTime(new Date("2026-10-25T19:00:00Z"))).toEqual({
      day: "2026-10-25",
      time: "20:00",
      hour: 20,
    });
    expect(berlinTime(new Date("2026-10-27T23:30:00Z")).day).toBe("2026-10-28");
  });
  it("never adds consumption to prepaid purchases or assigns shared expenses", () => {
    const entry = (
      kind: CostEntry["kind"],
      scope: CostEntry["scope"],
      cents: number,
      day = "2026-10-01",
    ): CostEntry => ({
      kind,
      scope,
      cents,
      day,
      reference: kind,
      label: kind,
      end_day: null,
      note: "",
    });
    const result = monthlyCosts(
      [
        entry("fixed", "kiikii", 9000, "2026-09-01"),
        entry("topup", "kiikii", 8800),
        entry("usage", "kiikii", 256),
        entry("topup", "shared", 26000),
        entry("topup", "tuuva", 1200),
        entry("topup", "kiikii", 9999, "2026-11-01"),
      ],
      "2026-10-27",
    );
    expect(result.cashPlan).toBe(17800);
    expect(result.usage).toBe(256);
    expect(result.sharedTopups).toBe(26000);
  });
  it("warns at exact thresholds and forecasts only variable payments", () => {
    expect(budgetLevel(27999, 40000)).toBe(0);
    expect(budgetLevel(28000, 40000)).toBe(70);
    expect(budgetLevel(34000, 40000)).toBe(85);
    expect(budgetLevel(38000, 40000)).toBe(95);
    expect(budgetLevel(45000, 40000)).toBe(100);
    expect(forecastCash(9000, 1000, "2026-10-10")).toBe(12100);
  });
});
