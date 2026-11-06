import { expect, it } from "vitest";
import { profitEstimate } from "./business-profit";
import { allocationPlan, type CostAllocation } from "./business-cost-allocation";
import type { MetricSnapshot } from "./business-report";

const snapshot = (
  source: string,
  values: Record<string, number>,
  start = "2026-10-01",
  end = "2026-10-28",
): MetricSnapshot => ({
  source,
  values,
  period_start: start,
  period_end: end,
  observed_at: `${end}T18:00:00Z`,
  note: "",
});
const rate = 1.1133;
const snapshots = [
  snapshot("Fanvue API", { "Netto vor Betriebskosten USD": 717.61 }),
  snapshot("Closer Verbrauch (UI)", {
    "Berechnete Gespräche": 376,
    "Preis pro Gespräch USD": 0.08,
    Restgespräche: 199,
  }),
  snapshot("Closer Zahlungen (Revolut)", { "Bezahlt EUR": 93.42 }),
  snapshot("ECB Wechselkurs", { "USD pro EUR": rate }, "2026-10-28"),
  snapshot("CupidBot Abos (Portal)", {
    "Bezahlt EUR": 93.42,
    "Monatliche Tarife USD": 24,
    "Wöchentliche Tarife USD": 24,
    "Monatsmittel USD": 128,
  }),
];
const rows: CostAllocation[] = [
  {
    reference: "fixed",
    label: "",
    model: "kiikii",
    currency: "EUR",
    monthly_cents: 21254,
    effective_from: "2026-10-01",
    planned: false,
    note: "",
  },
  {
    reference: "usd",
    label: "",
    model: "kiikii",
    currency: "USD",
    monthly_cents: 1300,
    effective_from: "2026-10-01",
    planned: false,
    note: "",
  },
];
const plan = allocationPlan(rows, "2026-11-03");
const emptyPlan = allocationPlan([], "2026-11-03");
const wave = { month: "2026-10", observed: "2026-10-28T18:00:00Z", kiikii: 252.6901 };
const current = snapshot(
  "CupidBot laufende Abos (Portal)",
  {
    "Aktive Abos": 2,
    "Monatliche Tarife USD": 16,
    "Wöchentliche Tarife USD": 8,
    "Monatsmittel USD": 16 + (8 * 52) / 12,
  },
  "2026-10-29",
  "2026-10-29",
);
const november = [
  snapshot("Fanvue API", { "Netto vor Betriebskosten USD": 0 }, "2026-11-01", "2026-11-03"),
  ...snapshots,
  current,
];
function computed(result: ReturnType<typeof profitEstimate>) {
  expect(result).not.toBeNull();
  if (!result || "unavailable" in result) throw Error("Expected a profit estimate");
  return result;
}

it("prorates aligned costs and never adds invoices or conversation usage on top of plan rates", () => {
  const p = computed(profitEstimate(snapshots, plan, wave, "2026-10-28"));
  const fixed = ((212.54 + 13 / rate) * 28) / 31;
  const subscriptions = ((24 * 28) / 31 + (24 * 28) / 7) / rate;
  expect(p.days).toBe(28);
  expect(p.fixed).toBeCloseTo(fixed);
  expect(p.subscriptionCosts).toBeCloseTo(subscriptions);
  expect(p.generation).toBeCloseTo(252.6901 / rate);
  expect(p.costs).toBeCloseTo(fixed + subscriptions + 252.6901 / rate);
  expect(p.surplus).toBeCloseTo((717.61 - 252.6901) / rate - fixed - subscriptions);
  expect(p.usageUsd).toBeCloseTo(30.08);
  expect(p.paid).toBe(93.42);
  expect(p.remaining).toBe(199);
  expect(p.fxStale).toBe(false);
});

it("carries the latest confirmed monthly and weekly costs into November without manual reentry", () => {
  const p = computed(
    profitEstimate(
      november,
      plan,
      {
        month: "2026-11",
        observed: "2026-11-03T18:00:00Z",
        kiikii: 6,
      },
      "2026-11-03",
    ),
  );
  const fixed = ((212.54 + 13 / rate) * 3) / 30;
  const subscriptions = ((16 * 3) / 30 + (8 * 3) / 7) / rate;
  expect(p.start).toBe("2026-11-01");
  expect(p.end).toBe("2026-11-03");
  expect(p.days).toBe(3);
  expect(p.fixed).toBeCloseTo(fixed);
  expect(p.subscriptionCosts).toBeCloseTo(subscriptions);
  expect(p.costs).toBeCloseTo(fixed + subscriptions + 6 / rate);
  expect(p.surplus).toBeCloseTo(-p.costs);
  expect(p.estimateLabel).toBe("Schätzung, Kosten Stand 01.10.2026");
  expect(p.monthlySubscriptionsUsd).toBeCloseTo(16 + (8 * 52) / 12);
  expect(p.subscriptionCount).toBe(2);
});

