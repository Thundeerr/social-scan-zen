import { berlinTime } from "./business-report";
export const FANVUE_CLIENT_ID = "34b093de-d381-46a1-a33f-1fe8c37fad36";
export const FANVUE_CALLBACK = "https://instascanner.app/api/public/fanvue/callback";
export const FANVUE_SCOPES = ["read:self", "read:insights"];
/** Calendar midnight in Berlin, including DST. */
export function berlinMidnight(day: string) {
  const target = Date.parse(`${day}T00:00:00Z`);
  let result = target;
  for (let i = 0; i < 3; i++) {
    const p = berlinTime(new Date(result));
    result += target - Date.parse(`${p.day}T${p.time}:00Z`);
  }
  return new Date(result).toISOString();
}
export type Earning = {
  date: string;
  gross: number;
  net: number;
  source: string;
  transactionOrderId: string;
};
export function summarizeEarnings(rows: Earning[], from: string, to: string) {
  let gross = 0,
    net = 0,
    payments = 0;
  const sources: Record<string, number> = Object.create(null);
  for (const row of rows) {
    const at = Date.parse(row.date);
    if (
      !Number.isFinite(at) ||
      !Number.isSafeInteger(row.gross) ||
      !Number.isSafeInteger(row.net) ||
      typeof row.source !== "string"
    )
      throw new Error("Fanvue liefert ein unbekanntes Zahlenformat. Alte Werte bleiben erhalten.");
    if (at < Date.parse(from) || at >= Date.parse(to)) continue;
    // App purchases are expenses, not creator revenue.
    if (row.source === "appStore") continue;
    gross += row.gross;
    net += row.net;
    sources[row.source] = (sources[row.source] ?? 0) + row.net;
    if (row.source === "subscription" && row.gross > 0) payments++;
  }
  return { gross, net, payments, sources };
}
