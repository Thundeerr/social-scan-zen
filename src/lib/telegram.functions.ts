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
  .handler(async ({ context }) => {
    // Only ever send to the chat ID stored on the caller's own profile row.
    // We intentionally ignore any client-supplied chat ID so the shared bot
    // cannot be used as a relay to arbitrary Telegram chats.
    const { data: row, error: profileErr } = await context.supabase
      .from("profiles")
      .select("telegram_chat_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    const chatId = (row?.telegram_chat_id ?? "").trim();
    const parsed = chatIdSchema.safeParse(chatId);
    if (!parsed.success) {
      throw new Error(
        "Save a numeric Telegram chat ID on your profile before sending a test.",
      );
    }
    const { sendPrioritySignalDigest } = await import("@/lib/telegram.server");
    const result = await sendPrioritySignalDigest(chatId, {
      signals: [
        { tier: "S", handle: "sample_operator", confidencePct: 94, gist: "novel product reveal" },
        { tier: "A", handle: "field_source_02", confidencePct: 88, gist: "policy signal" },
      ],
      totalCount: 2,
      inboxUrl: "https://social-scan-zen.lovable.app/assets",
      scanLabel: "test signal",
    });
    if (!result.ok) throw new Error(result.error);
    return { ok: true as const };
  });

export const detectTelegramChatIdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Only operators may run chat-ID detection at all — this endpoint reads
    // the shared bot's global getUpdates queue, so it must never be exposed
    // to arbitrary signed-in users.
    const { data: isOp, error: roleErr } = await context.supabase.rpc(
      "is_operator",
      { _user_id: context.userId },
    );
    if (roleErr) throw new Error(roleErr.message);
    if (!isOp) throw new Error("Only operators can detect Telegram chat IDs.");

    // Require the operator to have just messaged the bot with their own
    // per-user token (`/start <userId>`), and only return chat IDs from
    // updates whose text carried that token. This prevents one operator from
    // capturing a chat ID belonging to a different operator mid-setup.
    const { detectLatestTelegramChatIdForToken } = await import(
      "@/lib/telegram.server"
    );
    const result = await detectLatestTelegramChatIdForToken(context.userId);
    if (!result.ok) throw new Error(result.error);
    return { chatId: result.chatId };
  });
