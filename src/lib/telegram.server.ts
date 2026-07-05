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

// ---------------------------------------------------------------------------
// Smart signal digest — the ONLY notification shape the scanner emits.
//
// Silence is the default. A digest is sent only when the just-finished scan
// produced ≥1 asset that passes every filter: S/A-tier source, AI verdict
// KEEP, confidence ≥80%, currently in the Priority review queue.
// ---------------------------------------------------------------------------

export type PrioritySignal = {
  tier: "S" | "A";
  handle: string;
  confidencePct: number; // 0–100, rounded
  gist: string;          // ≤ ~40 chars, no HTML
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Build the digest HTML body. Kept pure so `sendTelegramTestFn` can render a
 * sample without touching the network.
 */
export function formatPrioritySignalDigest(input: {
  signals: PrioritySignal[];  // already sorted, at most 3 previewed
  totalCount: number;
  inboxUrl: string;
  scanLabel: string;          // short human window e.g. "just now" or "14:32 UTC"
}): string {
  const preview = input.signals.slice(0, 3);
  const lines: string[] = [];
  lines.push(
    `🛰 <b>${input.totalCount} priority signal${input.totalCount === 1 ? "" : "s"}</b> — <i>${escapeHtml(input.scanLabel)}</i>`,
  );
  lines.push("");
  preview.forEach((s, i) => {
    const gist = s.gist ? ` · ${escapeHtml(s.gist)}` : "";
    lines.push(
      `${i + 1}. <b>${s.tier}</b> · @${escapeHtml(s.handle)} — KEEP ${s.confidencePct}%${gist}`,
    );
  });
  const overflow = input.totalCount - preview.length;
  if (overflow > 0) {
    lines.push("");
    lines.push(`<i>+${overflow} more in Priority queue</i>`);
  }
  lines.push("");
  lines.push(`<a href="${input.inboxUrl}">Open Inbox →</a>`);
  return lines.join("\n");
}

export async function sendPrioritySignalDigest(
  chatId: string,
  input: Parameters<typeof formatPrioritySignalDigest>[0],
): Promise<TelegramSendResult> {
  return sendTelegramMessage(chatId, formatPrioritySignalDigest(input));
}

// ---------------------------------------------------------------------------
// Asset handoff — sends the raw media file to the operator's Telegram so they
// can forward it into Instagram (or anywhere else) with one tap. No caption
// drafting: the DM carries the media, source handle, and a link back to the
// asset in InstaScanner. The operator writes their own IG caption.
// ---------------------------------------------------------------------------

export type AssetHandoffInput = {
  mediaUrl: string | null;
  mediaType: string; // image | video | reel | story | carousel
  handle: string;
  assetLink: string; // deep link into the app
  sourceUrl: string | null; // original IG permalink if we have one
};

function buildAssetCaption(input: AssetHandoffInput): string {
  const lines: string[] = [];
  lines.push(`📥 <b>Approved asset</b> · @${escapeHtml(input.handle)}`);
  if (input.sourceUrl) lines.push(`Source: ${escapeHtml(input.sourceUrl)}`);
  lines.push(`<a href="${input.assetLink}">Open in InstaScanner →</a>`);
  return lines.join("\n");
}

/**
 * Sends the asset media as a Telegram photo/video. Falls back to a text
 * message with the link if we have no media URL or the media send fails —
 * the operator can then open the asset in-app and grab the file manually.
 */
export async function sendAssetHandoff(
  chatId: string,
  input: AssetHandoffInput,
): Promise<TelegramSendResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  if (!connKey) return { ok: false, error: "TELEGRAM_API_KEY is not configured" };
  if (!chatId?.trim()) return { ok: false, error: "Missing Telegram chat ID" };

  const caption = buildAssetCaption(input);
  const isVideo = ["video", "reel", "story"].includes(input.mediaType);
  const isImage = input.mediaType === "image";

  // Carousels / missing media → text-only with link.
  if (!input.mediaUrl || (!isVideo && !isImage)) {
    return sendTelegramMessage(chatId, caption);
  }

  const endpoint = isVideo ? "sendVideo" : "sendPhoto";
  const payloadKey = isVideo ? "video" : "photo";

  try {
    const res = await fetch(`${GATEWAY_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        [payloadKey]: input.mediaUrl,
        caption,
        parse_mode: "HTML",
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: { message_id?: number };
    };
    if (!res.ok || data.ok === false) {
      // Media fetch by Telegram can fail on expiring IG CDN URLs — fall back
      // to plain text so the operator still gets the handoff signal.
      const textFallback = await sendTelegramMessage(
        chatId,
        `${caption}\n\n<i>Media could not be attached (${escapeHtml(data.description ?? `HTTP ${res.status}`)}). Open in InstaScanner to download.</i>`,
      );
      return textFallback;
    }
    return { ok: true, messageId: data.result?.message_id ?? 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
