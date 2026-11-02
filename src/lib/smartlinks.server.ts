import { createProviderLink, providerConfiguration } from "./smartlink-providers.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyHit, destination, smartlinkAction, type SmartlinkAction } from "./smartlinks";

const db = supabaseAdmin as SupabaseClient;
export function domains(value = process.env.SMARTLINK_DOMAINS || "") {
  return [
    ...new Set(
      value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const url = new URL(destination(s));
          if (url.pathname !== "/" || url.search || url.hash)
            throw new Error("SMARTLINK_DOMAINS muss HTTPS-Origins enthalten.");
          return url.origin;
        }),
    ),
  ];
}
function checked<T>(r: { data: T; error: unknown }): T {
  if (r.error) {
    // No SQL payloads, targets, recipients or secrets in logs.
    const code =
      typeof r.error === "object" && r.error && "code" in r.error
        ? String(r.error.code)
        : "unknown";
    console.error("smartlink_database_error", code);
    throw new Error(
      "SmartLink-Auftrag nicht bestätigt. Einrichtung, Berechtigungen oder Limits prüfen.",
    );
  }
  return r.data;
}
export async function smartlinkCommand(user: string, raw: SmartlinkAction) {
  const data = smartlinkAction.parse(raw);
  const roles = checked(await db.from("user_roles").select("role").eq("user_id", user));
  if (!roles?.some((r) => ["owner", "cofounder"].includes(r.role)))
    throw new Error("Nicht freigegeben.");
  if (!checked(await db.rpc("sl_rate", { p_key: `operator:${user}`, p_max: 120, p_seconds: 60 })))
    throw new Error("Zu viele Anfragen. Bitte eine Minute warten.");
  if (data.action === "provider_stats") return checked(await db.rpc("sl_provider_stats", { p_user: user, p: data.filter }));
  if (data.action === "retry_provider") {
    checked(await db.from("sl_links").update({provider_state:"pending",provider_error:null}).eq("user_id",user).eq("provider",data.provider).eq("provider_state","failed"));
    return {ok:true};
  }
  if (data.action === "process_provider") {
    if (!providerConfiguration().find(p => p.id === data.provider)?.configured) throw new Error("Provider nicht verbunden. Server-Zugang einrichten.");
    if (!checked(await db.rpc("sl_rate", { p_key: `provider:${data.provider}`, p_max: 20, p_seconds: 60 }))) return { state: "throttled" };
    const job = checked(await db.rpc("sl_provider_claim", { p_user: user, p_provider: data.provider }));
    if (!job) return { state: "stopped" };
    const result = await createProviderLink(data.provider, job.domain + "/s/" + job.slug);
    checked(await db.from("sl_links").update({ provider_state: result.state, short_url: result.url || null, provider_error: result.error || null }).eq("id", job.id).eq("user_id", user).eq("provider_state", "processing"));
    return { state: result.state };
  }
  if (data.action === "generate") {
    const missing = data.providers.filter(id => !providerConfiguration().find(p => p.id === id)?.configured);
    if (missing.length) throw new Error("Provider nicht verbunden: " + missing.join(", "));

    if (!domains().includes(data.domain))
      throw new Error("Shortlink-Domain noch nicht eingerichtet.");
    if (
      domains().includes(new URL(data.target).origin) &&
      new URL(data.target).pathname.startsWith("/s/")
    )
      throw new Error("SmartLink-Schleifen sind nicht erlaubt.");
  }
  if (
    data.action === "update_links" &&
    data.target &&
    domains().includes(new URL(data.target).origin) &&
    new URL(data.target).pathname.startsWith("/s/")
  )
    throw new Error("SmartLink-Schleifen sind nicht erlaubt.");
  if (data.action === "analytics")
    return checked(await db.rpc("sl_analytics", { p_user: user, p: data.filter }));
  const result = checked(
    await db.rpc("sl_command", { p_user: user, p_action: data.action, p: data }),
  );
  return data.action === "overview"
    ? {
        ...result,
        domains: domains(),
        providers: providerConfiguration(),
        trackingReady: Boolean(
          process.env.SMARTLINK_HASH_SECRET?.length &&
          process.env.SMARTLINK_HASH_SECRET.length >= 32,
        ),
      }
    : result;
}

