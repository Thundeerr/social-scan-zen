export const CLOSER_ACCOUNT_ID = "17841416918437774";
const labels: Record<string, string> = {
  "Conversations raw": "Gespräche gesamt",
  "Conversations charged": "Berechnete Gespräche",
  "CTA phase started": "CTA gestartet",
  "Shared CTA link": "Link verschickt",
  "Conversions from CTA link shared": "Conversions nach Link (Closer)",
  Conversions: "Conversions (Closer, keine bestätigten Subs)",
};
export function parseCloserAnalytics(payload: unknown) {
  const p = payload as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(p?.columns) || p.columns.length !== 2 || !Array.isArray(p.rows))
    throw new Error("Unbekanntes Closer-Zahlenformat.");
  const result: Record<string, number> = {};
  const seen = new Set<string>();
  for (const row of p.rows) {
    if (!row || typeof row.name !== "string" || !Object.hasOwn(labels, row.name)) continue;
    if (seen.has(row.name) || !Array.isArray(row.values) || row.values.length !== 1)
      throw new Error("Unbekanntes Closer-Zahlenformat.");
    seen.add(row.name);
    const value = row.values[0];
    if (value === "-") continue;
    if (typeof value !== "string") throw new Error("Unbekanntes Closer-Zahlenformat.");
    const match = value.match(/^(\d+|\d{1,3}(?:,\d{3})+)(?:\s+\([^)]*\))?$/);
    if (!match) throw new Error("Unbekanntes Closer-Zahlenformat.");
    const count = Number(match[1].replaceAll(",", ""));
    if (!Number.isSafeInteger(count)) throw new Error("Unbekanntes Closer-Zahlenformat.");
    result[labels[row.name]] = count;
  }
  if (seen.size !== Object.keys(labels).length || result["Gespräche gesamt"] === undefined)
    throw new Error("Unvollständige Closer-Zahlen.");
  return result;
}
