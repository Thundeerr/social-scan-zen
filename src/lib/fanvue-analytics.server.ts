import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FANVUE_CALLBACK,
  FANVUE_CLIENT_ID,
  FANVUE_SCOPES,
  berlinMidnight,
  summarizeEarnings,
  type Earning,
} from "./fanvue-analytics";
import { berlinTime } from "./business-report";
const db = () => supabaseAdmin as SupabaseClient;
export const FANVUE_OWNER = "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Secrets = {
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  uuid?: string;
};
function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("Fanvue-Verbindung konnte nicht gespeichert oder gelesen werden.");
  return r.data;
}
function owner(user: string) {
  if (user !== FANVUE_OWNER) throw new Error("Nur für den Kiikii-Betreiber verfügbar.");
}
async function secret(user: string): Promise<Secrets> {
  return check(await db().rpc("fanvue_secret_get", { p_user: user }));
}
async function save(user: string, value: Secrets, lease: string | null = null) {
  check(await db().rpc("fanvue_secret_put", { p_user: user, p_value: value, p_lease: lease }));
}
async function metadata(user: string) {
  return check(await db().from("fanvue_connections").select("*").eq("user_id", user).maybeSingle());
}
export async function fanvueStatus(user: string) {
  owner(user);
  const m = await metadata(user);
  return {
    configured: !!m,
    connected: !!m?.connected,
    needsReconnect: !!m?.needs_reconnect || !!m?.refresh_pending,
    handle: m?.handle ?? null,
    lastSynced: m?.last_synced_at ?? null,
    error: m?.last_error ?? null,
  };
}
export async function configureFanvue(user: string, clientSecret: string) {
  owner(user);
  if (await metadata(user))
    throw new Error("Zugang ist bereits gespeichert. Er wird nicht überschrieben.");
  await save(user, { clientSecret });
  return fanvueStatus(user);
}
export async function beginFanvue(user: string) {
  owner(user);
  if (!(await secret(user))?.clientSecret)
    throw new Error("Bitte zuerst den Client Secret hinterlegen.");
  const state = randomBytes(32).toString("base64url"),
    browser = randomBytes(32).toString("base64url"),
    verifier = randomBytes(32).toString("base64url");
  check(await db().from("fanvue_oauth_states").delete().lt("expires_at", new Date().toISOString()));
  check(
    await db()
      .from("fanvue_oauth_states")
      .insert({
        user_id: user,
        state_hash: hash(state),
        browser_hash: hash(browser),
        verifier,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      }),
  );
  const url = new URL("https://auth.fanvue.com/oauth2/auth");
  url.search = new URLSearchParams({
    client_id: FANVUE_CLIENT_ID,
    redirect_uri: FANVUE_CALLBACK,
    response_type: "code",
    scope: ["openid", "offline_access", "offline", ...FANVUE_SCOPES].join(" "),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.toString(), browser };
}
async function lease(user: string) {
  const id = randomUUID();
  const row = check(
    await db()
      .from("fanvue_connections")
      .update({ lease_id: id, lease_until: new Date(Date.now() + 300000).toISOString() })
      .eq("user_id", user)
      .lt("lease_until", new Date().toISOString())
      .select("user_id")
      .maybeSingle(),
  );
  if (!row) throw new Error("Fanvue wird gerade bearbeitet. Bitte kurz warten.");
  return id;
}
async function update(user: string, id: string, fields: Record<string, unknown>) {
  const row = check(
    await db()
      .from("fanvue_connections")
      .update(fields)
      .eq("user_id", user)
      .eq("lease_id", id)
      .select("user_id")
      .maybeSingle(),
  );
  if (!row) throw new Error("Fanvue-Verbindung wurde zwischenzeitlich geändert.");
}
async function release(user: string, id: string) {
  await update(user, id, { lease_until: new Date(0).toISOString(), lease_id: null });
}
class FanvueTokenError extends Error {}

export async function exchangeFanvue(s: Secrets, params: Record<string, string>): Promise<Secrets> {
  let res: Response;
  try {
    res = await fetch("https://auth.fanvue.com/oauth2/token", {
    method: "POST",
    // Workers supports manual, not error. Non-2xx responses below fail closed.
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${FANVUE_CLIENT_ID}:${s.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams(params),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new FanvueTokenError(
      name === "TimeoutError" || name === "AbortError"
        ? "Fanvue-Tokenaustausch: Zeitlimit beim Verbindungsaufbau."
        : "Fanvue-Tokenaustausch: Netzwerkverbindung zum Anbieter fehlgeschlagen.",
    );
  }
  if (!res.ok) {
    const failure = await res.json().catch(() => ({}));
    if (failure.error === 'invalid_client') throw new Error('Fanvue lehnt die App-Zugangsdaten ab (invalid_client). Client Secret prüfen.');
    if (failure.error === 'invalid_grant') throw new Error('Fanvue hat den Anmeldecode abgelehnt (invalid_grant). Bitte neu verbinden.');
    const allowedCodes = ["invalid_request", "unauthorized_client", "unsupported_grant_type", "invalid_scope", "server_error", "temporarily_unavailable"];
    const code = allowedCodes.includes(failure.error) ? `, ${failure.error}` : "";
    throw new FanvueTokenError(`Fanvue-Tokenaustausch fehlgeschlagen (HTTP ${res.status}${code}).`);
  }
  const t = await res.json();
  const scopes = typeof t.scope === "string" ? t.scope.split(" ") : [];
  if (
    typeof t.access_token !== "string" ||
    typeof t.refresh_token !== "string" ||
    !Number.isFinite(Number(t.expires_in)) ||
    Number(t.expires_in) <= 0 ||
    FANVUE_SCOPES.some((v) => !scopes.includes(v))
  )
    throw new Error("Fanvue hat die benötigten Leserechte oder Tokens nicht geliefert.");
  return {
    ...s,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + Number(t.expires_in) * 1000,
    scopes,
  };
}
export async function fanvueGet(token: string, path: string, params: Record<string, string> = {}) {
  if (!["/users/me", "/insights/earnings"].includes(path))
    throw new Error("Unbekannter Analytics-Endpunkt.");
  const url = new URL("https://api.fanvue.com/v1" + path);
  url.search = new URLSearchParams(params).toString();
  const res = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, "X-Fanvue-API-Version": "2025-06-26" },
  });
  if (!res.ok)
    throw new Error(
      res.status === 401
        ? "Fanvue-Zugang abgelaufen. Bitte neu verbinden."
        : `Fanvue-Abruf fehlgeschlagen (HTTP ${res.status}). Alte Zahlen bleiben erhalten.`,
    );
  return res.json();
}
function verifyProfile(
  profile: { uuid?: string; handle?: string; isCreator?: boolean },
  expected?: string,
) {
  if (
    !profile.uuid ||
    profile.handle !== "kiikiixoxo" ||
    profile.isCreator !== true ||
    (expected && profile.uuid !== expected)
  )
    throw new Error(
      "Bitte den Fanvue-Creator @kiikiixoxo verbinden. Es wurden keine fremden Zahlen übernommen.",
    );
}
export async function completeFanvue(state: string, browser: string, code: string) {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/.test(browser) ||
    !code ||
    code.length > 4096
  )
    throw new Error("Anmeldung ungültig oder abgelaufen.");
  const row = check(
    await db()
      .from("fanvue_oauth_states")
      .delete()
      .eq("state_hash", hash(state))
      .eq("browser_hash", hash(browser))
      .gt("expires_at", new Date().toISOString())
      .select("user_id,verifier")
      .maybeSingle(),
  );
  if (!row) throw new Error("Anmeldung ungültig, abgelaufen oder bereits verwendet.");
  owner(row.user_id);
  const id = await lease(row.user_id);
  let stage = 'Tokenaustausch';
  try {
    const s = await exchangeFanvue(await secret(row.user_id), {
      grant_type: "authorization_code",
      code,
      redirect_uri: FANVUE_CALLBACK,
      code_verifier: row.verifier,
    });
    stage = 'Kontoprüfung';
    const profile = await fanvueGet(s.accessToken!, "/users/me");
    verifyProfile(profile);
    stage = 'Verschlüsselte Speicherung';
    await save(row.user_id, { ...s, uuid: profile.uuid }, id);
    await update(row.user_id, id, {
      handle: profile.handle,
      connected: true,
      needs_reconnect: false,
      refresh_pending: false,
      last_error: null,
      last_attempt_at: null,
    });
  } catch (error) {
    const safeMessages = [
      'Fanvue lehnt die App-Zugangsdaten ab (invalid_client). Client Secret prüfen.',
      'Fanvue hat den Anmeldecode abgelehnt (invalid_grant). Bitte neu verbinden.',
      'Fanvue hat die benötigten Leserechte oder Tokens nicht geliefert.',
      'Bitte den Fanvue-Creator @kiikiixoxo verbinden. Es wurden keine fremden Zahlen übernommen.',
    ];
    const message = error instanceof FanvueTokenError || (error instanceof Error && safeMessages.includes(error.message))
      ? error.message : `${stage} fehlgeschlagen. Bitte Verbindung prüfen.`;
    await update(row.user_id,id,{last_error:message});
    throw new Error(message);
  } finally {
    await release(row.user_id, id);
  }
}
export async function disconnectFanvue(user: string) {
  owner(user);
  const id = await lease(user);
  try {
    const s = await secret(user);
    await save(user, { clientSecret: s.clientSecret }, id);
    await update(user, id, {
      connected: false,
      needs_reconnect: false,
      refresh_pending: false,
      last_error: null,
    });
  } finally {
    await release(user, id);
  }
}
export async function earningsPages(token: string, start: string, end: string) {
  const rows: Earning[] = [],
    seen = new Set<string>();
  let cursor: string | undefined;
  const deadline = Date.now() + 120000;
  for (let page = 0; page < 100; page++) {
    if (Date.now() > deadline) break;
    const p = await fanvueGet(token, "/insights/earnings", {
      startDate: start,
      endDate: end,
      size: "50",
      ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(p.data) || !(p.nextCursor === null || typeof p.nextCursor === "string"))
      throw new Error("Unvollständige Fanvue-Antwort. Alte Zahlen bleiben erhalten.");
    rows.push(...p.data);
    if (p.nextCursor === null) return rows;
    if (!p.nextCursor || seen.has(p.nextCursor))
      throw new Error("Fanvue-Seiten wiederholen sich. Keine Teilzahlen gespeichert.");
    seen.add(p.nextCursor);
    cursor = p.nextCursor;
  }
  throw new Error("Fanvue-Abruf zu groß oder zu langsam. Keine Teilzahlen gespeichert.");
}
export async function syncFanvue(user: string, manual = false, now = new Date()) {
  owner(user);
  const m = await metadata(user);
  if (!m?.connected || m.needs_reconnect) return { skipped: true };
  if (m.last_attempt_at && Date.now() - Date.parse(m.last_attempt_at) < 600000)
    return { skipped: true };
  if (
    !manual &&
    m.last_synced_at &&
    berlinTime(new Date(m.last_synced_at)).day === berlinTime(now).day &&
    berlinTime(new Date(m.last_synced_at)).hour >= 19
  )
    return { skipped: true };
  const id = await lease(user);
  try {
    const current = await metadata(user);
    if (
      !current?.connected ||
      current.needs_reconnect ||
      (current.last_attempt_at && Date.now() - Date.parse(current.last_attempt_at) < 600000)
    )
      return { skipped: true };
    await update(user, id, { last_attempt_at: new Date().toISOString() });
    let s = await secret(user);
    // A crashed/lost single-use refresh must never be replayed.
    if (current.refresh_pending)
      throw new Error("Token-Erneuerung unbestätigt. Bitte Fanvue neu verbinden.");
    if (!s.accessToken || !s.refreshToken) throw new Error("Bitte Fanvue neu verbinden.");
    if (!s.expiresAt || s.expiresAt < Date.now() + 300000) {
      await update(user, id, { refresh_pending: true });
      try {
        s = await exchangeFanvue(s, { grant_type: "refresh_token", refresh_token: s.refreshToken });
        await save(user, s, id);
      } catch {
        await update(user, id, { needs_reconnect: true });
        throw new Error("Token-Erneuerung unbestätigt. Bitte Fanvue neu verbinden.");
      }
      await update(user, id, { refresh_pending: false });
    }
    const profile = await fanvueGet(s.accessToken!, "/users/me");
    verifyProfile(profile, s.uuid);
    const day = berlinTime(now).day,
      month = day.slice(0, 7) + "-01",
      start = berlinMidnight(month),
      end = now.toISOString();
    const rows = await earningsPages(s.accessToken!, start, end),
      total = summarizeEarnings(rows, start, end),
      today = summarizeEarnings(rows, berlinMidnight(day), end);
    const values: Record<string, number> = {
      "Brutto USD": total.gross / 100,
      "Netto vor Betriebskosten USD": total.net / 100,
      "Heute netto USD": today.net / 100,
      "Heute brutto USD": today.gross / 100,
      "Erste Abo-Zahlungen (nicht neue Personen)": total.payments,
    };
    for (const [source, cents] of Object.entries(total.sources))
      values[`Netto ${source} USD`] = cents / 100;
    if (Number.isSafeInteger(profile.fanCounts?.subscribersCount))
      values["Subs gesamt"] = profile.fanCounts.subscribersCount;
    if (Number.isSafeInteger(profile.fanCounts?.followersCount))
      values["Follower gesamt"] = profile.fanCounts.followersCount;
    check(
      await db().from("business_metric_snapshots").upsert(
        {
          user_id: user,
          source: "Fanvue API",
          period_start: month,
          period_end: day,
          observed_at: end,
          values,
          note: "Offizielle API · @kiikiixoxo · Monat bis Abrufzeit, Europe/Berlin. Netto inklusive gebuchter Rückerstattungen/Chargebacks/Korrekturen, vor Betriebskosten. Abo-Zahlungen sind keine Anzahl neuer Personen. Subs/Follower sind der aktuelle Bestand. App-Käufe nicht als Einnahmen gezählt.",
        },
        { onConflict: "user_id,source,period_start,period_end" },
      ),
    );
    await update(user, id, { last_synced_at: end, last_error: null });
    return { synced: true };
  } catch (e) {
    const message =
      e instanceof Error && !/fetch|JSON|Unexpected|timeout/i.test(e.message)
        ? e.message
        : "Fanvue gerade nicht erreichbar. Alte Zahlen bleiben erhalten.";
    await update(user, id, {
      last_error: message.slice(0, 250),
      ...(/neu verbinden/.test(message) ? { needs_reconnect: true } : {}),
    });
    throw new Error(message);
  } finally {
    await release(user, id);
  }
}
