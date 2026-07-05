/**
 * Telegram Bot webhook — inline button callbacks.
 *
 * Telegram POSTs update objects here whenever the operator taps a button on
 * a detection card. We authenticate via the `X-Telegram-Bot-Api-Secret-Token`
 * header (derived from TELEGRAM_API_KEY so we don't need a new secret), then
 * authorize the tap by matching `chat.id` to the profile row that owns it —
 * this way the shared bot only ever acts on behalf of its registered
 * operator.
 *
 * All callback actions run with the service-role client because the webhook
 * has no Supabase session; the profile lookup is the authorization boundary.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "node:crypto";

const APP_URL = "https://social-scan-zen.lovable.app";

function deriveTelegramWebhookSecret(telegramApiKey: string): string {
  return createHash("sha256")
    .update(`telegram-webhook:${telegramApiKey}`)
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

type CallbackQuery = {
  id: string;
  from?: { id?: number };
  message?: { chat?: { id?: number }; message_id?: number };
  data?: string;
};

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.TELEGRAM_API_KEY;
        if (!key) return new Response("Not configured", { status: 503 });

        const expected = deriveTelegramWebhookSecret(key);
        const actual = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
        if (!safeEqual(actual, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const update = (await request.json().catch(() => null)) as {
          callback_query?: CallbackQuery;
        } | null;
        const cb = update?.callback_query;
        if (!cb?.data || !cb.id) return Response.json({ ok: true, ignored: true });

        const [action, assetId] = cb.data.split(":", 2);
        const chatId = cb.message?.chat?.id;
        if (!action || !assetId || typeof chatId !== "number") {
          return Response.json({ ok: true, ignored: true });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          answerCallbackQuery,
          editMessageReplyMarkup,
          sendDetectionCard: _unused, // side-effect import for tree-shaking safety
          sendAssetHandoff,
          sendTelegramMessage,
        } = await import("@/lib/telegram.server");
        void _unused;

        // Authorize: the tapping chat must match a profile.telegram_chat_id.
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, telegram_chat_id, telegram_enabled")
          .eq("telegram_chat_id", String(chatId))
          .maybeSingle();
        if (!profile?.id || !profile.telegram_enabled) {
          await answerCallbackQuery(cb.id, "Not authorized", true);
          return Response.json({ ok: true, unauthorized: true });
        }

        // Confirm the asset belongs to an account this operator owns.
        const { data: asset } = await supabaseAdmin
          .from("assets")
          .select(
            "id, caption, media_type, media_url, thumbnail_url, source_url, tracked_accounts(username, created_by)",
          )
          .eq("id", assetId)
          .maybeSingle();

        const trackedRel = Array.isArray(asset?.tracked_accounts)
          ? asset?.tracked_accounts[0]
          : asset?.tracked_accounts;
        const ownerId = (trackedRel as { created_by?: string } | null | undefined)?.created_by;
        const handle =
          (trackedRel as { username?: string } | null | undefined)?.username ?? "unknown";

        if (!asset || ownerId !== profile.id) {
          await answerCallbackQuery(cb.id, "Asset unavailable", true);
          return Response.json({ ok: true, unauthorized: true });
        }

        const messageId = cb.message?.message_id;
        const setState = async (
          state:
            | "priority"
            | "worth_reviewing"
            | "later"
            | "reviewed"
            | "approved"
            | "dismissed"
            | "archived",
        ) => {
          // asset_status has UNIQUE(asset_id) → upsert on that key.
          await supabaseAdmin
            .from("asset_status")
            .upsert(
              {
                asset_id: assetId,
                state,
                reviewer_id: profile.id,
                reviewed_at: new Date().toISOString(),
              },
              { onConflict: "asset_id" },
            );
        };

        let toast = "Done";

        switch (action) {
          case "dl":
          case "snd": {
            const res = await sendAssetHandoff(String(chatId), {
              mediaUrl: asset.media_url,
              mediaType: asset.media_type,
              handle,
              assetLink: `${APP_URL}/assets?focus=${asset.id}`,
              sourceUrl: asset.source_url,
            });
            toast = res.ok ? "Media sent" : "Send failed";
            break;
          }
          case "cap": {
            const caption = asset.caption?.trim() || "(no caption)";
            await sendTelegramMessage(
              String(chatId),
              `📋 <b>Caption</b> · @${handle}\n\n<code>${caption
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</code>`,
            );
            toast = "Caption sent";
            break;
          }
          case "rev": {
            await setState("reviewed");
            toast = "Marked reviewed";
            break;
          }
          case "ign": {
            await setState("dismissed");
            toast = "Ignored";
            break;
          }
          case "rep": {
            await setState("approved"); // approval trigger enqueues publish_jobs
            toast = "Queued for repost";
            break;
          }
          default:
            toast = "Unknown action";
        }

        await answerCallbackQuery(cb.id, toast);

        // For terminal actions, strip the keyboard so the card reads as
        // handled. Media/caption actions keep the buttons active.
        if (["rev", "ign", "rep"].includes(action) && typeof messageId === "number") {
          await editMessageReplyMarkup(chatId, messageId, null);
        }

        return Response.json({ ok: true });
      },
    },
  },
});
