/**
 * Server-only implementation of the official Instagram OAuth flow.
 *
 * Secrets (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET), the authorization code
 * and the access token never leave this module. The browser only ever sees
 * the authorize URL and the non-secret connection status.
 */

import { randomBytes } from "node:crypto";
import {
  IG_API_BASE_URL,
  IG_GRAPH_HOST,
  IG_LOGIN_TYPE,
  IG_SCOPES,
  IG_TOKEN_URL,
  OAUTH_STATE_TTL_MS,
  missingScopes,
  redactSecrets,
} from "./instagram-oauth";

export type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

export function instagramAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env["INSTAGRAM_APP_ID"];
  const clientSecret = process.env["INSTAGRAM_APP_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "Instagram app credentials are not configured (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET).",
    );
  }
  return { clientId, clientSecret };
}

export async function createOAuthState(
  db: AdminClient,
  userId: string,
  redirectUri: string,
): Promise<string> {
  await db.rpc("purge_ig_oauth_states");
  const state = randomBytes(32).toString("base64url");
  const { error } = await db.from("ig_oauth_states").insert({
    state,
    user_id: userId,
    redirect_uri: redirectUri,
    expires_at: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(error.message);
  return state;
}

/**
 * Atomically consume a state exactly once. Replays, expired states and
 * unknown states all return null.
 */
export async function consumeOAuthState(
  db: AdminClient,
  state: string,
): Promise<{ userId: string; redirectUri: string } | null> {
  if (!state || state.length > 200) return null;
  const { data, error } = await db
    .from("ig_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state", state)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id, redirect_uri")
    .maybeSingle();
  if (error || !data) return null;
  return { userId: data.user_id, redirectUri: data.redirect_uri };
}

type TokenResponse = { access_token: string; user_id?: string | number; permissions?: string };

async function readJson(response: Response, label: string) {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!response.ok || !payload) {
    const detail =
      (payload as { error_message?: string; error?: { message?: string } } | null)
        ?.error_message ??
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;
    throw new Error(`${label}: ${redactSecrets(String(detail)).slice(0, 200)}`);
  }
  return payload as Record<string, unknown>;
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const { clientId, clientSecret } = instagramAppCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const response = await fetch(IG_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await readJson(response, "Token exchange failed")) as TokenResponse;
  if (!payload.access_token) throw new Error("Token exchange failed: no access token returned");
  return {
    accessToken: payload.access_token,
    igUserId: payload.user_id != null ? String(payload.user_id) : null,
    permissions: (payload.permissions ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
}

/** Short-lived → official 60-day long-lived token. */
export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const { clientSecret } = instagramAppCredentials();
  const url = new URL(`${IG_GRAPH_HOST}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("access_token", shortLivedToken);
  const payload = await readJson(await fetch(url), "Long-lived token exchange failed");
  const accessToken = payload["access_token"] as string | undefined;
  const expiresIn = Number(payload["expires_in"] ?? 0);
  if (!accessToken) throw new Error("Long-lived token exchange failed");
  return {
    accessToken,
    expiresAt: new Date(Date.now() + (expiresIn > 0 ? expiresIn : 60 * 24 * 3600) * 1000),
  };
}

/** Official renewal for long-lived Instagram tokens (>24h old, not expired). */
export async function refreshLongLivedToken(accessToken: string) {
  const url = new URL(`${IG_GRAPH_HOST}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);
  const payload = await readJson(await fetch(url), "Token refresh failed");
  const next = payload["access_token"] as string | undefined;
  const expiresIn = Number(payload["expires_in"] ?? 0);
  if (!next) throw new Error("Token refresh failed");
  return {
    accessToken: next,
    expiresAt: new Date(Date.now() + (expiresIn > 0 ? expiresIn : 60 * 24 * 3600) * 1000),
  };
}

export async function fetchInstagramProfile(accessToken: string) {
  const url = new URL(`${IG_API_BASE_URL}/me`);
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", accessToken);
  const payload = await readJson(await fetch(url), "Profile lookup failed");
  const username = payload["username"] as string | undefined;
  const userId = payload["user_id"] ?? payload["id"];
  if (!username || !userId) throw new Error("Profile lookup failed: incomplete response");
  return { username, igUserId: String(userId) };
}

/**
 * Full server-side callback handling: consume state, exchange, verify scopes,
 * upsert exactly one connection for the operator.
 */
export async function completeInstagramConnection(
  db: AdminClient,
  input: { code: string; state: string },
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const consumed = await consumeOAuthState(db, input.state);
  if (!consumed) {
    return { ok: false, error: "This authorization link is invalid or already used." };
  }

  try {
    const short = await exchangeCodeForToken(input.code, consumed.redirectUri);
    const granted = short.permissions.length ? short.permissions : [...IG_SCOPES];
    const missing = missingScopes(granted);
    if (missing.length) {
      return {
        ok: false,
        error: `Missing required permissions: ${missing.join(", ")}. Nothing was saved.`,
      };
    }

    const long = await exchangeForLongLivedToken(short.accessToken);
    const profile = await fetchInstagramProfile(long.accessToken);

    const { error } = await db.from("ig_connections").upsert(
      {
        user_id: consumed.userId,
        ig_user_id: profile.igUserId,
        ig_username: profile.username,
        page_id: null,
        page_access_token: long.accessToken,
        token_expires_at: long.expiresAt.toISOString(),
        token_refreshed_at: new Date().toISOString(),
        status: "active",
        last_error: null,
        api_base_url: IG_API_BASE_URL,
        login_type: IG_LOGIN_TYPE,
        granted_scopes: granted,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);

    return { ok: true, username: profile.username };
  } catch (error) {
    // Never persist a partial connection and never touch an existing healthy one.
    return {
      ok: false,
      error: redactSecrets(error instanceof Error ? error.message : "Connection failed").slice(
        0,
        200,
      ),
    };
  }
}
