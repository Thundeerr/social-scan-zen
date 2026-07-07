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
  if (!lovableKey) return { ok: false, status: 0, description: "LOVABLE_API_KEY is not configured" };
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
