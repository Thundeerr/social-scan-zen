export type CostAllocation = {
  reference: string;
  label: string;
  model: "kiikii" | "tuuva";
  currency: "EUR" | "USD";
  monthly_cents: number;
  effective_from: string;
  planned: boolean;
  note: string;
};
export function allocationPlan(rows: CostAllocation[], day: string) {
  const latest = new Map<string, CostAllocation>();
  for (const row of rows) {
    if (row.effective_from > day) continue;
    const prior = latest.get(row.reference);
    if (!prior || prior.effective_from < row.effective_from) latest.set(row.reference, row);
  }
  const entries = [...latest.values()];
  const totals = { kiikii: { EUR: 0, USD: 0 }, tuuva: { EUR: 0, USD: 0 } };
  for (const r of entries) totals[r.model][r.currency] += r.monthly_cents;
  return { entries, totals };
}
export const money = (cents: number, currency: "EUR" | "USD") =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
export const mixedMoney = (totals: { EUR: number; USD: number }) =>
  `${money(totals.EUR, "EUR")} + ${money(totals.USD, "USD")}`;
