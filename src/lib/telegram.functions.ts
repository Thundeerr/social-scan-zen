/**
 * Server functions for the operator's Telegram notification preferences.
 *
 * The chat ID lives on the operator's profile row (RLS-scoped to auth.uid)
 * so the autonomous scanner can look it up server-side when a scan completes.
 * All Telegram Bot API calls go through the Lovable connector gateway via
 * `telegram.server.ts` — the browser never sees the token.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Loosely validate a Telegram chat ID — must be a signed integer string.
// Personal chats are positive; group/channel IDs may start with `-100...`.
const chatIdSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,20}$/, "Chat ID must be a numeric Telegram ID");

export const getTelegramPrefsFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("telegram_chat_id, telegram_enabled")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      chatId: data?.telegram_chat_id ?? "",
      enabled: data?.telegram_enabled ?? false,
    };
  });

export const saveTelegramPrefsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        chatId: z.string().trim().max(64),
        enabled: z.boolean(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const chatId = data.chatId.trim();
    if (data.enabled) {
      // Only validate the chat ID format when the operator is turning
      // notifications on — an empty chat ID + disabled is a valid "cleared" state.
      const parsed = chatIdSchema.safeParse(chatId);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid chat ID");
      }
    }
    const { error } = await context.supabase
      .from("profiles")
      .update({
        telegram_chat_id: chatId ? chatId : null,
        telegram_enabled: data.enabled && !!chatId,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const sendTelegramTestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        chatId: z.string().trim().max(64).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    // Prefer the ID the operator just typed (unsaved test). Fall back to the
    // stored profile value.
    let chatId = data.chatId?.trim() ?? "";
    if (!chatId) {
      const { data: row } = await context.supabase
        .from("profiles")
        .select("telegram_chat_id")
        .eq("id", context.userId)
        .maybeSingle();
      chatId = row?.telegram_chat_id ?? "";
    }
    const parsed = chatIdSchema.safeParse(chatId);
    if (!parsed.success) {
      throw new Error("Enter a numeric Telegram chat ID first");
    }
    const { sendTelegramMessage } = await import("@/lib/telegram.server");
    const result = await sendTelegramMessage(
      chatId,
      [
        "<b>InstaScanner</b> — test signal",
        "",
        "The autonomous network is patched into this chat.",
        "You'll receive an alert here whenever a scan turns up new assets.",
      ].join("\n"),
    );
    if (!result.ok) throw new Error(result.error);
    return { ok: true as const };
  });

export const detectTelegramChatIdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { detectLatestTelegramChatId } = await import("@/lib/telegram.server");
    const result = await detectLatestTelegramChatId();
    if (!result.ok) throw new Error(result.error);
    return { chatId: result.chatId };
  });
