import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checked, connection, graph, commentGraph, redirectConnectionReady, deliverWebsiteReply } from "./kiikii-dm-redirect.server";
import { COMMENT_SCOPE, websiteCommentEvents, verifiedCommentSchema, verifiedMediaSchema } from "./kiikii-comment-replies";
import { KIIKII_ID } from "./kiikii-dm-redirect";
import { CAMPAIGN_MEDIA_ID, CAMPAIGN_PERMALINK, PRIVATE_REPLY_WINDOW_MS } from "./kiikii-comment-campaigns";

const db = supabaseAdmin as SupabaseClient;
type Event = ReturnType<typeof websiteCommentEvents>[number];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const configured = () => Boolean(process.env.INSTAGRAM_WEBHOOK_APP_SECRET || process.env.INSTAGRAM_APP_SECRET);

async function campaignFor(user: string) {
  return checked(await db.from("ig_comment_campaigns").select("*").eq("user_id", user).eq("media_id", CAMPAIGN_MEDIA_ID).maybeSingle());
}
async function noteError(id: string, code: string) {
  console.error("[kiikii-comment-campaign]", code);
  // Do not include provider URLs, bodies or exception strings in logs or status.
  const result = await db.from("ig_comment_campaigns").update({ last_error_code: code, last_error_at: new Date().toISOString() }).eq("id", id);
  if (result.error) console.error("[kiikii-comment-campaign] status_write_failed");
}
async function ownReel(token: string) {
  const profile = await graph("me?fields=user_id,username", token);
  if (String(profile.user_id) !== KIIKII_ID || profile.username?.toLowerCase() !== "kiikii.bat")
    throw new Error("Meta returned a different Instagram account.");
  const raw = await commentGraph(`${CAMPAIGN_MEDIA_ID}?fields=id,owner,caption,permalink,media_product_type`, token);
  const parsed = verifiedMediaSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== CAMPAIGN_MEDIA_ID || raw.media_product_type !== "REELS" ||
    ![KIIKII_ID, String(profile.id)].includes(parsed.data.owner.id))
    throw new Error("Could not verify the selected Kiikii reel.");
}

