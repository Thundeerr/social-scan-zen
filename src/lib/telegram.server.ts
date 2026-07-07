/**
 * Telegram send helper — server-only.
 *
 * All network I/O is delegated to `messaging/telegram-transport`, which
 * chooses between the Lovable connector gateway (default) and the direct
 * Telegram Bot API based on env `TELEGRAM_PROVIDER`. Never import this
 * file from a route/component/loader; only server functions and other
 * .server files.
 */

import { telegramApiCall } from "./messaging/telegram-transport";

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
  if (!chatId?.trim()) return { ok: false, error: "Missing Telegram chat ID" };

  const data = await telegramApiCall("sendMessage", {
    chat_id: chatId.trim(),
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!data.ok) return { ok: false, error: data.description ?? `HTTP ${data.status}` };
  const result = data.result as { message_id?: number } | undefined;
  return { ok: true, messageId: result?.message_id ?? 0 };
}

/**
 * Calls `getUpdates` and returns the most recent chat.id from a message
 * whose text contains the caller's own per-user token (typically sent as
 * `/start <userToken>`). This prevents one operator from capturing a chat
 * ID that belongs to a different operator mid-setup.
 */
export async function detectLatestTelegramChatIdForToken(
  userToken: string,
): Promise<{ ok: true; chatId: string | null } | { ok: false; error: string }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  if (!connKey) return { ok: false, error: "TELEGRAM_API_KEY is not configured" };
  if (!userToken?.trim()) return { ok: false, error: "Missing per-user setup token" };

  try {
    const res = await fetch(`${GATEWAY_URL}/getUpdates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 50, allowed_updates: ["message"] }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      result?: Array<{ message?: { text?: string; chat?: { id?: number } } }>;
    };
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.description ?? `HTTP ${res.status}` };
    }
    const token = userToken.trim();
    const updates = data.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const msg = updates[i]?.message;
      const text = msg?.text ?? "";
      const id = msg?.chat?.id;
      if (typeof id === "number" && text.includes(token)) {
        return { ok: true, chatId: String(id) };
      }
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

// ---------------------------------------------------------------------------
// Detection card — rich per-asset notification with inline action buttons.
//
// Fired when a new asset is detected from an S/A-tier tracked account. The
// message carries the thumbnail (photo) or media (video), the metadata block,
// and a keyboard whose callback_data is handled by the public Telegram
// webhook route.
// ---------------------------------------------------------------------------

export type DetectionCardInput = {
  assetId: string;
  handle: string;
  displayName?: string | null;
  caption: string | null;
  postedAt: string | null;   // ISO
  detectedAt: string | null; // ISO
  mediaType: string;         // image | video | reel | story | carousel
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  aiVerdict: string | null;
  aiConfidence: number | null; // 0..1
  aiReasons: string[];         // treated as AI tags when available
  adminUrl: string;            // deep link into the InstaScanner admin panel
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function buildDetectionCaption(input: DetectionCardInput): string {
  const lines: string[] = [];
  const display = input.displayName ? ` · ${escapeHtml(input.displayName)}` : "";
  lines.push(`🛰 <b>New asset</b> · @${escapeHtml(input.handle)}${display}`);
  lines.push("");

  if (input.caption) {
    lines.push(`<i>${escapeHtml(truncate(input.caption, 220))}</i>`);
    lines.push("");
  }

  const posted = fmtDate(input.postedAt);
  const detected = fmtDate(input.detectedAt);
  if (posted) lines.push(`📅 Posted: ${escapeHtml(posted)}`);
  if (detected) lines.push(`🛰 Detected: ${escapeHtml(detected)}`);

  if (input.aiVerdict) {
    const conf = input.aiConfidence != null ? ` ${Math.round(input.aiConfidence * 100)}%` : "";
    lines.push(`🤖 AI: <b>${escapeHtml(input.aiVerdict)}</b>${conf}`);
  }
  if (input.aiConfidence != null) {
    // Reported separately as "Quality" — a proxy operators recognise. Luxury
    // score is only shown when we actually have that column populated.
    lines.push(`✨ Quality: ${Math.round(input.aiConfidence * 100)}%`);
  }
  if (input.aiReasons.length > 0) {
    const tags = input.aiReasons
      .slice(0, 4)
      .map((t) => `#${escapeHtml(t.replace(/[^\w-]+/g, "_").slice(0, 24))}`)
      .join(" ");
    lines.push(`🏷 ${tags}`);
  }

  lines.push("");
  if (input.sourceUrl) lines.push(`<a href="${escapeHtml(input.sourceUrl)}">Original on Instagram →</a>`);
  lines.push(`<a href="${escapeHtml(input.adminUrl)}">Open in Admin →</a>`);

  return lines.join("\n");
}

