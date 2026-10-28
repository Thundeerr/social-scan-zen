import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { IG_API_BASE_URL } from "./instagram-oauth";
import {
  IG_INSIGHTS_SCOPE,
  metricValues,
  safeInstagramLink,
  type ReelInsight,
} from "./instagram-analytics";
import { berlinTime } from "./business-report";
const db = () => supabaseAdmin as SupabaseClient;
const OWNER = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
function owner(user: string) {
  if (user !== OWNER) throw new Error("Nur für den Kiikii-Betreiber verfügbar.");
}
function checked<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("Instagram-Statistik konnte nicht gespeichert oder gelesen werden.");
  return r.data;
}
async function connection(user: string) {
  return checked(
    await db()
      .from("ig_connections")
      .select("ig_user_id,ig_username,status,token_expires_at,granted_scopes,login_type")
      .eq("user_id", user)
      .eq("destination", "kiikii")
      .maybeSingle(),
  );
}
export async function instagramAnalyticsStatus(user: string) {
  owner(user);
  const [c, s, history] = await Promise.all([
    connection(user),
    db()
      .from("instagram_analytics_state")
      .select("last_synced_at,last_error,reels,warnings")
      .eq("user_id", user)
      .maybeSingle()
      .then(checked),
    db()
      .from("business_metric_snapshots")
      .select("period_end,observed_at,values")
      .eq("user_id", user)
      .eq("source", "Instagram API")
      .order("period_end", { ascending: false })
      .limit(30)
      .then(checked),
  ]);
  return {
    connected:
      c?.status === "active" &&
      c?.ig_username === "kiikii.bat" &&
      Date.parse(c?.token_expires_at ?? "") > Date.now(),
    insightsGranted: !!c?.granted_scopes?.includes(IG_INSIGHTS_SCOPE),
    lastSynced: s?.last_synced_at ?? null,
    error: s?.last_error ?? null,
    reels: (s?.reels ?? []) as ReelInsight[],
    warnings: (s?.warnings ?? []) as string[],
    history: (history ?? []).map((h) => ({
      day: h.period_end as string,
      followers: (h.values as Record<string, number>)["Follower gesamt"],
    })),
  };
}
export async function instagramAnalyticsGet(
  token: string,
  path: string,
  params: Record<string, string> = {},
) {
  if (!/^\d+(\/(insights|media))?$/.test(path)) throw new Error("Ungültiger Statistik-Endpunkt.");
  const url = new URL(`${IG_API_BASE_URL}/${path}`);
  url.search = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("Instagram gerade nicht erreichbar. Alte Zahlen bleiben erhalten.");
  }
  if (!res.ok)
    throw new Error(
      `Instagram-Statistik nicht verfügbar (HTTP ${res.status}). Rechte oder Verbindung prüfen.`,
    );
  return res.json().catch(() => {
    throw new Error("Instagram lieferte keine gültige Statistik.");
  });
}
export async function syncInstagramAnalytics(user: string, manual = false, now = new Date()) {
  owner(user);
  const c = await connection(user);
  if (
    !c ||
    c.status !== "active" ||
    c.ig_username !== "kiikii.bat" ||
    c.login_type !== "instagram_login"
  )
    throw new Error("Bitte zuerst @kiikii.bat verbinden.");
  if (!(Date.parse(c.token_expires_at ?? "") > now.getTime()))
    throw new Error("Instagram-Zugang abgelaufen. Bitte erneut verbinden.");
  checked(
    await db()
      .from("instagram_analytics_state")
      .upsert({ user_id: user }, { onConflict: "user_id", ignoreDuplicates: true }),
  );
  const state = checked(
    await db()
      .from("instagram_analytics_state")
      .select("last_synced_at")
      .eq("user_id", user)
      .single(),
  );
  if (
    !manual &&
    state?.last_synced_at &&
    berlinTime(new Date(state.last_synced_at)).day === berlinTime(now).day &&
    berlinTime(new Date(state.last_synced_at)).time >= "19:55"
  )
    return { skipped: true };
  // One caller wins; failed calls are also throttled. All provider work is bounded.
  const claim = checked(
    await db()
      .from("instagram_analytics_state")
      .update({ last_attempt_at: now.toISOString() })
      .eq("user_id", user)
      .lt("last_attempt_at", new Date(now.getTime() - 600000).toISOString())
      .select("user_id")
      .maybeSingle(),
  );
  if (!claim) return { skipped: true };
  try {
    const secret = checked(
      await db()
        .from("ig_connections")
        .select("page_access_token")
        .eq("user_id", user)
        .eq("destination", "kiikii")
        .eq("ig_user_id", c.ig_user_id)
        .single(),
    );
    if (!secret?.page_access_token) throw new Error("Bitte Instagram erneut verbinden.");
    const get = (path: string, params: Record<string, string>) =>
      instagramAnalyticsGet(secret.page_access_token, path, params);
    const profile = await get(c.ig_user_id, {
      fields: "user_id,username,followers_count,media_count",
    });
    if (
      String(profile.user_id ?? profile.id) !== c.ig_user_id ||
      profile.username !== "kiikii.bat" ||
      !Number.isSafeInteger(profile.followers_count) ||
      profile.followers_count < 0
    )
      throw new Error(
        "Instagram-Konto oder Followerzahl nicht bestätigt. Alte Zahlen bleiben erhalten.",
      );
    const until = Math.floor(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000,
    );
    const since = until - 7 * 86400;
    const values: Record<string, number> = { "Follower gesamt": profile.followers_count };
    const warnings: string[] = [];
    const reels: ReelInsight[] = [];
    if (c.granted_scopes?.includes(IG_INSIGHTS_SCOPE)) {
      await Promise.all(
        ["views", "reach", "total_interactions", "profile_links_taps"].map(async (metric) => {
          const labels: Record<string, string> = {
            views: "Aufrufe (7 Tage)",
            reach: "Erreichte Konten (7 Tage)",
            total_interactions: "Interaktionen (7 Tage)",
            profile_links_taps: "Profil-Link-Klicks (7 Tage)",
          };
          try {
            const metrics = metricValues(
              await get(`${c.ig_user_id}/insights`, {
                metric,
                period: "day",
                metric_type: "total_value",
                since: String(since),
                until: String(until),
              }),
            );
            if (metrics[metric] !== undefined) values[labels[metric]] = metrics[metric];
            else warnings.push(`${labels[metric]}: keine Daten geliefert.`);
          } catch {
            warnings.push(`${labels[metric]}: Abruf nicht verfügbar.`);
          }
        }),
      );
      try {
        const media = await get(`${c.ig_user_id}/media`, {
          fields: "id,media_product_type,caption,permalink,timestamp",
          limit: "25",
        });
        if (!Array.isArray(media.data)) throw new Error("media");
        await Promise.all(
          media.data
            .slice(0, 25)
            .filter((m: { media_product_type?: string }) => m.media_product_type === "REELS")
            .map(
              async (m: {
                id: string;
                permalink?: string;
                caption?: string;
                timestamp: string;
              }) => {
                let metrics: Record<string, number> = {};
                try {
                  metrics = metricValues(
                    await get(`${m.id}/insights`, {
                      metric: "views,reach,likes,comments,saved,shares",
                      period: "lifetime",
                    }),
                  );
                } catch {
                  warnings.push(`Reel ${m.id}: Statistik fehlt.`);
                }
                reels.push({
                  id: m.id,
                  url: safeInstagramLink(m.permalink),
                  caption: String(m.caption ?? "").slice(0, 160),
                  publishedAt: m.timestamp,
                  metrics,
                });
              },
            ),
        );
        reels.sort((a, b) => (b.metrics.views ?? -1) - (a.metrics.views ?? -1));
      } catch {
        warnings.push("Reel-Liste nicht verfügbar.");
      }
    } else
      warnings.push(
        "Für Reichweite, Aufrufe und Reels bitte Instagram-Leserechte freigeben. Follower werden bereits automatisch erfasst.",
      );
    const day = berlinTime(now).day;
    checked(
      await db()
        .from("business_metric_snapshots")
        .upsert(
          {
            user_id: user,
            source: "Instagram API",
            period_start: day,
            period_end: day,
            observed_at: now.toISOString(),
            values,
            note: `@kiikii.bat · Followerbestand zum Abruf. Reichweite/Interaktionen: ${new Date(since * 1000).toISOString().slice(0, 10)} bis ${new Date(until * 1000 - 1).toISOString().slice(0, 10)}, sieben abgeschlossene UTC-Tage. Fehlende Werte sind unbekannt. ${warnings.join(" ")}`,
          },
          { onConflict: "user_id,source,period_start,period_end" },
        ),
    );
    checked(
      await db()
        .from("instagram_analytics_state")
        .update({ last_synced_at: now.toISOString(), last_error: null, reels, warnings })
        .eq("user_id", user),
    );
    return { synced: true };
  } catch (e) {
    const message =
      e instanceof Error && e.message.startsWith("Instagram")
        ? e.message
        : "Instagram-Abruf fehlgeschlagen. Alte Zahlen bleiben erhalten.";
    checked(
      await db()
        .from("instagram_analytics_state")
        .update({ last_error: message })
        .eq("user_id", user),
    );
    throw new Error(message);
  }
}