/** Called only by the signature-verified webhook or the authenticated owner catch-up. */
export async function processCampaignEvents(events: Event[], source: "webhook" | "catchup") {
  const targeted = events.filter((event) => event.media === CAMPAIGN_MEDIA_ID);
  if (!targeted.length) return;
  const dm = checked(await db.from("ig_dm_redirect_settings").select("user_id,mode").eq("receiver_id", KIIKII_ID).maybeSingle());
  if (!dm) return;
  const campaign = await campaignFor(dm.user_id);
  if (!campaign) return;
  if (source === "webhook") {
    checked(await db.from("ig_comment_campaigns").update({ last_webhook_at: new Date().toISOString() }).eq("id", campaign.id));
  }
  if (!campaign.enabled) return;
  let stage = "connection_not_ready";
  try {
    const c = await connection(dm.user_id);
    if (dm.mode !== "off" || !redirectConnectionReady(c) || !c.granted_scopes.includes(COMMENT_SCOPE))
      throw new Error("Keep the old DM responder paused and check Instagram access.");
    let mediaVerified = false;
    for (const event of targeted) {
      stage = "receipt_lookup_failed";
      const messageHash = hash(`comment:${event.comment}`);
      const existing = checked(await db.from("ig_dm_redirect_receipts").select("message_hash").eq("user_id", dm.user_id).eq("message_hash", messageHash).maybeSingle());
      if (existing) continue;
      stage = "comment_verification_failed";
      const parsed = verifiedCommentSchema.safeParse(await commentGraph(`${event.comment}?fields=id,text,timestamp,from,media,parent_id,hidden`, c.page_access_token));
      if (!parsed.success) continue;
      const v = parsed.data, time = Date.parse(v.timestamp);
      if (v.id !== event.comment || v.media.id !== CAMPAIGN_MEDIA_ID ||
        (v.from.id !== undefined && v.from.id !== event.sender) || v.from.username.toLowerCase() !== event.username ||
        v.parent_id || v.hidden || v.text.trim() !== "<3" || !Number.isFinite(time) ||
        time < Date.parse(campaign.starts_at) || time < Date.now() - PRIVATE_REPLY_WINDOW_MS || time > Date.now() + 300_000) continue;
      if (!mediaVerified) {
        stage = "media_verification_failed";
        await ownReel(c.page_access_token);
        mediaVerified = true;
      }
      stage = "reservation_failed";
      const reservation = checked(await db.rpc("ig_comment_campaign_reserve", {
        p_receiver: KIIKII_ID, p_media: CAMPAIGN_MEDIA_ID, p_sender: event.sender, p_comment: event.comment,
        p_event_at: new Date(time).toISOString(), p_username: v.from.username.toLowerCase(), p_text: v.text.trim(),
      }));
      if (!reservation?.send) continue;
      stage = "delivery_receipt_failed";
      const reply = reservation.reply_text;
      const result = typeof reply !== "string" || !reply.trim() || reply.length > 1000 || time < Date.now() - PRIVATE_REPLY_WINDOW_MS
        ? { status: "failed", provider_message_id: null, error_code: "invalid_or_expired_event" }
        : await deliverWebsiteReply(c.page_access_token, event.comment, reply, "comment", event.sender);
      // A committed reservation survives any crash/unknown HTTP result. Never resend it.
      checked(await db.from("ig_dm_redirect_receipts").update({ ...result, finished_at: new Date().toISOString() })
        .eq("user_id", dm.user_id).eq("message_hash", messageHash).eq("source", "comment").eq("status", "reserved"));
      checked(await db.from("ig_comment_campaigns").update(result.status === "sent"
        ? { last_delivery_at: new Date().toISOString(), last_error_code: null, last_error_at: null }
        : { last_error_code: result.error_code, last_error_at: new Date().toISOString() }).eq("id", campaign.id));
    }
  } catch {
    await noteError(campaign.id, stage);
    throw new Error("Comment campaign could not finish; check its status.");
  }
}

export async function ingestCampaignComments(body: unknown) {
  await processCampaignEvents(websiteCommentEvents(body), "webhook");
}

async function accountSubscriptions(token: string) {
  const response = await graph(`${KIIKII_ID}/subscribed_apps`, token);
  if (!Array.isArray(response.data) || response.data.length > 1 ||
    response.data.some((entry: { subscribed_fields?: unknown }) => !Array.isArray(entry.subscribed_fields)))
    throw new Error("Existing Meta subscriptions need review.");
  return [...new Set<string>(response.data.flatMap((entry: { subscribed_fields: unknown[] }) => entry.subscribed_fields.filter((value): value is string => typeof value === "string")))];
}

