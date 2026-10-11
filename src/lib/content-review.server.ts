import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { contentReviewTelegramCall } from "./messaging/telegram-transport";
import {
  MAX_REVIEW_BYTES,
  reviewCard,
  type ReviewAction,
  type ReviewItem,
  type ReviewResult,
} from "./content-review";

const bucket = "content-review";
async function command(user: string, action: string, payload: unknown = {}) {
  const { data, error } = await (supabaseAdmin as SupabaseClient).rpc("content_review_command", {
    p_user: user,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw new Error("Aktion nicht möglich. Ansicht aktualisieren und erneut prüfen.");
  return data;
}
function telegramConfig(user: string) {
  // This private installation's owner and private review chat, verified during setup.
  const owner = process.env.CONTENT_REVIEW_OWNER_ID ?? "e4ee414f-fbb6-4f82-b5fc-22d74ed6b3cc";
  const chat = process.env.CONTENT_REVIEW_TELEGRAM_CHAT_ID ?? "8556103033";
  const token = process.env.CONTENT_REVIEW_BOT_TOKEN;
  const origin = process.env.CONTENT_REVIEW_ORIGIN ?? "https://instascanner.app";
  if (owner !== user || !chat || !/^[1-9][0-9]{4,15}$/.test(chat) || !token || !origin) return null;
  try {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    return { chat, origin: url.origin };
  } catch {
    return null;
  }
}
export async function reviewCommand(user: string, action: ReviewAction): Promise<ReviewResult> {
  if (action.action === "list")
    return { items: await command(user, "list"), telegramReady: !!telegramConfig(user) };
  if (action.action === "create") return { item: await command(user, "create", action) };
  if (action.action === "decide" || action.action === "edit")
    return { item: await command(user, action.action, action) };
  const item = (await command(user, "get", action)) as ReviewItem;
  if (item.revision !== action.revision)
    throw new Error("Neuere Version vorhanden. Bitte aktualisieren.");
  const storage = supabaseAdmin.storage.from(bucket);
  if (action.action === "upload") {
    if (item.status !== "uploading") throw new Error("Video ist bereits gespeichert.");
    const { data, error } = await storage.createSignedUploadUrl(item.media_path, { upsert: false });
    if (error || !data) throw new Error("Upload konnte nicht vorbereitet werden.");
    return { token: data.token, path: data.path };
  }
  if (action.action === "finalize") {
    if (item.status !== "uploading") throw new Error("Video ist bereits geprüft.");
    const { data, error } = await storage.download(item.media_path);
    if (error || !data) throw new Error("Video fehlt. Upload zuerst abschließen.");
    if (data.size < 12 || data.size > MAX_REVIEW_BYTES)
      throw new Error("Video muss eine MP4-Datei bis 40 MB sein.");
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.toString("ascii", 4, 8) !== "ftyp") throw new Error("Keine gültige MP4-Datei.");
    return {
      item: await command(user, "finalize", {
        ...action,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      }),
    };
  }
  if (item.status === "uploading") throw new Error("Upload zuerst abschließen.");
  if (action.action === "notify" && !telegramConfig(user))
    throw new Error("Review-Bot ist noch nicht serverseitig verbunden.");
  const { data: signed, error } = await storage.createSignedUrl(item.media_path, 600);
  if (error || !signed) throw new Error("Vorschau momentan nicht verfügbar.");
  if (action.action === "preview") return { url: signed.signedUrl };
  if (action.action === "notify") {
    const config = telegramConfig(user)!;
    // Reserve before the external side effect. An ambiguous timeout never retries automatically.
    await command(user, "reserve_notification", action);
    const response = await contentReviewTelegramCall({
      ...reviewCard(item, config.origin, config.chat),
      video: signed.signedUrl,
    });
    const result = response.result as { message_id?: number } | undefined;
    const messageId =
      response.ok && Number.isSafeInteger(result?.message_id) ? result!.message_id : null;
    await command(user, "finish_notification", { ...action, message_id: messageId });
    if (!messageId)
      throw new Error("Versand nicht bestätigt. Bot-Chat prüfen; kein automatischer Neuversand.");
    return { item: await command(user, "get", action) };
  }
  throw new Error("Unbekannte Aktion.");
}
