import { expect, it } from "vitest";
import { profitEstimate } from "./business-profit";
import { allocationPlan } from "./business-cost-allocation";
import type { MetricSnapshot } from "./business-report";
const snapshot = (source: string, values: Record<string, number>): MetricSnapshot => ({
  source,
  values,
  period_start: "2026-10-01",
  period_end: "2026-10-28",
  observed_at: "2026-10-28T18:00:00Z",
  note: "",
});
const snapshots = [
  snapshot("Fanvue API", { "Netto vor Betriebskosten USD": 717.61 }),
  snapshot("Closer Verbrauch (UI)", {
    "Berechnete Gespräche": 376,
    "Preis pro Gespräch USD": 0.08,
    Restgespräche: 199,
  }),
  snapshot("Closer Zahlungen (Revolut)", { "Bezahlt EUR": 93.42 }),
  snapshot("ECB Wechselkurs", { "USD pro EUR": 1.1133 }),
  snapshot("CupidBot Abos (Portal)", { "Bezahlt EUR": 93.42, "Monatsmittel USD": 128 }),
];
const plan = allocationPlan(
  [
    {
      reference: "fixed",
      label: "",
      model: "kiikii",
      currency: "EUR",
      monthly_cents: 21254,
      effective_from: "2026-10-28",
      planned: false,
      note: "",
    },
    {
      reference: "usd",
      label: "",
      model: "kiikii",
      currency: "USD",
      monthly_cents: 1300,
      effective_from: "2026-10-28",
      planned: false,
      note: "",
    },
  ],
  "2026-10-28",
);
const wave = { month: "2026-10", observed: "2026-10-28T18:00:00Z", kiikii: 252.6901 };
it("uses actual subscription invoices, not nominal conversation usage; avoids double counting", () => {
  const p = profitEstimate(snapshots, plan, wave)!;
  expect(p.usageUsd).toBeCloseTo(30.08);
  expect(p.surplus).toBeCloseTo(99.97, 2);
  expect(p.monthly).toBeCloseTo(582.38, 2);
  expect(p.cautiousSurplus).toBeCloseTo(99.97, 2);
  expect(p.remaining).toBe(199);
});
it("withholds totals when periods differ or required inputs are missing", () => {
  expect(profitEstimate(snapshots, plan, { ...wave, observed: "2026-10-29T18:00:00Z" })).toBeNull();
  expect(profitEstimate(snapshots.slice(1), plan, wave)).toBeNull();
  expect(
    profitEstimate(
      snapshots.map((s) =>
        s.source === "Closer Verbrauch (UI)" ? { ...s, period_start: "2026-09-01" } : s,
      ),
      plan,
      wave,
    ),
  ).toBeNull();
});
