/**
 * Provider-agnostic Telegram Bot API transport — server-only.
 *
 * Every Telegram API call in the app MUST go through this module. Never
 * hit `api.telegram.org` or `connector-gateway.lovable.dev/telegram`
 * directly from feature code.
 *
 * Switch providers with env `TELEGRAM_PROVIDER` — no code changes required:
 *   - `lovable` (default) → connector-gateway.lovable.dev/telegram
 *                           (auth: LOVABLE_API_KEY + TELEGRAM_API_KEY)
 *   - `direct`            → api.telegram.org/bot<token>
 *                           (auth: TELEGRAM_BOT_TOKEN)
 *
 * Both providers speak the standard Telegram Bot API wire format, so the
 * body and response shapes are identical.
 */

type Provider = "lovable" | "direct";

function getProvider(): Provider {
  const raw = (process.env.TELEGRAM_PROVIDER ?? "lovable").toLowerCase();
  return raw === "direct" ? "direct" : "lovable";
}

export type TelegramApiResult = {
  ok: boolean;
  status: number;
  description?: string;
  result?: unknown;
};

/**
 * Call a Telegram Bot API method. Returns Telegram's own `{ ok, result, description }`
 * envelope so callers can preserve their existing decoding logic.
 */
export async function telegramApiCall(
  method: string,
  body: Record<string, unknown>,
): Promise<TelegramApiResult> {
  const provider = getProvider();

  if (provider === "direct") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { ok: false, status: 0, description: "TELEGRAM_BOT_TOKEN is not configured" };
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        description?: string;
        result?: unknown;
      };
      return {
        ok: res.ok && data.ok !== false,
        status: res.status,
        description: data.description,
        result: data.result,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        description: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Provider: lovable connector gateway.
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey)
    return { ok: false, status: 0, description: "LOVABLE_API_KEY is not configured" };
  if (!connKey) return { ok: false, status: 0, description: "TELEGRAM_API_KEY is not configured" };
  try {
    const res = await fetch(`https://connector-gateway.lovable.dev/telegram/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: unknown;
    };
    return {
      ok: res.ok && data.ok !== false,
      status: res.status,
      description: data.description,
      result: data.result,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      description: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Which provider will be used for the next call — for logs/debug only. */
export function activeTelegramProvider(): Provider {
  return getProvider();
}

/** Reporting setup: preserve any other webhook and all pending updates. */
export async function configureBusinessWebhook(url: string, secret: string) {
  const token = process.env.CONTENT_REVIEW_BOT_TOKEN;
  if (
    !token?.startsWith("8905298936:") ||
    url !== "https://instascanner.app/api/public/business-report/webhook" ||
    !/^[a-f0-9]{64}$/.test(secret)
  )
    throw new Error("Bot-Konfiguration fehlt.");
  const call = async (method: string, body: unknown) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error("Bot-Verbindung nicht bestätigt.");
    return data.result;
  };
  try {
    const current = await call("getWebhookInfo", {});
    if (current.url && current.url !== url)
      throw new Error("Ein anderer Bot-Empfänger ist aktiv. Er wurde nicht verändert.");
    await call("setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    });
    const confirmed = await call("getWebhookInfo", {});
    if (confirmed.url !== url) throw new Error("Webhook nicht bestätigt.");
    return { connected: true };
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Ein anderer")) throw e;
    throw new Error("Bot-Verbindung nicht bestätigt.");
  }
}

/** Dedicated review bot, never falls back to the scanner bot or modifies webhooks. */
export async function contentReviewTelegramCall(
  body: Record<string, unknown>,
): Promise<TelegramApiResult> {
  const token = process.env.CONTENT_REVIEW_BOT_TOKEN;
  if (!token) return { ok: false, status: 0 };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const data = (await response.json()) as { ok?: boolean; result?: unknown };
    return { ok: response.ok && data.ok === true, status: response.status, result: data.result };
  } catch {
    // Errors can contain a URL with the bot token. Never return or log them.
    return { ok: false, status: 0 };
  }
}

/** Same private review bot; fixed API allowlist, no webhook/polling methods. */
export async function channelAlertTelegramCall(
  method:
    | "sendMessage"
    | "deleteMessages"
    | "getMe"
    | "getChatMember"
    | "editMessageReplyMarkup"
    | "editMessageCaption",
  body: Record<string, unknown>,
): Promise<TelegramApiResult> {
  const token = process.env.CONTENT_REVIEW_BOT_TOKEN;
  if (
    !token?.startsWith("8905298936:") ||
    ![
      "sendMessage",
      "deleteMessages",
      "getMe",
      "getChatMember",
      "editMessageReplyMarkup",
      "editMessageCaption",
    ].includes(method)
  )
    return { ok: false, status: 0 };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await response.json()) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
    };
    const unchanged =
      method === "editMessageCaption" &&
      response.status === 400 &&
      data.description?.includes("message is not modified");
    return {
      ok: (response.ok && data.ok === true) || !!unchanged,
      status: response.status,
      result: data.result,
    };
  } catch {
    return { ok: false, status: 0 };
  }
}
