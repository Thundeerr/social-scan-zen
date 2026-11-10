import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { websiteCommentEvents } from "./kiikii-comment-replies";
import { CAMPAIGN_MEDIA_ID } from "./kiikii-comment-campaigns";

const fields = new Set(["comments", "live_comments", "messages", "messaging_seen", "messaging_postbacks", "message_reactions", "mentions", "story_insights"]);
const numeric = (value: unknown): value is string => typeof value === "string" && /^\d{1,40}$/.test(value);
export function webhookSummary(body: unknown) {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const entries = Array.isArray(value.entry) ? value.entry.slice(0, 5) : [];
  const entryIds: string[] = [], eventFields: string[] = [], mediaIds: string[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (numeric(entry.id)) entryIds.push(entry.id);
    for (const change of (Array.isArray(entry.changes) ? entry.changes : [entry]).slice(0, 5)) {
      if (!change || typeof change !== "object") continue;
      eventFields.push(fields.has(change.field) ? change.field : "other");
      if (numeric(change.value?.media?.id)) mediaIds.push(change.value.media.id);
    }
  }
  const parsed = websiteCommentEvents(body);
  return { object: value.object === "instagram" || value.object === "page" ? value.object : "other",
    entry_ids: [...new Set(entryIds)].slice(0, 5), fields: [...new Set(eventFields)].slice(0, 5), media_ids: [...new Set(mediaIds)].slice(0, 5),
    parsed_comments: parsed.length, target_comments: parsed.filter((event) => event.media === CAMPAIGN_MEDIA_ID).length };
}
export async function noteWebhook(stage: "received" | "verified" | "rejected" | "parsed" | "failed", body?: unknown) {
  try {
    const result = await (supabaseAdmin as SupabaseClient).rpc("ig_webhook_note", { p_stage: stage, p_summary: stage === "parsed" ? webhookSummary(body) : null });
    if (result.error) console.error("[instagram-webhook] health_write_failed");
  } catch { console.error("[instagram-webhook] health_write_failed"); }
}