it("returns null only when no confirmed cost data is available", () => {
  const revenueAndFx = snapshots.filter((s) =>
    ["Fanvue API", "ECB Wechselkurs"].includes(s.source),
  );
  expect(profitEstimate(revenueAndFx, emptyPlan, null, "2026-11-03")).toBeNull();
  const excluded = allocationPlan(
    [
      { ...rows[0], planned: true },
      { ...rows[1], model: "tuuva" },
    ],
    "2026-11-03",
  );
  expect(profitEstimate(revenueAndFx, excluded, null, "2026-11-03")).toBeNull();
  const zero = computed(
    profitEstimate(
      [...revenueAndFx, snapshot("CupidBot Abos (Portal)", { "Monatsmittel USD": 0 })],
      emptyPlan,
      null,
      "2026-11-03",
    ),
  );
  expect(zero.costs).toBe(0);
});

it("uses the latest available ECB rate and flags rates older than seven days without withholding profit", () => {
  // A later import of an older rate must not replace the newer dated rate.
  const old = {
    ...snapshot("ECB Wechselkurs", { "USD pro EUR": 1.05 }, "2026-10-01", "2026-10-01"),
    observed_at: "2026-11-05T18:00:00Z",
  };
  const p = computed(profitEstimate([old, ...november], plan, wave, "2026-11-05"));
  expect(p.rate).toBe(rate);
  expect(p.revenue).toBe(0);
  expect(p.fxStale).toBe(true);
  expect(p.notes).toContain("ECB-Kurs veraltet: Stand 28.10.2026 (älter als 7 Tage).");
  const atSevenDays = computed(profitEstimate(november, plan, wave, "2026-11-04"));
  expect(atSevenDays.fxStale).toBe(false);
  expect(p.surplus).toBe(atSevenDays.surplus);
});

it("does not require old usage or bank snapshots when confirmed tariffs exist", () => {
  const p = computed(
    profitEstimate(
      november.filter((s) => !s.source.startsWith("Closer")),
      plan,
      null,
      "2026-11-03",
    ),
  );
  expect(p.subscriptionCosts).toBeGreaterThan(0);
  expect(p.notes).toContain("Generierungskosten fehlen; nicht enthalten.");
  expect(p.costs).toBeCloseTo(p.fixed + p.subscriptionCosts);
});

it("labels generation estimated from a mismatched period instead of blocking all profit", () => {
  const p = computed(profitEstimate(november, plan, wave, "2026-11-03"));
  expect(p.generation).toBeCloseTo(((252.6901 / 28) * 3) / rate);
  expect(p.notes).toContain("Generierung aus dem Tagesdurchschnitt bis 28.10.2026 geschätzt.");
});

it("uses monthly averages only as a fallback when separate tariff cadences are unavailable", () => {
  const p = computed(
    profitEstimate(
      [
        ...snapshots.filter((s) => s.source !== "CupidBot Abos (Portal)"),
        snapshot("CupidBot Abos (Portal)", { "Monatsmittel USD": 128 }),
      ],
      plan,
      wave,
      "2026-10-28",
    ),
  );
  expect(p.subscriptionCosts).toBeCloseTo((128 * 28) / 31 / rate);
  expect(p.subscriptionMonthlyUsd).toBeUndefined();
  expect(p.subscriptionWeeklyUsd).toBeUndefined();
});

it("estimates from confirmed payments if rates are missing, counting bank and portal payments once", () => {
  const p = computed(
    profitEstimate(
      [
        ...november.filter((s) => !s.source.startsWith("CupidBot")),
        snapshot("CupidBot Abos (Portal)", { "Bezahlt EUR": 93.42 }),
      ],
      emptyPlan,
      null,
      "2026-11-03",
    ),
  );
  expect(p.costs).toBeCloseTo((93.42 * 3) / 28);
  expect(p.notes).toContain(
    "Abokosten aus bestätigtem Zahlungsdurchschnitt geschätzt; Tarif fehlt.",
  );
});

it("cancellations reduce the outlook without changing an earlier period's estimate", () => {
  const before = computed(profitEstimate(snapshots, plan, wave, "2026-10-29"));
  const after = computed(profitEstimate([current, ...snapshots], plan, wave, "2026-10-29"));
  expect(after.monthlySubscriptionsUsd).toBeCloseTo(50.6666667);
  expect(after.monthly).toBeCloseTo(before.monthly - (128 - 50.6666667) / rate);
  expect(after.surplus).toBe(before.surplus);
  expect(after.paid).toBe(93.42);
});

it.each([
  ["2026-10-31", "2026-11-02", 1 / 31 + 2 / 30, 3],
  ["2028-02-01", "2028-02-29", 1, 29],
])(
  "prorates calendar months and inclusive days across %s through %s",
  (start, end, fraction, days) => {
    const p = computed(
      profitEstimate(
        [
          snapshot("Fanvue API", { "Netto vor Betriebskosten USD": 100 }, start, end),
          ...snapshots.slice(1),
        ],
        plan,
        null,
        end,
      ),
    );
    expect(p.days).toBe(days);
    expect(p.fixed).toBeCloseTo((212.54 + 13 / rate) * fraction);
    expect(p.subscriptionCosts).toBeCloseTo((24 * fraction + (24 * days) / 7) / rate);
  },
);

