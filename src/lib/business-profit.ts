import type { MetricSnapshot } from "./business-report";
import type { allocationPlan } from "./business-cost-allocation";

export function profitEstimate(
  snapshots: MetricSnapshot[],
  allocation: ReturnType<typeof allocationPlan>,
  wave: { month: string; observed: string; kiikii: number } | null | undefined,
) {
  const find = (source: string) => snapshots.find((s) => s.source === source);
  const fv = find("Fanvue API"),
    closer = find("Closer Verbrauch (UI)"),
    payments = find("Closer Zahlungen (Revolut)"),
    fx = find("ECB Wechselkurs");
  if (!fv || !closer || !payments || !fx || !wave || !allocation.entries.length) return null;
  const rate = fx.values["USD pro EUR"];
  const samePeriod = [closer, payments].every(
    (s) => s.period_start === fv.period_start && s.period_end === fv.period_end,
  );
  if (
    !samePeriod ||
    fv.period_start !== wave.month + "-01" ||
    wave.observed.slice(0, 10) !== fv.period_end ||
    !(rate > 0)
  )
    return null;
  const charged = closer.values["Berechnete Gespräche"],
    price = closer.values["Preis pro Gespräch USD"];
  const revenueUsd = fv.values["Netto vor Betriebskosten USD"],
    paid = payments.values["Bezahlt EUR"];
  if (![charged, price, revenueUsd, paid, wave.kiikii].every((n) => Number.isFinite(n) && n >= 0))
    return null;
  const fixed = allocation.totals.kiikii.EUR / 100 + allocation.totals.kiikii.USD / 100 / rate;
  const generation = wave.kiikii / rate,
    usageUsd = charged * price,
    revenue = revenueUsd / rate;
  const days = Number(fv.period_end.slice(-2));
  return {
    start: fv.period_start,
    end: fv.period_end,
    fxDay: fx.period_end,
    rate,
    charged,
    remaining: closer.values["Restgespräche"],
    usageUsd,
    fixed,
    generation,
    paid,
    revenue,
    costs: fixed + generation + usageUsd / rate,
    surplus: revenue - fixed - generation - usageUsd / rate,
    cautiousCosts: fixed + generation + paid,
    cautiousSurplus: revenue - fixed - generation - paid,
    monthly: fixed + ((generation + usageUsd / rate) / days) * 30,
  };
}