export type RedirectLink = {
  id: string;
  campaign_id: string;
  domain: string;
  target: string;
  active: boolean;
};
type RedirectDependencies = {
  domains: string[];
  lookup: (slug: string, domain: string) => Promise<RedirectLink | null>;
  rate: (key: string, max: number, seconds: number) => Promise<boolean>;
  record: (event: Record<string, unknown>) => Promise<void>;
  secret?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
  trusted?: { ip?: string; country?: string };
  now?: () => Date;
};
export async function visitorHash(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function redirectRequest(request: Request, deps: RedirectDependencies) {
  const headers = {
    "Cache-Control": "no-store, private",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Type": "text/plain; charset=utf-8",
  };
  const reply = (text: string, status: number) =>
    new Response(request.method === "HEAD" ? null : text, { status, headers });
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...headers, Allow: "GET, HEAD" },
    });
  const url = new URL(request.url);
  const slug = /^\/s\/([a-f0-9]{32})$/.exec(url.pathname)?.[1];
  if (!slug || !deps.domains.includes(url.origin)) return reply("Link nicht gefunden.", 404);
  try {
    // One bounded global bucket protects lookup/storage even without trusted client IP.
    if (!(await deps.rate("redirect:global", 3000, 60)))
      return new Response("Bitte später erneut versuchen.", {
        status: 429,
        headers: { ...headers, "Retry-After": "60" },
      });
    const link = await deps.lookup(slug, url.origin);
    if (!link) return reply("Link nicht gefunden.", 404);
    if (!link.active) return reply("Dieser Link ist deaktiviert.", 410);
    let target: string;
    try {
      target = destination(link.target);
    } catch {
      return reply("Ziel nicht verfügbar.", 410);
    }
    if (deps.domains.includes(new URL(target).origin) && new URL(target).pathname.startsWith("/s/"))
      return reply("Ziel nicht verfügbar.", 410);
    const eventTask = (async () => {
      const now = (deps.now || (() => new Date()))();
      const hit = classifyHit(request);
      const secret = deps.secret && deps.secret.length >= 32 ? deps.secret : null;
      const ip = deps.trusted?.ip;
      const hash =
        secret && ip && hit.kind === "human"
          ? await visitorHash(
              secret,
              `${now.toISOString().slice(0, 10)}|${link.campaign_id}|${ip}|${hit.device}`,
            )
          : null;
      if (secret && ip) {
        const key = await visitorHash(secret, `${now.toISOString().slice(0, 10)}|${ip}`);
        if (!(await deps.rate(`track:${key}`, 60, 60))) return;
      }
      await deps.record({
        id: crypto.randomUUID(),
        link_id: link.id,
        created_at: now.toISOString(),
        ...hit,
        country: /^[A-Z]{2}$/.test(deps.trusted?.country || "") ? deps.trusted!.country : "ZZ",
        visitor_hash: hash,
      });
    })().catch(() => {
      console.error("smartlink_tracking_failed");
    });
    if (deps.waitUntil) deps.waitUntil(eventTask);
    else await eventTask;
    return new Response(null, { status: 302, headers: { ...headers, Location: target } });
  } catch {
    return reply("Weiterleitung vorübergehend nicht verfügbar.", 503);
  }
}
export async function handleSmartlinkRedirect(
  request: Request,
  ctx?: { waitUntil?: (p: Promise<unknown>) => void },
) {
  // Nitro augments the original Cloudflare request, rather than forwarding fetch's ctx.
  const runtimeRequest = request as Request & { waitUntil?: (p: Promise<unknown>) => void };
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  return redirectRequest(request, {
    domains: domains(),
    secret: process.env.SMARTLINK_HASH_SECRET,
    // Never trust forwarded country/IP headers on arbitrary non-Cloudflare runtimes.
    trusted: cf
      ? { country: cf.country, ip: request.headers.get("cf-connecting-ip") || undefined }
      : undefined,
    waitUntil: ctx?.waitUntil?.bind(ctx) ?? runtimeRequest.waitUntil?.bind(runtimeRequest),
    lookup: async (slug, domain) =>
      checked(
        await db
          .from("sl_links")
          .select("id,campaign_id,domain,target,active")
          .eq("slug", slug)
          .eq("domain", domain)
          .maybeSingle(),
      ),
    rate: async (key, max, seconds) =>
      checked(await db.rpc("sl_rate", { p_key: key, p_max: max, p_seconds: seconds })),
    record: async (event) => {
      checked(
        await db.from("sl_events").upsert(event, { onConflict: "id", ignoreDuplicates: true }),
      );
    },
  });
}
