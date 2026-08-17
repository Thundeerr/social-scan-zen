/**
 * Pure, browser-safe guardrails for outbound provider orders.
 *
 * These rules exist to stop human mistakes (a broken template, a fat-fingered
 * quantity, a pasted wrong URL) from turning into real money spent. They are
 * deliberately loose enough to never get in the way of normal operation.
 *
 * The UI imports the same module so it can show exactly what the server will
 * enforce — no divergence between "what I see" and "what happens".
 */

/** Hosts the server is allowed to POST orders to. */
export const ALLOWED_PROVIDER_HOSTS = [
  "justanotherpanel.com",
  "www.justanotherpanel.com",
] as const;

export const DEFAULT_PROVIDER_BASE_URL = "https://justanotherpanel.com/api/v2";

/** Hard ceiling regardless of per-workspace settings. */
export const ABSOLUTE_MAX_QUANTITY = 1_000_000;

/** Retry backoff for transient (network) failures only, in minutes. */
export const BACKOFF_MINUTES = [1, 5, 20, 60] as const;
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;

/** A dispatch that stayed in `processing` this long is considered crashed. */
export const STALE_PROCESSING_MINUTES = 10;

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

const OK: GuardVerdict = { ok: true };

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (h === "0.0.0.0" || h === "[::1]" || h === "::1") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/**
 * The provider base URL is operator-editable. It is server-side fetched, so an
 * arbitrary value would be an SSRF hole: allowlist it.
 */
export function validateProviderBaseUrl(raw: string | null | undefined): GuardVerdict {
  const value = (raw ?? "").trim() || DEFAULT_PROVIDER_BASE_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Provider endpoint is not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Provider endpoint must use HTTPS" };
  }
  if (isPrivateHostname(url.hostname)) {
    return { ok: false, reason: "Provider endpoint may not point at a private network" };
  }
  if (!(ALLOWED_PROVIDER_HOSTS as readonly string[]).includes(url.hostname.toLowerCase())) {
    return {
      ok: false,
      reason: `Provider endpoint host "${url.hostname}" is not on the allowlist`,
    };
  }
  return OK;
}

export function resolveProviderBaseUrl(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  return value || DEFAULT_PROVIDER_BASE_URL;
}

/**
 * The order target must be an Instagram URL for the monitored account. A
 * template with an unreplaced `{username}` placeholder, or a link pointing at
 * some other profile, must never reach the provider.
 */
export function validateTarget(target: string, username: string): GuardVerdict {
  const value = (target ?? "").trim();
  if (!value) return { ok: false, reason: "Order target is empty" };
  if (value.includes("{username}")) {
    return { ok: false, reason: "Order target still contains an unresolved placeholder" };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "Order target is not a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: "Order target must use HTTPS" };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com") {
    return { ok: false, reason: `Order target must point at instagram.com, not "${host}"` };
  }
  const handle = (username ?? "").trim().toLowerCase();
  if (handle && !url.pathname.toLowerCase().includes(handle)) {
    return {
      ok: false,
      reason: `Order target does not reference the monitored account @${handle}`,
    };
  }
  return OK;
}

export function validateQuantity(
  quantity: number | null | undefined,
  maxPerAction: number,
): GuardVerdict {
  const q = Number(quantity);
  if (!Number.isFinite(q) || !Number.isInteger(q) || q < 1) {
    return { ok: false, reason: "Order quantity must be a whole number of at least 1" };
  }
  const cap = Math.min(
    ABSOLUTE_MAX_QUANTITY,
    Number.isFinite(maxPerAction) && maxPerAction > 0 ? maxPerAction : ABSOLUTE_MAX_QUANTITY,
  );
  if (q > cap) {
    return {
      ok: false,
      reason: `Order quantity ${q.toLocaleString("en-US")} exceeds the per-order limit of ${cap.toLocaleString("en-US")}`,
    };
  }
  return OK;
}

export type SpendState = {
  ordersToday: number;
  ordersThisMonth: number;
  dailyCap: number;
  monthlyCap: number;
};

export function evaluateSpend(state: SpendState): GuardVerdict {
  if (state.dailyCap > 0 && state.ordersToday >= state.dailyCap) {
    return {
      ok: false,
      reason: `Daily order limit reached (${state.ordersToday}/${state.dailyCap})`,
    };
  }
  if (state.monthlyCap > 0 && state.ordersThisMonth >= state.monthlyCap) {
    return {
      ok: false,
      reason: `Monthly order limit reached (${state.ordersThisMonth}/${state.monthlyCap})`,
    };
  }
  return OK;
}

/** Next attempt timestamp for a transient failure, or null when exhausted. */
export function nextAttemptAt(attemptCount: number, now: Date = new Date()): string | null {
  const minutes = BACKOFF_MINUTES[attemptCount - 1];
  if (minutes === undefined) return null;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

export function isRetryExhausted(attemptCount: number): boolean {
  return attemptCount >= MAX_ATTEMPTS;
}
