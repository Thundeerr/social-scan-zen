export const PROVIDERS = [{ id: "bitly", name: "Bitly" }, { id: "tinyurl", name: "TinyURL" }, { id: "instascanner", name: "InstaScanner" }] as const;
export type ProviderId = typeof PROVIDERS[number]["id"];
export function distributeLinks(count: number, providers: readonly string[]) {
  if (!Number.isInteger(count) || count < 1 || count > 1000 || !providers.length || new Set(providers).size !== providers.length) return [];
  return providers.map((id, i) => ({ id, count: Math.floor(count / providers.length) + (i < count % providers.length ? 1 : 0) }));
}
export type ProviderStat = { provider: ProviderId; total: number; ready: number; pending: number; failed: number; uncertain: number; clicks: number; human: number; last_error: string | null };
export type ProviderStats = { providers: ProviderStat[]; top: {id:string; provider:ProviderId; url:string; target:string; clicks:number; human:number}[] };

