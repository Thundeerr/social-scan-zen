/**
 * Telegram send helper — server-only.
 *
 * Routes all Telegram Bot API calls through the Lovable connector gateway
 * so credentials never touch the client. Never import this file from a
 * route/component/loader; only server functions and other .server files.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/telegram";

export type TelegramSendResult = { ok: true; messageId: number } | { ok: false; error: string };

/**
 * Sends a Telegram message to the given chat ID. Returns a soft result — never
 * throws — so callers (e.g. the scanner) can log and continue without blowing
 * up unrelated work.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
): Promise<TelegramSendResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;

  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  if (!connKey) return { ok: false, error: "TELEGRAM_API_KEY is not configured" };
  if (!chatId?.trim()) return { ok: false, error: "Missing Telegram chat ID" };

  try {
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, messageId: data.result?.message_id ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Calls `getUpdates` and returns the most recent chat.id seen by the bot.
 * Used by the "Detect chat ID" helper on the Settings page — the operator
 * messages the bot with /start, we surface the ID for them to save.
 */
export async function detectLatestTelegramChatId(): Promise<
  { ok: true; chatId: string | null } | { ok: false; error: string }
> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  if (!connKey) return { ok: false, error: "TELEGRAM_API_KEY is not configured" };

  try {
    const res = await fetch(`${GATEWAY_URL}/getUpdates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 20, allowed_updates: ["message"] }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: Array<{ message?: { chat?: { id?: number } } }>;
    };
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    }
    const updates = data.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const id = updates[i]?.message?.chat?.id;
      if (typeof id === "number") return { ok: true, chatId: String(id) };
    }
    return { ok: true, chatId: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
