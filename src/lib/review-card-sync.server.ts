import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { channelAlertTelegramCall } from "./messaging/telegram-transport";
import { reviewStatusCard } from "./review-card-status";
import type { ReviewItem } from "./content-review";
export async function syncReviewCards(user?: string, id?: string) {
  const owner = process.env.CONTENT_REVIEW_OWNER_ID ?? "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
  const chat = process.env.CONTENT_REVIEW_TELEGRAM_CHAT_ID ?? "8556103033";
  if (
    (user && user !== owner) ||
    !process.env.CONTENT_REVIEW_BOT_TOKEN?.startsWith("8905298936:") ||
    !/^\d{5,16}$/.test(chat)
  )
    return;
  const command = async (action: string, data: unknown = {}) => {
    const r = await (supabaseAdmin as SupabaseClient).rpc("review_card_sync_command", {
      p_user: owner,
      p_action: action,
      p_data: data,
    });
    if (r.error) throw Error("Card sync unavailable");
    return r.data;
  };
  for (let n = 0; n < (id ? 1 : 3); n++) {
    const job = (await command("claim", id ? { id } : {})) as {
      id: string;
      lease: string;
      item: ReviewItem;
      post: Parameters<typeof reviewStatusCard>[1];
    } | null;
    if (!job) break;
    const card = reviewStatusCard(
      job.item,
      job.post,
      process.env.CONTENT_REVIEW_ORIGIN ?? "https://instascanner.app",
      chat,
    );
    const result = await channelAlertTelegramCall("editMessageCaption", {
      chat_id: chat,
      message_id: job.item.telegram_message_id,
      caption: card.caption,
      reply_markup: card.reply_markup,
    });
    await command(result.ok ? "done" : "retry", { id: job.id, lease: job.lease });
  }
}
