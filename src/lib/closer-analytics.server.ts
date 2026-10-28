import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CLOSER_ACCOUNT_ID, parseCloserAnalytics } from "./closer-analytics";
import { berlinTime } from "./business-report";
const db = () => supabaseAdmin as SupabaseClient;
const OWNER = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
function owner(user: string) {
  if (user !== OWNER) throw new Error("Nur für den Kiikii-Betreiber verfügbar.");
}
function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("Closer-Verbindung konnte nicht gelesen oder gespeichert werden.");
  return r.data;
}
async function metadata(user: string) {
  return check(
    await db()
      .from("closer_analytics_connections")
      .select("last_attempt_at,last_synced_at,last_error,verified")
      .eq("user_id", user)
      .maybeSingle(),
  );
}
export async function closerStatus(user: string) {
  owner(user);
  const s = await metadata(user);
  return {
    configured: !!s,
    verified: !!s?.verified,
    lastSynced: s?.last_synced_at ?? null,
    error: s?.last_error ?? null,
  };
}
export async function configureCloser(user: string, token: string) {
  owner(user);
  check(await db().rpc("closer_analytics_secret_put", { p_user: user, p_token: token }));
}
export async function fetchCloserAnalytics(token: string, start: string, end: string) {
  // Provider requires query authentication. Never log URL, raw fetch errors or response body.
  const url = new URL("https://x.cupidbotofm.ai/api/getAnalytics");
  url.search = new URLSearchParams({
    accessToken: token,
    viewingApps: "instagram",
    app: "instagram",
    viewingAccountID: CLOSER_ACCOUNT_ID,
    startDate: start,
    endDate: end,
    timezone: "Europe/Berlin",
  }).toString();
  let response: Response;
  try {
    response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new Error("Closer gerade nicht erreichbar. Alte Zahlen bleiben erhalten.");
  }
  if (!response.ok)
    throw new Error(
      `Closer-Abruf fehlgeschlagen (HTTP ${response.status}). Token und Zugriff prüfen.`,
    );
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("Unbekanntes Closer-Zahlenformat.");
  }
  return parseCloserAnalytics(data);
}
export async function syncCloser(user: string, manual = false, now = new Date()) {
  owner(user);
  const s = await metadata(user);
  if (!s) return { skipped: true };
  if (
    !manual &&
    s.last_synced_at &&
    berlinTime(new Date(s.last_synced_at)).day === berlinTime(now).day &&
    berlinTime(new Date(s.last_synced_at)).time >= "19:55"
  )
    return { skipped: true };
  const claim = check(
    await db()
      .from("closer_analytics_connections")
      .update({ last_attempt_at: now.toISOString() })
      .eq("user_id", user)
      .lt("last_attempt_at", new Date(now.getTime() - 600000).toISOString())
      .select("user_id")
      .maybeSingle(),
  );
  if (!claim) return { skipped: true };
  try {
    const token = check(await db().rpc("closer_analytics_secret_get", { p_user: user }));
    if (typeof token !== "string" || !token) throw new Error("Closer-Token fehlt.");
    const end = berlinTime(new Date(now.getTime() - 86400000)).day;
    const start = new Date(Date.parse(end + "T12:00:00Z") - 6 * 86400000)
      .toISOString()
      .slice(0, 10);
    const values = await fetchCloserAnalytics(token, start, end);
    check(
      await db()
        .from("business_metric_snapshots")
        .upsert(
          {
            user_id: user,
            source: "Closer API",
            period_start: start,
            period_end: end,
            observed_at: now.toISOString(),
            values,
            note: "CupidBot · @kiikii.bat · sieben abgeschlossene Kalendertage, Europe/Berlin. Accountfilter 17841416918437774. Conversions sind Anbieter-Meldungen, keine bestätigten bezahlten Fanvue-Abos. Conversions können zeitversetzt eintreffen; berechnete Gespräche sind keine Dollarbeträge.",
          },
          { onConflict: "user_id,source,period_start,period_end" },
        ),
    );
    check(
      await db()
        .from("closer_analytics_connections")
        .update({ verified: true, last_synced_at: now.toISOString(), last_error: null })
        .eq("user_id", user),
    );
    return { synced: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Closer-Abruf fehlgeschlagen.";
    // All thrown messages originate here or in the strict parser, never in provider payloads.
    check(
      await db()
        .from("closer_analytics_connections")
        .update({ last_error: message })
        .eq("user_id", user),
    );
    throw new Error(message);
  }
}