function buildDetectionKeyboard(assetId: string, adminUrl: string, sourceUrl: string | null) {
  const cb = (key: string, label: string) => ({ text: label, callback_data: `${key}:${assetId}` });
  // Milestone 1 — Core Operator Flow. Only the five fast actions live on the
  // card: Download, Send Media, Copy Caption, Ignore, plus the Open Admin
  // URL button. Repost queue and review-state buttons come in later
  // milestones — the admin panel is the source of truth.
  const A = {
    download: cb("dl", "⬇️ Download"),
    send:     cb("snd", "📤 Send Media to Me"),
    copy:     cb("cap", "📋 Copy Caption"),
    ignore:   cb("ign", "🚫 Ignore"),
  };

  const row3: Array<Record<string, unknown>> = [{ text: "🛠 Open in Admin", url: adminUrl }];
  if (sourceUrl) row3.push({ text: "🔗 Instagram", url: sourceUrl });
  return {
    inline_keyboard: [
      [A.download, A.send],
      [A.copy, A.ignore],
      row3,
    ],
  };
}


/**
 * Sends a rich detection card with inline action buttons. Falls back to a
 * text-only message if media attachment fails (Telegram can't fetch some
 * IG CDN URLs).
 */
export async function sendDetectionCard(
  chatId: string,
  input: DetectionCardInput,
): Promise<TelegramSendResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey) return { ok: false, error: "LOVABLE_API_KEY is not configured" };
  if (!connKey) return { ok: false, error: "TELEGRAM_API_KEY is not configured" };
  if (!chatId?.trim()) return { ok: false, error: "Missing Telegram chat ID" };

  const caption = buildDetectionCaption(input);
  const keyboard = buildDetectionKeyboard(input.assetId, input.adminUrl, input.sourceUrl);
  const isVideo = ["video", "reel", "story"].includes(input.mediaType);
  const isImage = input.mediaType === "image";
  const mediaSrc = input.thumbnailUrl ?? input.mediaUrl;

  const sendText = async () => {
    const res = await fetch(`${GATEWAY_URL}/sendMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: caption,
        parse_mode: "HTML",
        disable_web_page_preview: false,
        reply_markup: keyboard,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean; description?: string; result?: { message_id?: number };
    };
    if (!res.ok || data.ok === false) {
      return { ok: false as const, error: data.description ?? `HTTP ${res.status}` };
    }
    return { ok: true as const, messageId: data.result?.message_id ?? 0 };
  };

  if (!mediaSrc || (!isVideo && !isImage)) return sendText();

  const endpoint = isVideo && input.mediaUrl ? "sendVideo" : "sendPhoto";
  const payloadKey = endpoint === "sendVideo" ? "video" : "photo";
  const source = endpoint === "sendVideo" ? input.mediaUrl! : mediaSrc;

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
        [payloadKey]: source,
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean; description?: string; result?: { message_id?: number };
    };
    if (!res.ok || data.ok === false) return sendText();
    return { ok: true, messageId: data.result?.message_id ?? 0 };
  } catch {
    return sendText();
  }
}

// ---------------------------------------------------------------------------
// Bot API helpers used by the webhook route to answer inline-button taps.
// ---------------------------------------------------------------------------

async function botCall(method: string, body: Record<string, unknown>): Promise<{
  ok: boolean; description?: string; result?: unknown;
}> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const connKey = process.env.TELEGRAM_API_KEY;
  if (!lovableKey || !connKey) return { ok: false, description: "telegram keys missing" };
  try {
    const res = await fetch(`${GATEWAY_URL}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": connKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => ({ ok: false }))) as {
      ok: boolean; description?: string; result?: unknown;
    };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  }
}

export function answerCallbackQuery(
  callbackQueryId: string,
  text: string,
  showAlert = false,
) {
  return botCall("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text.slice(0, 200),
    show_alert: showAlert,
  });
}

export function editMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
  replyMarkup: Record<string, unknown> | null,
) {
  return botCall("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup ?? { inline_keyboard: [] },
  });
}

export { escapeHtml as _escapeHtml };

