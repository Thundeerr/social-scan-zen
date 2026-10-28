import { expect, it } from "vitest";
import { allocationPlan, type CostAllocation } from "./business-cost-allocation";
const row = (
  reference: string,
  currency: "EUR" | "USD",
  monthly_cents: number,
  effective_from = "2026-10-28",
): CostAllocation => ({
  reference,
  currency,
  monthly_cents,
  effective_from,
  label: reference,
  model: "kiikii",
  planned: false,
  note: "Confirmed",
});
it("keeps currencies and models separate, applies latest effective version without altering history", () => {
  const rows = [
    row("chatgpt", "EUR", 5725),
    row("fanwake", "EUR", 9837),
    row("rapid", "EUR", 2505),
    row("server", "EUR", 655),
    row("proxy", "EUR", 2532),
    row("lovable", "USD", 1000),
    row("ig", "USD", 300),
    row("proxy", "EUR", 0, "2026-11-01"),
  ];
  expect(allocationPlan(rows, "2026-10-28").totals).toEqual({
    kiikii: { EUR: 21254, USD: 1300 },
    tuuva: { EUR: 0, USD: 0 },
  });
  expect(allocationPlan(rows, "2026-11-01").totals.kiikii.EUR).toBe(18722);
  expect(allocationPlan(rows, "2026-10-27").entries).toHaveLength(0);
});
