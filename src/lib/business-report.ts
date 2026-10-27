export type CostEntry = {
  reference: string;
  label: string;
  scope: "kiikii" | "shared" | "tuuva";
  kind: "fixed" | "topup" | "usage";
  cents: number;
  day: string;
  end_day: string | null;
  note: string;
};
export type MetricSnapshot = {
  source: string;
  period_start: string;
  period_end: string;
  observed_at: string;
  values: Record<string, number>;
  note: string;
};
export function berlinTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    hour: Number(get("hour")),
  };
}
export const usd = (cents: number) => `${(cents / 100).toFixed(2)} $`;
export function monthlyCosts(entries: CostEntry[], day: string) {
  const month = day.slice(0, 7);
  const active = entries.filter(
    (e) =>
      e.day <= day &&
      (e.kind === "fixed" ? !e.end_day || e.end_day >= `${month}-01` : e.day.startsWith(month)),
  );
  const sum = (kind: CostEntry["kind"], scope: CostEntry["scope"]) =>
    active.filter((e) => e.kind === kind && e.scope === scope).reduce((s, e) => s + e.cents, 0);
  return {
    fixed: sum("fixed", "kiikii"),
    sharedFixed: sum("fixed", "shared"),
    topups: sum("topup", "kiikii"),
    sharedTopups: sum("topup", "shared"),
    usage: sum("usage", "kiikii"),
    // Cash planning warns about prepaid purchases, without counting consumption twice.
    cashPlan: sum("fixed", "kiikii") + sum("topup", "kiikii"),
  };
}
export function budgetLevel(cents: number, budget: number) {
  return [100, 95, 85, 70].find((n) => cents >= (budget * n) / 100) ?? 0;
}
export function forecastCash(fixed: number, topups: number, day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return fixed + Math.round((topups / date) * new Date(Date.UTC(year, month, 0)).getUTCDate());
}
export function isStatusCommand(text: string) {
  return /^(?:status\s+kiikii|\/status(?:@[a-z0-9_]+)?(?:\s+kiikii)?)$/i.test(text.trim());
}
