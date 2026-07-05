/**
 * Telegram-to-self handoff.
 *
 * Fires when an operator approves an asset. Sends the raw media file to their
 * saved Telegram chat with a link back to the asset in InstaScanner, so they
 * can forward it into Instagram (or anywhere else) with one tap. No caption
 * drafting — the operator writes their own copy in IG.
 *
 * Silent no-op when the operator hasn't enabled Telegram or hasn't saved a
 * chat ID. Never throws to the caller (approval flow must not fail because a
 * DM couldn't be delivered).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const APP_URL = "https://social-scan-zen.lovable.app";

export const sendAssetToTelegramFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ assetId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Operator's Telegram prefs. RLS scopes to the caller's own profile.
    const { data: prefs } = await supabase
      .from("profiles")
      .select("telegram_chat_id, telegram_enabled")
      .eq("id", userId)
      .maybeSingle();

    const chatId = prefs?.telegram_chat_id?.trim() ?? "";
    if (!prefs?.telegram_enabled || !chatId) {
      return { ok: true as const, delivered: false, reason: "telegram_disabled" };
    }

    // Asset payload — join through tracked_accounts for the handle.
    const { data: asset, error } = await supabase
      .from("assets")
      .select("id, media_url, media_type, source_url, tracked_accounts(username)")
      .eq("id", data.assetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!asset) throw new Error("Asset not found");

    const handleRaw = Array.isArray(asset.tracked_accounts)
      ? asset.tracked_accounts[0]?.username
      : asset.tracked_accounts?.username;
    const handle = handleRaw ?? "unknown";

    const { sendAssetHandoff } = await import("@/lib/telegram.server");
    const result = await sendAssetHandoff(chatId, {
      mediaUrl: asset.media_url,
      mediaType: asset.media_type,
      handle,
      assetLink: `${APP_URL}/assets?focus=${asset.id}`,
      sourceUrl: asset.source_url,
    });

    if (!result.ok) {
      // Soft-fail: log server-side but don't break the approval flow.
      console.error("[telegram-handoff] send failed", result.error);
      return { ok: false as const, delivered: false, error: result.error };
    }
    return { ok: true as const, delivered: true };
  });