export async function campaignOperator(user: string, action: "status" | "enable" | "pause" | "check" | "catchup") {
  const roles = checked(await db.from("user_roles").select("role").eq("user_id", user));
  if (!roles?.some((role) => ["owner", "cofounder"].includes(role.role))) throw new Error("Not authorized");
  const campaign = await campaignFor(user);
  if (!campaign) return { campaign: null, ready: false, accountSubscribedFields: null, receipts: [], permalink: CAMPAIGN_PERMALINK };
  const dm = checked(await db.from("ig_dm_redirect_settings").select("mode").eq("user_id", user).maybeSingle());
  const c = await connection(user);
  const ready = dm?.mode === "off" && redirectConnectionReady(c) && c.granted_scopes.includes(COMMENT_SCOPE) && configured();
  let subscribedFields: string[] | null = null;
  if (action === "pause") checked(await db.from("ig_comment_campaigns").update({ enabled: false }).eq("id", campaign.id).eq("user_id", user));
  if (["enable", "check", "catchup"].includes(action)) {
    if (!ready || !c) throw new Error("Pause the old DM responder and check the Kiikii connection.");
    try {
      await ownReel(c.page_access_token);
      subscribedFields = await accountSubscriptions(c.page_access_token);
      if (action === "enable") {
        if (!subscribedFields.includes("comments") || !subscribedFields.includes("messages")) {
          const fields = new Set([...subscribedFields, "comments", "messages"]);
          const result = await graph(`${KIIKII_ID}/subscribed_apps`, c.page_access_token, new URLSearchParams({ subscribed_fields: [...fields].join(",") }));
          if (result.success !== true) throw new Error("Meta did not confirm subscriptions.");
          subscribedFields = await accountSubscriptions(c.page_access_token);
        }
        if (!subscribedFields.includes("comments") || !subscribedFields.includes("messages")) throw new Error("Account comment subscription is missing.");
        checked(await db.from("ig_comment_campaigns").update({ enabled: true, activated_at: new Date().toISOString(), last_error_code: null, last_error_at: null }).eq("id", campaign.id).eq("user_id", user));
      }
      if (action === "catchup") {
        if (!campaign.enabled) throw new Error("Enable this reel's campaign before checking earlier comments.");
        if (!campaign.backfill_complete_at) {
          const suffix = campaign.backfill_cursor ? `&after=${encodeURIComponent(campaign.backfill_cursor)}` : "";
          const page = await graph(`${CAMPAIGN_MEDIA_ID}/comments?fields=id,from,parent_id,hidden&limit=10${suffix}`, c.page_access_token);
          if (!Array.isArray(page.data) || page.data.length > 10) throw new Error("Invalid comment page.");
          const events = websiteCommentEvents({ object: "instagram", entry: [{ id: KIIKII_ID, changes: page.data.map((item: Record<string, unknown>) => ({ field: "comments", value: { ...item, media: { id: CAMPAIGN_MEDIA_ID } } })) }] });
          const next = page.paging?.next ? page.paging?.cursors?.after : null;
          const seen: string[] = campaign.backfill_cursor_hashes ?? [];
          if (page.paging?.next && (typeof next !== "string" || !next || next.length > 4096 || seen.includes(hash(next)))) throw new Error("Invalid or repeated pagination cursor.");
          // Complete this page before advancing. Retries dedupe committed send intents.
          await processCampaignEvents(events, "catchup");
          checked(await db.from("ig_comment_campaigns").update({ backfill_cursor: next, backfill_cursor_hashes: next ? [...seen, hash(next)] : [],
            backfill_revision: campaign.backfill_revision + 1, backfill_complete_at: next ? null : new Date().toISOString(), last_catchup_at: new Date().toISOString() })
            .eq("id", campaign.id).eq("user_id", user).eq("backfill_revision", campaign.backfill_revision));
        }
      }
    } catch {
      await noteError(campaign.id, `operator_${action}_failed`);
      throw new Error("Could not finish the campaign operation. Check Instagram access and try the read-only check.");
    }
  }
  const current = await campaignFor(user);
  const receipts = checked(await db.from("ig_dm_redirect_receipts").select("received_at,status,error_code")
    .eq("user_id", user).eq("campaign_media_id", CAMPAIGN_MEDIA_ID).order("received_at", { ascending: false }).limit(20));
  return { ready, permalink: CAMPAIGN_PERMALINK, accountSubscribedFields: subscribedFields, receipts: receipts ?? [],
    campaign: current ? { enabled: current.enabled, reply: current.reply_text, lastWebhookAt: current.last_webhook_at,
      lastDeliveryAt: current.last_delivery_at, lastError: current.last_error_code, lastCatchupAt: current.last_catchup_at,
      backfillComplete: Boolean(current.backfill_complete_at), backfillHasMore: Boolean(current.backfill_cursor) } : null };
}
