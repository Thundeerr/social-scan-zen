import { berlinTime, type MetricSnapshot } from "./business-report";
import type { allocationPlan } from "./business-cost-allocation";

const DAY = 86400000;
const nonnegative = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
const date = (day: string) => {
  const time = Date.parse(day + "T00:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === day
    ? time
    : NaN;
};
const daysBetween = (start: string, end: string) => (date(end) - date(start)) / DAY + 1;
const shortDate = (day: string) => day.split("-").reverse().join(".");
function monthlyFraction(start: string, end: string) {
  let fraction = 0;
  for (let time = date(start); time <= date(end); ) {
    const d = new Date(time),
      next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const monthDays = new Date(next - DAY).getUTCDate();
    const until = Math.min(next, date(end) + DAY);
    fraction += (until - time) / DAY / monthDays;
    time = until;
  }
  return fraction;
}
function rates(s: MetricSnapshot | undefined) {
  if (!s) return null;
  const monthly = s.values["Monatliche Tarife USD"],
    weekly = s.values["Wöchentliche Tarife USD"];
  if (
    (nonnegative(monthly) || nonnegative(weekly)) &&
    (monthly === undefined || nonnegative(monthly)) &&
    (weekly === undefined || nonnegative(weekly))
  )
    return { monthly: monthly ?? 0, weekly: weekly ?? 0 };
  const average = s.values["Monatsmittel USD"];
  return nonnegative(average) ? { monthly: average, weekly: 0 } : null;
}

export function profitEstimate(
  snapshots: MetricSnapshot[],
  allocation: ReturnType<typeof allocationPlan>,
  wave: { month: string; observed: string; kiikii: number } | null | undefined,
  today = berlinTime().day,
) {
  const ordered = [...snapshots].sort(
    (a, b) =>
      Date.parse(b.observed_at) - Date.parse(a.observed_at) ||
      b.period_end.localeCompare(a.period_end),
  );
  const find = (source: string) => ordered.find((s) => s.source === source);
  const fv = find("Fanvue API"),
    closer = find("Closer Verbrauch (UI)");
  const subscriptions = ordered.filter(
    (s) =>
      ["CupidBot laufende Abos (Portal)", "CupidBot Abos (Portal)"].includes(s.source) && rates(s),
  );
  const payment = ordered.find(
    (s) =>
      ["CupidBot Abos (Portal)", "Closer Zahlungen (Revolut)"].includes(s.source) &&
      nonnegative(s.values["Bezahlt EUR"]),
  );
  const fixedRows = allocation.entries.filter(
    (r) => r.model === "kiikii" && !r.planned && nonnegative(r.monthly_cents),
  );
  const hasWave =
    !!wave &&
    Number.isFinite(wave.kiikii) &&
    wave.observed.startsWith(wave.month + "-") &&
    daysBetween(wave.month + "-01", wave.observed.slice(0, 10)) > 0;
  if (!fixedRows.length && !subscriptions.length && !payment && !hasWave) return null;
  // Missing currencies/revenue cannot honestly be replaced by zero or an invented rate.
  if (
    !fv ||
    !Number.isFinite(fv.values["Netto vor Betriebskosten USD"]) ||
    !(daysBetween(fv.period_start, fv.period_end) > 0)
  )
    return { unavailable: "revenue" as const };
  const fx = ordered
    .filter(
      (s) =>
        s.source === "ECB Wechselkurs" &&
        s.values["USD pro EUR"] > 0 &&
        Number.isFinite(s.values["USD pro EUR"]) &&
        Number.isFinite(date(s.period_end)),
    )
    .sort((a, b) => b.period_end.localeCompare(a.period_end))
    .at(0);
  if (!fx) return { unavailable: "fx" as const };
  const rate = fx.values["USD pro EUR"],
    days = daysBetween(fv.period_start, fv.period_end);
  const fraction = monthlyFraction(fv.period_start, fv.period_end);
  const fxStale = (date(today) - date(fx.period_end)) / DAY > 7;
  const notes: string[] = [];
  const costDates: string[] = [];
  const rows = fixedRows.filter((r) => r.effective_from <= fv.period_end);
  const fixedMonthly = rows.reduce(
    (sum, r) => sum + r.monthly_cents / 100 / (r.currency === "USD" ? rate : 1),
    0,
  );
  const fixed = fixedMonthly * fraction;
  costDates.push(...rows.map((r) => r.effective_from));
  if (!rows.length) notes.push("Fixkostenaufteilung fehlt; nicht enthalten.");
  // A later cancellation changes the outlook, never an earlier period's rate.
  const subscription = subscriptions.find((s) => s.period_end <= fv.period_end);
  const current = subscriptions.at(0);
  const periodRates = rates(subscription),
    currentRates = rates(current);
  let subscriptionCosts = 0;
  if (subscription && periodRates) {
    subscriptionCosts = (periodRates.monthly * fraction + (periodRates.weekly * days) / 7) / rate;
    costDates.push(subscription.period_end);
  } else if (payment && daysBetween(payment.period_start, payment.period_end) > 0) {
    subscriptionCosts =
      (payment.values["Bezahlt EUR"] * days) /
      daysBetween(payment.period_start, payment.period_end);
    costDates.push(payment.period_end);
    notes.push("Abokosten aus bestätigtem Zahlungsdurchschnitt geschätzt; Tarif fehlt.");
  } else notes.push("Abokosten fehlen; nicht enthalten.");
  let generation = 0;
  if (hasWave && wave) {
    const observed = wave.observed.slice(0, 10),
      covered = daysBetween(wave.month + "-01", observed);
    generation = (wave.kiikii * days) / covered / rate;
    costDates.push(observed);
    if (fv.period_start !== wave.month + "-01" || fv.period_end !== observed)
      notes.push(`Generierung aus dem Tagesdurchschnitt bis ${shortDate(observed)} geschätzt.`);
  } else notes.push("Generierungskosten fehlen; nicht enthalten.");
  const costDate = costDates.sort().at(0) ?? payment?.period_end ?? current?.period_end;
  const estimateLabel = `Schätzung${costDate ? `, Kosten Stand ${shortDate(costDate)}` : ""}`;
  if (fxStale)
    notes.push(`ECB-Kurs veraltet: Stand ${shortDate(fx.period_end)} (älter als 7 Tage).`);
  const monthlySubscriptionsUsd = currentRates
    ? currentRates.monthly + (currentRates.weekly * 52) / 12
    : null;
  const revenue = fv.values["Netto vor Betriebskosten USD"] / rate;
  const costs = fixed + generation + subscriptionCosts;
  const charged = closer?.values["Berechnete Gespräche"],
    price = closer?.values["Preis pro Gespräch USD"];
  return {
    start: fv.period_start,
    end: fv.period_end,
    days,
    fxDay: fx.period_end,
    rate,
    fxStale,
    estimateLabel,
    notes,
    charged,
    remaining: closer?.values["Restgespräche"],
    usageDate: closer?.period_end,
    usageUsd: nonnegative(charged) && nonnegative(price) ? charged * price : null,
    fixed,
    fixedMonthly,
    generation,
    subscriptionCosts,
    paid: payment?.values["Bezahlt EUR"] ?? null,
    paymentDate: payment?.period_end,
    revenue,
    monthlySubscriptionsUsd,
    subscriptionCount: current?.values["Aktive Abos"],
    subscriptionMonthlyUsd: current?.values["Monatliche Tarife USD"],
    subscriptionWeeklyUsd: current?.values["Wöchentliche Tarife USD"],
    subscriptionDate: current?.period_end,
    subscriptionNote: current?.note,
    costs,
    surplus: revenue - costs,
    cautiousCosts: costs,
    cautiousSurplus: revenue - costs,
    monthly:
      fixedMonthly +
      (generation / days) * 30 +
      (monthlySubscriptionsUsd === null
        ? (subscriptionCosts / days) * 30
        : monthlySubscriptionsUsd / rate),
  };
}
