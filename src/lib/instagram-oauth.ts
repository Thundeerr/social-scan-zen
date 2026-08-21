/**
 * Pure, browser-safe helpers for the official Instagram OAuth flow
 * (Business Login for Instagram / "Instagram Login").
 *
 * No secrets live here — the app secret, the authorization code and the
 * access token are handled exclusively in `instagram-oauth.server.ts`.
 */

export const IG_LOGIN_TYPE = "instagram_login" as const;

/** Officially supported Instagram Login permissions we need. */
export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
] as const;

export const IG_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const IG_GRAPH_HOST = "https://graph.instagram.com";
export const IG_API_BASE_URL = `${IG_GRAPH_HOST}/v23.0`;

/** Path of the server-side callback that must be registered in the Meta app. */
export const IG_CALLBACK_PATH = "/api/public/instagram/callback";
export const IG_OAUTH_ORIGIN = "https://instascanner.app";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export function callbackUrlForOrigin(origin: string): string {
  return new URL(IG_CALLBACK_PATH, origin).toString();
}

/**
 * Meta requires byte-for-byte redirect URI matching. Both the editor preview
 * and www host must therefore resolve to the registered apex-domain callback.
 */
export function instagramOAuthCallbackUrl(): string {
  return callbackUrlForOrigin(IG_OAUTH_ORIGIN);
}

export function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(IG_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (params.scopes ?? IG_SCOPES).join(","));
  url.searchParams.set("state", params.state);
  return url.toString();
}

export type CallbackParams =
  | { ok: true; code: string; state: string }
  | { ok: false; error: string };

/** Parse the provider redirect. Never surfaces the raw code in errors. */
export function parseCallbackParams(search: URLSearchParams): CallbackParams {
  const error = search.get("error_description") ?? search.get("error");
  if (error) return { ok: false, error: redactSecrets(error).slice(0, 200) };
  const code = search.get("code");
  const state = search.get("state");
  if (!code || !state) return { ok: false, error: "Authorization was cancelled or incomplete." };
  return { ok: true, code, state };
}

/** Strip anything that looks like a code/token before logging or persisting. */
export function redactSecrets(value: string): string {
  return value
    .replace(/(access_token|client_secret|code)=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/\bIG[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/\bEAA[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
}

/** Requested scopes that the operator did not grant. */
export function missingScopes(granted: readonly string[]): string[] {
  const set = new Set(granted.map((scope) => scope.trim()));
  return IG_SCOPES.filter((scope) => !set.has(scope));
}

export const SAFE_PUBLISH_MARGIN_MS = 6 * 60 * 60 * 1000;
export const RECONNECT_WARNING_MS = 14 * 24 * 60 * 60 * 1000;

export function connectionHealth(input: {
  status?: string | null;
  tokenExpiresAt?: string | null;
  now?: number;
}): { healthy: boolean; needsAttention: boolean; remainingMs: number } {
  const now = input.now ?? Date.now();
  const remainingMs = input.tokenExpiresAt ? new Date(input.tokenExpiresAt).getTime() - now : -1;
  const healthy = input.status === "active" && remainingMs > SAFE_PUBLISH_MARGIN_MS;
  return { healthy, needsAttention: !healthy || remainingMs < RECONNECT_WARNING_MS, remainingMs };
}
