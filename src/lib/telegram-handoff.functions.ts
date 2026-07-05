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

/**
 * Session summary — fires when the operator finishes a review batch. Sends
 * one Telegram message listing every approved asset from that session with
 * a link back into InstaScanner. Silent no-op if Telegram is disabled or
 * no assets were approved.
 */
export const sendApprovedSessionSummaryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ assetIds: z.array(z.string().uuid()).max(200) }).parse(raw),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.assetIds.length === 0) {
      return { ok: true as const, delivered: false, reason: "no_approvals" };
    }

    const { data: prefs } = await supabase
      .from("profiles")
      .select("telegram_chat_id, telegram_enabled")
      .eq("id", userId)
      .maybeSingle();

    const chatId = prefs?.telegram_chat_id?.trim() ?? "";
    if (!prefs?.telegram_enabled || !chatId) {
      return { ok: true as const, delivered: false, reason: "telegram_disabled" };
    }

    const { data: rows, error } = await supabase
      .from("assets")
      .select("id, media_type, tracked_accounts(username)")
      .in("id", data.assetIds);
    if (error) throw new Error(error.message);

    const escape = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const items = (rows ?? []).map((r) => {
      const handleRaw = Array.isArray(r.tracked_accounts)
        ? r.tracked_accounts[0]?.username
        : (r.tracked_accounts as { username?: string } | null)?.username;
      const handle = handleRaw ?? "unknown";
      return { id: r.id, handle, mediaType: r.media_type };
    });

    const lines: string[] = [];
    lines.push(
      `✅ <b>Review complete</b> — ${items.length} approved asset${items.length === 1 ? "" : "s"}`,
    );
    lines.push("");
    items.forEach((it, i) => {
      const link = `${APP_URL}/assets?focus=${it.id}`;
      lines.push(
        `${i + 1}. @${escape(it.handle)} · ${escape(it.mediaType)} — <a href="${link}">Open</a>`,
      );
    });

    const { sendTelegramMessage } = await import("@/lib/telegram.server");
    const result = await sendTelegramMessage(chatId, lines.join("\n"));
    if (!result.ok) {
      console.error("[telegram-summary] send failed", result.error);
      return { ok: false as const, delivered: false, error: result.error };
    }
    return { ok: true as const, delivered: true, count: items.length };
  });
