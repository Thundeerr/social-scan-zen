import { destination } from "./smartlinks";
import type { ProviderId } from "./smartlink-providers";
export function providerConfiguration() {
  return [{ id: "bitly", configured: Boolean(process.env.BITLY_ACCESS_TOKEN && process.env.BITLY_GROUP_GUID) }, { id: "tinyurl", configured: Boolean(process.env.TINYURL_API_TOKEN) }, { id: "instascanner", configured: true }];
}
export type ProviderResult = { state: "ready" | "failed" | "uncertain"; url?: string; error?: string };
export async function createProviderLink(provider: Exclude<ProviderId, "instascanner">, trackingUrl: string, fetcher: typeof fetch = fetch): Promise<ProviderResult> {
  const token = provider === "bitly" ? process.env.BITLY_ACCESS_TOKEN : process.env.TINYURL_API_TOKEN;
  if (!token || (provider === "bitly" && !process.env.BITLY_GROUP_GUID)) return { state: "failed", error: "not_configured" };
  try {
    const response = await fetcher(provider === "bitly" ? "https://api-ssl.bitly.com/v4/shorten" : "https://api.tinyurl.com/create", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(provider === "bitly" ? { long_url: trackingUrl, domain: "bit.ly", group_guid: process.env.BITLY_GROUP_GUID } : { url: trackingUrl, domain: "tinyurl.com" }),
    });
    if (!response.ok) return { state: response.status >= 500 ? "uncertain" : "failed", error: `http_${response.status}` };
    const json = await response.json();
    const url = destination(provider === "bitly" ? json.link : json.data?.tiny_url);
    if (new URL(url).hostname !== (provider === "bitly" ? "bit.ly" : "tinyurl.com")) return { state: "uncertain", error: "unexpected_domain" };
    return { state: "ready", url };
  } catch { return { state: "uncertain", error: "response_unconfirmed" }; }
}

