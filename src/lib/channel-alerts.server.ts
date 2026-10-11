import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { channelAlertTelegramCall } from "./messaging/telegram-transport";
import { announcement, type AlertAction, type AlertSnapshot } from "./channel-alerts";
const db = () => supabaseAdmin as SupabaseClient;
async function command(action: string, user: string | null = null, data: unknown = {}) {
  const result = await db().rpc("model_alert_command", {
    p_action: action,
    p_user: user,
    p_data: data,
  });
  if (result.error) throw new Error("Channel-Aktion nicht möglich. Bitte aktualisieren.");
  return result.data;
}
export async function operatorAlerts(user: string, action: AlertAction): Promise<AlertSnapshot> {
  const snapshot = (await command("status", user)) as AlertSnapshot;
  if (action.action === "check") {
    const route = snapshot.channels.find((c) => c.model === action.model);
    if (!route) throw new Error("Unbekanntes Model.");
    const me = await channelAlertTelegramCall("getMe", {});
    const bot = me.result as { id?: number } | undefined;
    const member =
      me.ok && bot?.id === 8905298936
        ? await channelAlertTelegramCall("getChatMember", {
            chat_id: route.chat_id,
            user_id: bot.id,
          })
        : { ok: false, result: null };
    const rights = member.result as { status?: string; can_post_messages?: boolean } | null;
    const ready =
      member.ok && rights?.status === "administrator" && rights.can_post_messages === true;
    await command("check", user, { model: action.model, ready });
  } else if (action.action === "configure") await command("configure", user, action);
  return action.action === "status" ? snapshot : await command("status", user);
}
type AlertJob = {
  id: string;
  lease: string;
  state: "sending" | "deleting";
  model: "kiikii" | "tuuva";
  chat_id: string;
  permalink: string;
  message_id: number | null;
};
async function acknowledge(action: string, data: unknown) {
  // Retry only the database receipt, never the Telegram send.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await command(action, null, data);
      return;
    } catch {
      if (attempt === 2) throw new Error("Receipt not saved");
    }
  }
}
export async function runAlerts() {
  if (!process.env.CONTENT_REVIEW_BOT_TOKEN?.startsWith("8905298936:"))
    throw new Error("Bot configuration missing");
  let processed = 0;
  for (let i = 0; i < 4; i++) {
    const job = (await command("claim", null, { allow_send: true })) as AlertJob | null;
    if (!job) break;
    const receipt = { id: job.id, lease: job.lease };
    if (job.state === "deleting") {
      const result = await channelAlertTelegramCall("deleteMessages", {
        chat_id: job.chat_id,
        message_ids: [job.message_id],
      });
      await acknowledge(result.ok && result.result === true ? "deleted" : "delete_retry", receipt);
    } else {
      let body;
      try {
        body = announcement(job.model, job.permalink);
      } catch {
        await acknowledge("uncertain", receipt);
        continue;
      }
      const result = await channelAlertTelegramCall("sendMessage", {
        chat_id: job.chat_id,
        ...body,
      });
      const message = result.result as
        | { message_id?: number; date?: number; chat?: { id?: number } }
        | undefined;
      const valid =
        result.ok &&
        Number.isSafeInteger(message?.message_id) &&
        (message?.message_id ?? 0) > 0 &&
        Number.isSafeInteger(message?.date) &&
        Math.abs((message?.date ?? 0) - Date.now() / 1000) < 120 &&
        String(message?.chat?.id) === job.chat_id;
      await acknowledge(valid ? "sent" : "uncertain", {
        ...receipt,
        message_id: message?.message_id,
        date: message?.date,
      });
    }
    processed++;
  }
  return { processed };
}
export async function alertTick(request: Request) {
  const headers = { "cache-control": "no-store" };
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret.length > 1024)
    return new Response("Unauthorized", { status: 401, headers });
  try {
    const verified = await db().rpc("verify_publisher_cron_secret", { _candidate: secret });
    if (verified.error || verified.data !== true)
      return new Response("Unauthorized", { status: 401, headers });
    return Response.json(await runAlerts(), { headers });
  } catch {
    return Response.json({ error: "Channel worker unavailable" }, { status: 503, headers });
  }
}