it("keeps Fanvue net as the only revenue source, excluding duplicate FanWake and app-store purchases", () => {
  const before = computed(profitEstimate(snapshots, plan, wave, "2026-10-28"));
  const after = computed(
    profitEstimate(
      [
        snapshot("FanWake", { "Umsatz USD": 717.61, "Käufe USD": 717.61 }),
        snapshot("App Store", { "Käufe USD": 500 }),
        ...snapshots,
      ],
      plan,
      wave,
      "2026-10-28",
    ),
  );
  expect(after.revenue).toBeCloseTo(717.61 / rate);
  expect(after.surplus).toBe(before.surplus);
});

it("does not invent revenue or exchange rates when cost data exists", () => {
  expect(
    profitEstimate(
      snapshots.filter((s) => s.source !== "ECB Wechselkurs"),
      plan,
      wave,
      "2026-10-28",
    ),
  ).toEqual({ unavailable: "fx" });
  expect(profitEstimate(snapshots.slice(1), plan, wave, "2026-10-28")).toEqual({
    unavailable: "revenue",
  });
  const refunded = computed(
    profitEstimate(
      [snapshot("Fanvue API", { "Netto vor Betriebskosten USD": -10 }), ...snapshots.slice(1)],
      plan,
      wave,
      "2026-10-28",
    ),
  );
  expect(refunded.revenue).toBeCloseTo(-10 / rate);
});

it("preserves a mid-period subscription cancellation instead of rewriting earlier days", () => {
  const cancellation = snapshot(
    "CupidBot laufende Abos (Portal)",
    {
      "Aktive Abos": 0,
      "Monatliche Tarife USD": 0,
      "Wöchentliche Tarife USD": 0,
    },
    "2026-10-15",
    "2026-10-15",
  );
  const result = computed(profitEstimate([cancellation, ...snapshots], plan, wave, "2026-10-28"));
  expect(result.subscriptionCosts).toBeCloseTo(((24 * 14) / 31 + (24 * 14) / 7) / rate);
  expect(result.monthlySubscriptionsUsd).toBe(0);
});

it("integrates dated fixed-price versions and retains historical costs after model reassignment", () => {
  const allocation = allocationPlan(
    [
      { ...rows[0], monthly_cents: 3100 },
      { ...rows[0], effective_from: "2026-10-11", monthly_cents: 6200 },
      { ...rows[0], effective_from: "2026-10-21", monthly_cents: 6200, model: "tuuva" },
    ],
    "2026-10-28",
  );
  const result = computed(profitEstimate(snapshots, allocation, null, "2026-10-28"));
  expect(result.fixed).toBeCloseTo(10 + 20);
  expect(result.fixedMonthly).toBe(0);
});

it("does not backdate the first confirmed fixed cost to the start of the month", () => {
  const allocation = allocationPlan(
    [{ ...rows[0], monthly_cents: 3100, effective_from: "2026-10-28" }],
    "2026-10-28",
  );
  const result = computed(profitEstimate(snapshots, allocation, null, "2026-10-28"));
  expect(result.fixed).toBeCloseTo(1);
  expect(result.notes).toContain(
    "Fixkosten nur für 1 von 28 Tagen bestätigt; frühere Tage nicht enthalten.",
  );
});

it("a planned price revision does not replace the confirmed running cost", () => {
  const allocation = allocationPlan(
    [
      { ...rows[0], monthly_cents: 3100 },
      { ...rows[0], monthly_cents: 6200, effective_from: "2026-10-15", planned: true },
    ],
    "2026-10-28",
  );
  const result = computed(profitEstimate(snapshots, allocation, null, "2026-10-28"));
  expect(result.fixed).toBeCloseTo(28);
  expect(result.fixedMonthly).toBe(31);
});

it("ignores future exchange rates and uses the latest revenue period despite a late older import", () => {
  const importedOld = {
    ...snapshot("Fanvue API", { "Netto vor Betriebskosten USD": 999 }, "2026-09-01", "2026-09-30"),
    observed_at: "2026-11-03T23:00:00Z",
  };
  const futureRate = snapshot("ECB Wechselkurs", { "USD pro EUR": 9 }, "2026-12-01", "2026-12-01");
  const result = computed(
    profitEstimate([futureRate, importedOld, ...november], plan, null, "2026-11-03"),
  );
  expect(result.rate).toBe(rate);
  expect(result.start).toBe("2026-11-01");
  expect(result.revenue).toBe(0);
});

it("rejects invalid calendar periods without treating them as a zero-profit month", () => {
  expect(
    profitEstimate(
      [
        snapshot("Fanvue API", { "Netto vor Betriebskosten USD": 100 }, "2026-02-30", "2026-03-05"),
        ...snapshots.slice(1),
      ],
      plan,
      null,
      "2026-10-28",
    ),
  ).toEqual({ unavailable: "revenue" });
});
