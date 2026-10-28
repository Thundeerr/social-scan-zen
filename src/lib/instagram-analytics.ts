export const IG_INSIGHTS_SCOPE = "instagram_business_manage_insights";
export type ReelInsight = {
  id: string;
  url: string | null;
  caption: string;
  publishedAt: string;
  metrics: Record<string, number>;
};
export function metricValues(payload: unknown): Record<string, number> {
  const data = (payload as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error("Instagram lieferte keine gültige Statistik.");
  const result: Record<string, number> = {};
  for (const item of data) {
    const value = item?.total_value?.value ?? item?.values?.[0]?.value;
    if (
      typeof item?.name === "string" &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
    )
      result[item.name] = value;
  }
  return result;
}
export function safeInstagramLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      ["www.instagram.com", "instagram.com"].includes(url.hostname) &&
      /^\/(reel|reels|p)\/[\w-]+\/?$/.test(url.pathname)
      ? url.origin + url.pathname
      : null;
  } catch {
    return null;
  }
}
